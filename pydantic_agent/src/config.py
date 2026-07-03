import os
from dotenv import load_dotenv

load_dotenv()

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
    or "gemma-3-4b-it"
)
BFF_INTERNAL_SECRET: str = os.environ.get("BFF_INTERNAL_SECRET", "dev-secret")
BFF_INTERNAL_TOOL_URL: str = os.getenv("BFF_INTERNAL_TOOL_URL", "http://127.0.0.1:3001/internal/agent-tool")
AGENT_HTTP_HOST: str = os.getenv("AGENT_HTTP_HOST", "127.0.0.1")
AGENT_HTTP_PORT: int = int(os.getenv("AGENT_HTTP_PORT", "8893"))
