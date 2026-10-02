"""Interchangeable local detectors; optional model libraries import lazily."""
import asyncio
import importlib.util
import threading

# Rails the NeMo engine can run. Order is the order verdicts are reported in.
# "injection" is the always-on baseline (the classifier in nemo_config/config.yml);
# the rest run only when enabled in the control config.
RAILS = (
    {"id": "injection", "label": "Prompt injection (classifier)", "directions": ("request", "response")},
    {"id": "regex_pii", "label": "PII patterns (regex)", "directions": ("request", "response")},
    {"id": "presidio_pii", "label": "PII entities (Presidio)", "directions": ("request", "response")},
)
DEFAULT_RAILS = {"injection": True, "regex_pii": False, "presidio_pii": False}
_RAIL_LABELS = {"injection": "INJECTION", "regex_pii": "PII", "presidio_pii": "PII"}

_PII_PATTERNS = [
    r"\b\d{3}-\d{2}-\d{4}\b",                         # US SSN
    r"\b(?:\d[ -]?){13,16}\b",                          # payment card number
    r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b",                # email address
    r"\b(?:\+?1[ -.]?)?\(?\d{3}\)?[ -.]?\d{3}[ -.]?\d{4}\b",  # US phone number
]
_PRESIDIO_ENTITIES = ["US_SSN", "CREDIT_CARD", "EMAIL_ADDRESS", "PHONE_NUMBER", "IBAN_CODE", "US_BANK_NUMBER"]


def _presidio_unavailable():
    if importlib.util.find_spec("presidio_analyzer") is None or importlib.util.find_spec("spacy") is None:
        return "Presidio is not installed; rebuild the sidecar with PROMPTGUARD_INSTALL_NEMO=1."
    import spacy
    if not spacy.util.is_package("en_core_web_lg"):
        return "The spaCy model en_core_web_lg is not installed in the sidecar image."
    return None


def rail_catalog():
    """Static rail list with availability; never loads a model."""
    out = []
    for rail in RAILS:
        reason = None
        if importlib.util.find_spec("nemoguardrails") is None:
            reason = "NeMo Guardrails is not installed; rebuild with PROMPTGUARD_INSTALL_NEMO=1."
        elif rail["id"] == "presidio_pii":
            reason = _presidio_unavailable()
        out.append({"id": rail["id"], "label": rail["label"], "directions": list(rail["directions"]),
                    "available": reason is None, "reason": reason})
    return out


def _pii_rail_config(rail_id):
    if rail_id == "regex_pii":
        options = {"patterns": _PII_PATTERNS}
        return {"models": [], "rails": {
            "config": {"regex_detection": {"input": options, "output": options}},
            "input": {"flows": ["regex check input"]},
            "output": {"flows": ["regex check output"]}}}
    options = {"entities": _PRESIDIO_ENTITIES, "score_threshold": 0.5}
    return {"models": [], "rails": {
        "config": {"sensitive_data_detection": {"input": options, "output": options}},
        "input": {"flows": ["detect sensitive data on input"]},
        "output": {"flows": ["detect sensitive data on output"]}}}


class DetectorUnavailable(Exception):
    """The requested detector could not be activated."""


class ClassifierDetector:
    def __init__(self, model, threshold, benign_labels):
        from transformers import pipeline

        self._classifier = pipeline("text-classification", model=model,
                                    top_k=None, truncation=True)
        self._threshold = threshold
        self._benign_labels = {label.lower() for label in benign_labels}

    def check(self, text, direction=None, rails=None):
        scores = self._classifier(text)
        if scores and isinstance(scores[0], list):
            scores = scores[0]
        blocked = [score for score in scores
                   if score["label"].lower() not in self._benign_labels
                   and score["score"] >= self._threshold]
        worst = max(blocked or scores, key=lambda score: score["score"], default=None)
        return {"blocked": bool(blocked),
                "label": worst["label"] if worst else None,
                "score": float(worst["score"]) if worst else None}

    def close(self):
        self._classifier = None


class NeMoDetector:
    """Run IORails on one owned event loop, shared across synchronous checks."""

    def __init__(self, model, threshold, benign_labels, nemo_config_dir):
        from nemoguardrails import RailsConfig
        from nemoguardrails.guardrails.iorails import IORails, INTERNAL_ERROR_MESSAGE
        from transformers import AutoConfig

        labels = AutoConfig.from_pretrained(model).id2label.values()
        benign = {label.lower() for label in benign_labels}
        config = RailsConfig.from_path(nemo_config_dir).model_dump(mode="json")
        config["rails"]["config"]["hf_classifier"]["promptguard"] = {
            "engine": "local", "model": model, "task": "text-classification",
            "threshold": threshold,
            "blocked_labels": sorted({label for label in labels if label.lower() not in benign}),
            "parameters": {"top_k": None, "truncation": True},
        }
        self._RailsConfig, self._IORails = RailsConfig, IORails
        self._rails = IORails(RailsConfig.from_content(config=config))
        self._extra = {}  # optional rails, built on first enable (Presidio loads a ~500MB model)
        self._internal_error_message = INTERNAL_ERROR_MESSAGE
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run_loop, name="promptguard-nemo", daemon=True)
        self._thread.start()
        try:
            self._run(self._rails.start())
            # Local classifier loading is lazy in NeMo. Warm it before reporting
            # a switch as successful so model failures restore the prior engine.
            self.check("PromptGuard startup check")
        except Exception:
            self.close()
            raise

    def _run_loop(self):
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def _run(self, coroutine):
        return asyncio.run_coroutine_threadsafe(coroutine, self._loop).result()

    def _blocked(self, rails, messages):
        result = self._run(rails.check_async(messages))
        status = getattr(result.status, "value", result.status)
        # 0.24.1 represents failed rail actions as BLOCKED with this content.
        # Propagate a failure so Privilege's failure policy remains authoritative.
        if status == "blocked" and result.content == self._internal_error_message:
            raise RuntimeError("NeMo Guardrails classifier check failed")
        if status not in {"blocked", "passed", "modified"}:
            raise RuntimeError("NeMo Guardrails returned an unknown check status")
        return status == "blocked"

    def configure(self, enabled):
        """Build and warm any enabled optional rail that is not running yet."""
        for rail in rail_catalog():
            if enabled.get(rail["id"]) and rail["id"] != "injection" and rail["id"] not in self._extra:
                if not rail["available"]:
                    raise DetectorUnavailable(f"{rail['label']}: {rail['reason']}")
                rails = self._IORails(self._RailsConfig.from_content(config=_pii_rail_config(rail["id"])))
                try:
                    self._run(rails.start())
                    self._blocked(rails, [{"role": "user", "content": "PromptGuard startup check"}])
                except Exception as error:
                    raise DetectorUnavailable(f"{rail['label']} failed to start: {error}") from error
                self._extra[rail["id"]] = rails

    def check(self, text, direction=None, rails=None):
        selected = {"injection": True} if rails is None else rails
        fired = []
        for rail in RAILS:
            if not selected.get(rail["id"]):
                continue
            if rail["id"] == "injection":
                engine, messages = self._rails, [{"role": "user", "content": text}]
            else:
                if rail["id"] not in self._extra:
                    raise RuntimeError(f"Rail {rail['id']} is enabled but not started")
                engine = self._extra[rail["id"]]
                messages = ([{"role": "user", "content": "-"}, {"role": "assistant", "content": text}]
                            if direction == "response" else [{"role": "user", "content": text}])
            if self._blocked(engine, messages):
                fired.append(rail["id"])
        # RailsResult exposes a rail verdict rather than classifier probabilities.
        result = {"blocked": bool(fired), "label": _RAIL_LABELS[fired[0]] if fired else None, "score": None}
        if rails is not None:
            result["rails"] = fired
        return result

    def close(self):
        if self._loop.is_closed():
            return
        try:
            for engine in [self._rails, *self._extra.values()]:
                self._run(engine.stop())
        finally:
            async def finish():
                await self._loop.shutdown_asyncgens()
                await self._loop.shutdown_default_executor()

            try:
                self._run(finish())
            finally:
                self._loop.call_soon_threadsafe(self._loop.stop)
                self._thread.join()
                self._loop.close()
                self._rails = None


class DetectorManager:
    def __init__(self, model, threshold, benign_labels, nemo_config_dir, detector_factories=None):
        self._lock = threading.RLock()
        factories = detector_factories or {}
        self._factories = {
            "classifier": factories.get("classifier", lambda: ClassifierDetector(model, threshold, benign_labels)),
            "nemo": factories.get("nemo", lambda: NeMoDetector(model, threshold, benign_labels, nemo_config_dir)),
        }
        self._reasons = {"classifier": None, "nemo": None}
        if "nemo" not in factories and importlib.util.find_spec("nemoguardrails") is None:
            self._reasons["nemo"] = (
                "NeMo Guardrails is not installed; rebuild with PROMPTGUARD_INSTALL_NEMO=1."
            )
        self._detector = self._factories["classifier"]()
        self._active = "classifier"

    def engines(self):
        with self._lock:
            return [{"id": engine, "available": reason is None, "reason": reason}
                    for engine, reason in self._reasons.items()]

    def active_engine(self):
        with self._lock:
            return self._active

    def select_engine(self, engine):
        with self._lock:
            if engine not in self._factories:
                raise DetectorUnavailable("Unknown detector engine")
            if engine == self._active and self._detector is None:
                # A failed rollback leaves no runtime. Explicitly reselecting
                # the previous engine retries its initialization.
                try:
                    self._detector = self._factories[engine]()
                except Exception as error:
                    self._reasons[engine] = f"Detector reinitialization failed: {error}"
                    raise DetectorUnavailable(self._reasons[engine]) from error
                self._reasons[engine] = None
                return
            if self._reasons[engine] is not None:
                raise DetectorUnavailable(self._reasons[engine])
            if engine == self._active:
                return
            previous = self._active
            close = getattr(self._detector, "close", None)
            self._detector = None
            stage = "shutdown"
            try:
                if close:
                    close()
                stage = "initialization"
                self._detector = self._factories[engine]()
            except Exception as error:
                reason = f"Detector {stage} failed: {error}"
                if stage == "initialization":
                    self._reasons[engine] = reason
                try:
                    self._detector = self._factories[previous]()
                except Exception as restoration_error:
                    self._reasons[previous] = (
                        f"Detector restoration failed: {restoration_error}. "
                        f"Reselect {previous} to retry initialization or restart the sidecar."
                    )
                    raise DetectorUnavailable(f"{reason}; {self._reasons[previous]}") from restoration_error
                raise DetectorUnavailable(reason) from error
            self._active = engine

    def check(self, text, **options):
        with self._lock:
            if self._detector is None:
                raise DetectorUnavailable(self._reasons[self._active] or "No detector runtime is available")
            return self._detector.check(text, **options)

    def rails(self):
        return rail_catalog()

    def configure_rails(self, enabled):
        """Start the enabled optional rails; only the NeMo engine has any."""
        with self._lock:
            configure = getattr(self._detector, "configure", None)
            if configure:
                configure(enabled)
