"""Where this agent's LLM calls go, and which model to use on that path.

The Anthropic SDK reads ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY itself, so routing
through the PingOne Agent Privilege is configuration only: point the base URL at
<gateway>/llm/anthropic and put the `anthropic` virtual key in ANTHROPIC_API_KEY.
That key only allows Haiku, so the model default changes with the path.
"""
import os

PRIVILEGE_MARKER = "/llm/anthropic"
PRIVILEGE_MODEL = "claude-haiku-4-5"
VENDOR_MODEL = "claude-3-5-sonnet-20241022"


def llm_route(env=None):
    env = os.environ if env is None else env
    base = (env.get("ANTHROPIC_BASE_URL") or "").strip()
    via_privilege = PRIVILEGE_MARKER in base
    model = env.get("COMPLIANCE_MODEL") or (PRIVILEGE_MODEL if via_privilege else VENDOR_MODEL)
    label = (
        f"LLM path: PRIVILEGE ({base})" if via_privilege
        else f"LLM path: {base or 'api.anthropic.com'} (NOT governed by Privilege)"
    )
    return {"via_privilege": via_privilege, "model": model, "label": label}
