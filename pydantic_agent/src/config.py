import os
from dotenv import load_dotenv

load_dotenv()


def _int_env(name: str, default: int) -> int:
    """Read an int env var, falling back to the default on a bad value.

    These reads must not raise at import time — a malformed override would
    otherwise refuse the process boot instead of degrading gracefully.
    """
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default

# The local llama.cpp multi-model proxy (:8090, OpenAI-compatible, local, $0) is
# the default provider. Override via AGENT_LLM_BASE_URL / AGENT_LLM_API_KEY /
# AGENT_LLM_MODEL to point at OpenAI or any other OpenAI-compatible endpoint.
# Resolution happens lazily — these reads must not raise at import time,
# otherwise the agent process refuses to boot when keys are missing and the
# operator just sees an empty dock instead of an actionable RUN_ERROR.
LLM_API_KEY: str = (
    os.environ.get("AGENT_LLM_API_KEY")
    or os.environ.get("OPENAI_API_KEY")
    or "llama-cpp"
)
LLM_BASE_URL: str = os.environ.get("AGENT_LLM_BASE_URL", "http://localhost:8090/v1")
# Default is a proxy tier id (the router recognizes it and serves it from the
# smallest loaded tier). Override via AGENT_LLM_MODEL.
LLM_MODEL: str = (
    os.environ.get("AGENT_LLM_MODEL")
    or os.environ.get("OPENAI_MODEL")
    or "phi-4-mini-instruct"
)
BFF_INTERNAL_SECRET: str = os.environ.get("BFF_INTERNAL_SECRET", "dev-secret")
BFF_INTERNAL_TOOL_URL: str = os.getenv("BFF_INTERNAL_TOOL_URL", "http://127.0.0.1:3001/internal/agent-tool")
AGENT_HTTP_HOST: str = os.getenv("AGENT_HTTP_HOST", "127.0.0.1")
AGENT_HTTP_PORT: int = _int_env("AGENT_HTTP_PORT", 8893)
# LLM request timeout (seconds) and a per-run request cap that bounds runaway
# tool-call loops. Both must survive a bad override without crashing at import.
LLM_TIMEOUT: float = _float_env("AGENT_LLM_TIMEOUT", 120.0)
LLM_REQUEST_LIMIT: int = _int_env("AGENT_LLM_REQUEST_LIMIT", 20)
