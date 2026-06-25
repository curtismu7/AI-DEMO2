import os
from dotenv import load_dotenv

load_dotenv()

# LM Studio is the default provider (OpenAI-compatible, local, $0). Override via
# AGENT_LLM_BASE_URL / AGENT_LLM_API_KEY / AGENT_LLM_MODEL to point at OpenAI or
# any other OpenAI-compatible endpoint. Resolution happens lazily — these reads
# must not raise at import time, otherwise the agent process refuses to boot
# when keys are missing and the operator just sees an empty dock instead of an
# actionable RUN_ERROR.
LLM_API_KEY: str = (
    os.environ.get("AGENT_LLM_API_KEY")
    or os.environ.get("OPENAI_API_KEY")
    or "lm-studio"
)
LLM_BASE_URL: str = os.environ.get("AGENT_LLM_BASE_URL", "http://localhost:1234/v1")
# Default matches run.sh's LM Studio auto-load model. Override via
# AGENT_LLM_MODEL once you've loaded a different model in LM Studio.
LLM_MODEL: str = (
    os.environ.get("AGENT_LLM_MODEL")
    or os.environ.get("OPENAI_MODEL")
    or "google/gemma-4-e2b"
)
BFF_INTERNAL_SECRET: str = os.environ.get("BFF_INTERNAL_SECRET", "dev-secret")
BFF_INTERNAL_TOOL_URL: str = os.getenv("BFF_INTERNAL_TOOL_URL", "http://127.0.0.1:3001/internal/agent-tool")
AGENT_HTTP_HOST: str = os.getenv("AGENT_HTTP_HOST", "127.0.0.1")
AGENT_HTTP_PORT: int = int(os.getenv("AGENT_HTTP_PORT", "8893"))
