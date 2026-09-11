#!/usr/bin/env python3
"""External ML guardrail sidecar for the PingOne Privilege AI Gateway.

The gateway POSTs each governed prompt/response to /inspect as a WebhookRequest
({tenant, user, app_name, units:[{role, direction, text}]}) and expects a
WebhookResponse ({findings:[{category, severity, location, messages, contents}]}).
An EMPTY findings list means "allow"; a finding whose category crosses that
category's block threshold makes the gateway block. Contract reverse-engineered
from the gateway binary + a live capture — see privilege/AGENTLESS-CONFIGURATION.md.

This wraps Meta Prompt-Guard (a small text classifier). Any non-benign label at
or above THRESHOLD becomes a finding on that unit.
"""
import json
import os
import http.server

# Tunable at deploy time — the model, its benign label(s) and the block point all
# vary by Prompt-Guard version, so none of them is hardcoded. Prompt-Guard-1 emits
# BENIGN/INJECTION/JAILBREAK; Prompt-Guard-2 emits BENIGN/MALICIOUS (or LABEL_0/1).
MODEL = os.environ.get("PROMPTGUARD_MODEL", "meta-llama/Llama-Prompt-Guard-2-86M")
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


def to_findings(units, classify):
    """Pure mapping from request units to WebhookResponse findings.

    `classify(text)` returns [{"label": str, "score": float}, ...]. Injectable so
    the mapping is testable without loading the model. One finding per unit whose
    worst non-benign label scores >= THRESHOLD.
    """
    findings = []
    for i, unit in enumerate(units or []):
        text = (unit or {}).get("text") or ""
        if not text.strip():
            continue
        bad = [
            s for s in classify(text)
            if s["label"].lower() not in BENIGN_LABELS and s["score"] >= THRESHOLD
        ]
        if not bad:
            continue
        worst = max(bad, key=lambda s: s["score"])
        findings.append({
            "category": category_for(worst["label"]),
            "severity": "high" if worst["score"] >= 0.9 else "medium",
            "location": {"index": i},
            "messages": [f"Prompt-Guard flagged {worst['label']} ({worst['score']:.2f})"],
            "contents": [text[:200]],
        })
    return findings


def load_classifier():
    """Load the model once. Imported lazily so importing this module (e.g. in
    tests) needs neither transformers nor torch."""
    from transformers import pipeline
    clf = pipeline("text-classification", model=MODEL, top_k=None, truncation=True)

    def classify(text):
        out = clf(text)
        # top_k=None nests the scores one list deep.
        return out[0] if out and isinstance(out[0], list) else out

    return classify


def make_handler(classify):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body):
            payload = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, {"ok": True})
            self._send(404, {"error": "not_found"})

        def do_POST(self):
            if self.path != "/inspect":
                return self._send(404, {"error": "not_found"})
            try:
                n = int(self.headers.get("content-length") or 0)
                req = json.loads(self.rfile.read(n) or b"{}")
                findings = to_findings(req.get("units"), classify)
            except Exception as e:  # gateway's Fail Closed setting decides what a 5xx means
                return self._send(502, {"error": "inspect_failed", "message": str(e)})
            return self._send(200, {"findings": findings})

    return H


if __name__ == "__main__":
    print(f"promptguard: loading {MODEL} ...", flush=True)
    handler = make_handler(load_classifier())
    print(f"promptguard: listening on :{PORT}/inspect (threshold={THRESHOLD})", flush=True)
    http.server.HTTPServer(("0.0.0.0", PORT), handler).serve_forever()
