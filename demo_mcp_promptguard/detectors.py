"""Interchangeable local detectors; optional model libraries import lazily."""
import asyncio
import importlib.util
import threading


class DetectorUnavailable(Exception):
    """The requested detector could not be activated."""


class ClassifierDetector:
    def __init__(self, model, threshold, benign_labels):
        from transformers import pipeline

        self._classifier = pipeline("text-classification", model=model,
                                    top_k=None, truncation=True)
        self._threshold = threshold
        self._benign_labels = {label.lower() for label in benign_labels}

    def check(self, text):
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
        self._rails = IORails(RailsConfig.from_content(config=config))
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

    def check(self, text):
        result = self._run(self._rails.check_async([{"role": "user", "content": text}]))
        status = getattr(result.status, "value", result.status)
        # 0.24.1 represents failed rail actions as BLOCKED with this content.
        # Propagate a failure so Privilege's failure policy remains authoritative.
        if status == "blocked" and result.content == self._internal_error_message:
            raise RuntimeError("NeMo Guardrails classifier check failed")
        if status not in {"blocked", "passed", "modified"}:
            raise RuntimeError("NeMo Guardrails returned an unknown check status")
        blocked = status == "blocked"
        # RailsResult exposes a rail verdict rather than classifier probabilities.
        return {"blocked": blocked, "label": "INJECTION" if blocked else None, "score": None}

    def close(self):
        if self._loop.is_closed():
            return
        try:
            self._run(self._rails.stop())
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
                self._detector = self._factories[previous]()
                raise DetectorUnavailable(reason) from error
            self._active = engine

    def check(self, text):
        with self._lock:
            return self._detector.check(text)
