from __future__ import annotations
import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    llm_api_key: str
    llm_base_url: str
    model: str
    bff_internal_secret: str
    bff_tool_url: str
    host: str
    port: int


def get_config() -> Config:
    # LM Studio is the default provider (OpenAI-compatible, local, $0). Override
    # via AGENT_LLM_BASE_URL / AGENT_LLM_API_KEY / AGENT_LLM_MODEL to point at
    # OpenAI, Groq, Together, or any other OpenAI-compatible endpoint.
    return Config(
        llm_api_key=os.environ.get("AGENT_LLM_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or "lm-studio",
        llm_base_url=os.environ.get("AGENT_LLM_BASE_URL", "http://localhost:1234/v1"),
        # Default matches run.sh's LM Studio auto-load model. Override via
        # AGENT_LLM_MODEL once you've loaded a different model in LM Studio.
        model=os.environ.get("AGENT_LLM_MODEL")
            or os.environ.get("OPENAI_MODEL")
            or "google/gemma-4-e2b",
        bff_internal_secret=os.environ.get("BFF_INTERNAL_SECRET", "dev-shared-secret-change-me"),
        bff_tool_url=os.environ.get("BFF_INTERNAL_TOOL_URL", "http://127.0.0.1:3001/internal/agent-tool"),
        host=os.environ.get("AGENT_HTTP_HOST", "127.0.0.1"),
        port=int(os.environ.get("AGENT_HTTP_PORT", "8891")),
    )
