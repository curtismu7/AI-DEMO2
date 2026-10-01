#!/usr/bin/env python3
"""External ML guardrail sidecar for the PingOne Privilege AI Gateway.

The gateway POSTs each governed prompt/response to /inspect as a WebhookRequest
({tenant, user, app_name, units:[{role, direction, text}]}) and expects a
WebhookResponse ({findings:[{category, severity, location, messages, contents}]}).
An EMPTY findings list means "allow"; a finding whose category crosses that
category's block threshold makes the gateway block. Contract reverse-engineered
from the gateway binary + a live capture — see privilege/AGENTLESS-CONFIGURATION.md.

This adapts the selected local detector to Privilege findings. An optional
demo override can force the verdict for matching request-direction user prompts.
"""
import json
import os
import http.server
import threading

from detectors import DetectorManager, DetectorUnavailable

# Tunable at deploy time — the model, its benign label(s) and the block point all
# vary by classifier, so none of them is hardcoded. Default is ProtectAI's public
# deberta prompt-injection model (labels SAFE / INJECTION). Meta Prompt-Guard
# (BENIGN/INJECTION/JAILBREAK, or Prompt-Guard-2's BENIGN/MALICIOUS) also works —
# but it is a GATED model, so point PROMPTGUARD_MODEL at it and build with HF_TOKEN.
MODEL = os.environ.get("PROMPTGUARD_MODEL", "protectai/deberta-v3-base-prompt-injection-v2")
THRESHOLD = float(os.environ.get("PROMPTGUARD_THRESHOLD", "0.9"))
BENIGN_LABELS = {
    s.strip().lower()
    for s in os.environ.get("PROMPTGUARD_BENIGN_LABELS", "benign,label_0,safe").split(",")
    if s.strip()
}
PORT = int(os.environ.get("PORT", "8086"))

_CATEGORY = {"jailbreak": "jailbreak", "injection": "prompt_injection"}


def category_for(label):
    """Map a model label to a gateway guardrail category."""
    l = label.lower()
    for key, cat in _CATEGORY.items():
        if key in l:
            return cat
    return "malicious_content"


UI_ORIGIN = "https://local.ping-devops.com:4000"
MAX_CONFIG_BYTES = 4096


def validate_config(value):
    """Validate the exact control schema before changing any shared state."""
    if not isinstance(value, dict) or set(value) != {"engine", "demo"}:
        raise ValueError("Config must contain exactly engine and demo")
    engine, demo = value["engine"], value["demo"]
    if engine not in ("classifier", "nemo"):
        raise ValueError("Unknown detector engine")
    if not isinstance(demo, dict) or set(demo) != {"enabled", "triggerPhrase", "outcome"}:
        raise ValueError("Demo must contain exactly enabled, triggerPhrase and outcome")
    if not isinstance(demo["enabled"], bool):
        raise ValueError("Demo enabled must be a boolean")
    phrase = demo["triggerPhrase"]
    if not isinstance(phrase, str) or len(phrase) > 120:
        raise ValueError("Trigger phrase must be a string of at most 120 characters")
    phrase = phrase.strip()
    if demo["enabled"] and not phrase:
        raise ValueError("Trigger phrase is required when demo is enabled")
    if demo["outcome"] not in ("allow", "block"):
        raise ValueError("Unknown demo outcome")
    return {"engine": engine, "demo": {"enabled": demo["enabled"],
            "triggerPhrase": phrase, "outcome": demo["outcome"]}}


def to_findings(units, manager, demo=None):
    """Map normalized detector verdicts (or a scoped demo override) to findings."""
    demo = demo or {"enabled": False}
    findings = []
    for i, unit in enumerate(units or []):
        unit = unit or {}
        text = unit.get("text") or ""
        if not text.strip():
            continue
        matches_demo = (demo["enabled"] and unit.get("role") == "user_prompt"
                        and unit.get("direction") == "request"
                        and demo["triggerPhrase"].strip().lower() in text.lower())
        if matches_demo:
            if demo["outcome"] == "allow":
                continue
            result = {"blocked": True, "label": "INJECTION", "score": 1.0}
            message = "Prompt-Guard demo override: block"
        else:
            result = manager.check(text)
            label, score = result["label"], result["score"]
            message = f"Prompt-Guard flagged {label}"
            if score is not None:
                message += f" ({score:.2f})"
        if not result["blocked"]:
            continue
        score = result["score"]
        findings.append({
            "category": category_for(result["label"] or "MALICIOUS"),
            "severity": "high" if score is None or score >= 0.9 else "medium",
            "location": {"index": i},
            "messages": [message],
            "contents": [text[:200]],
        })
    return findings


def make_handler(manager):
    config = {"engine": "classifier", "demo": {"enabled": False, "triggerPhrase": "", "outcome": "block"}}
    # Serialize entire inspections with engine/config changes, so every unit of
    # an inspection sees one active engine and one complete demo rule.
    lock = threading.RLock()

    def snapshot():
        return {"config": {"engine": manager.active_engine(), "demo": dict(config["demo"])},
                "engines": manager.engines()}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, response_headers=None):
            payload = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            if self.path in {"/health", "/demo/config", "/inspect"}:
                self.send_header("Vary", "Origin")
                if self.headers.get("Origin") == UI_ORIGIN:
                    self.send_header("Access-Control-Allow-Origin", UI_ORIGIN)
                if self.path == "/inspect":
                    self.send_header("Access-Control-Expose-Headers", "X-PromptGuard-Engine")
            for name, value in (response_headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(payload)

        def _control_origin_allowed(self):
            if self.headers.get("Origin") == UI_ORIGIN:
                return True
            self._send(403, {"error": "origin_not_allowed"})
            return False

        def do_OPTIONS(self):
            if self.path not in {"/demo/config", "/inspect"}:
                return self._send(404, {"error": "not_found"})
            if not self._control_origin_allowed():
                return
            method = self.headers.get("Access-Control-Request-Method", "GET")
            headers = {header.strip().lower() for header in
                       self.headers.get("Access-Control-Request-Headers", "").split(",") if header.strip()}
            allowed_methods = {"POST", "OPTIONS"} if self.path == "/inspect" else {"GET", "PUT", "OPTIONS"}
            if method not in allowed_methods or headers - {"content-type"}:
                return self._send(403, {"error": "preflight_not_allowed"})
            self.send_response(204)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Origin", UI_ORIGIN)
            if self.path == "/inspect":
                self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            else:
                self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_PUT(self):
            nonlocal config
            if self.path != "/demo/config":
                return self._send(404, {"error": "not_found"})
            if not self._control_origin_allowed():
                return
            try:
                if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                    raise ValueError("Content-Type must be application/json")
                length = int(self.headers.get("Content-Length") or 0)
                if not 0 < length <= MAX_CONFIG_BYTES:
                    raise ValueError("Config body must be between 1 and 4096 bytes")
                new_config = validate_config(json.loads(self.rfile.read(length)))
            except (ValueError, UnicodeError, RecursionError) as error:
                return self._send(400, {"error": "invalid_config", "message": str(error)})
            with lock:
                try:
                    manager.select_engine(new_config["engine"])
                except DetectorUnavailable as error:
                    return self._send(409, {"error": "engine_unavailable", "message": str(error)})
                config = new_config
                return self._send(200, snapshot())

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, {"ok": True})
            if self.path == "/demo/config":
                if not self._control_origin_allowed():
                    return
                with lock:
                    return self._send(200, snapshot())
            self._send(404, {"error": "not_found"})

        def do_POST(self):
            if self.path != "/inspect":
                return self._send(404, {"error": "not_found"})
            origin = self.headers.get("Origin")
            if origin is not None and origin != UI_ORIGIN:
                return self._send(403, {"error": "origin_not_allowed"})
            try:
                n = int(self.headers.get("content-length") or 0)
                req = json.loads(self.rfile.read(n) or b"{}")
                units = req.get("units") or []
                with lock:
                    findings = to_findings(units, manager, config["demo"])
                    engine = manager.active_engine()
            except Exception as e:  # gateway's Fail Closed setting decides what a 5xx means
                print("promptguard: inspect_failed", flush=True)
                return self._send(502, {"error": "inspect_failed", "message": str(e)})
            # One line per call so a demo can show the sidecar firing. Verdict only —
            # no prompt text — so shared cluster logs never carry the user's content.
            verdict = ", ".join(f["messages"][0] for f in findings) or "allow"
            print(f"promptguard: {len(units)} unit(s) -> {verdict}", flush=True)
            return self._send(200, {"findings": findings}, {"X-PromptGuard-Engine": engine})

    return H


if __name__ == "__main__":
    print(f"promptguard: loading {MODEL} ...", flush=True)
    manager = DetectorManager(MODEL, THRESHOLD, BENIGN_LABELS,
                              os.path.join(os.path.dirname(__file__), "nemo_config"))
    handler = make_handler(manager)
    print(f"promptguard: listening on :{PORT}/inspect (threshold={THRESHOLD})", flush=True)
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler).serve_forever()
