"""ReAct agent factory for CodeGraph Explorer."""

import logging
import os
import urllib.request

from langgraph.prebuilt import create_react_agent

from src.codegraph.tools import get_codegraph_tools
from src.agent.llm_factory import get_llm

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a code navigator for the AI-Demo repository — a multi-vertical AI agent \
security demo built on PingOne, MCP, and LangChain. The repo contains:
- demo_api_server: Node.js BFF
- demo_mcp_gateway / demo_mcp_server: MCP protocol services
- langchain_agent: Python LangChain agent
- demo_api_ui: React frontend
- demo_authz_server: mock PingOne Authorize

Answer ONLY from real code you have looked up. Recommended flow:
1. `grep` with a keyword from the question (an identifier, route, or config key) \
to LOCATE the relevant files — this is your strongest tool.
2. `read_file` on the most relevant hit (optionally a ':start:end' line window) \
to read the ACTUAL implementation you will explain.
3. `codegraph_search` / `codegraph_callers` / `codegraph_callees` to trace \
structure ("what calls X", "what does X call") when the question is about flow.
Always cite file:line references. Keep answers focused and concrete. If grep \
finds nothing, try a synonym or a broader pattern before giving up."""


def _llamacpp_reachable(base_url: str) -> bool:
    """Return True if llama-server is up and a model is loaded (/health → 200)."""
    try:
        urllib.request.urlopen(base_url.rstrip("/") + "/health", timeout=2)
        return True
    except Exception:
        return False


def _helix_configured() -> bool:
    """Return True if all required Helix env vars are present and non-empty."""
    return bool(
        os.getenv("HELIX_ENVIRONMENT_ID") and os.getenv("HELIX_PROMPT_FIELD_ID")
    )


def _resolve_provider() -> str:
    """
    Probe-based provider resolution — no CODEGRAPH_LLM_PROVIDER override needed.

    Priority:
      1. CODEGRAPH_LLM_PROVIDER env var (explicit override)
      2. llama.cpp — if llama-server is reachable at LLAMACPP_BASE_URL
      3. Helix — if HELIX_ENVIRONMENT_ID + HELIX_PROMPT_FIELD_ID are set
      4. lmstudio — fallback when neither llama.cpp nor Helix is available
    """
    explicit = os.getenv("CODEGRAPH_LLM_PROVIDER", "").strip()
    if explicit:
        logger.info("CodeGraph LLM: using explicit CODEGRAPH_LLM_PROVIDER=%s", explicit)
        return explicit

    llamacpp_url = os.getenv("LLAMACPP_BASE_URL", "http://host.docker.internal:8090")
    if _llamacpp_reachable(llamacpp_url):
        logger.info("CodeGraph LLM: llama.cpp reachable at %s — using llamacpp", llamacpp_url)
        return "llamacpp"

    if _helix_configured():
        logger.info("CodeGraph LLM: llama.cpp not reachable, Helix configured — using helix")
        return "helix"

    logger.warning(
        "CodeGraph LLM: llama.cpp not reachable and Helix not configured — falling back to lmstudio"
    )
    return "lmstudio"


def create_codegraph_agent(api_key: str):
    """
    Create a LangGraph ReAct agent for CodeGraph exploration.

    Provider is resolved automatically: llama.cpp → Helix → lmstudio.
    Override with CODEGRAPH_LLM_PROVIDER env var.
    """
    provider = _resolve_provider()
    llm = get_llm(
        provider=provider,
        model=os.getenv("CODEGRAPH_MODEL") or None,
        api_key=api_key,
        llamacpp_base_url=os.getenv("LLAMACPP_BASE_URL", "http://host.docker.internal:8090"),
        llamacpp_model=os.getenv("LLAMACPP_MODEL", "gemma-3-4b-it"),
        lmstudio_base_url=os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1"),
    )
    tools = get_codegraph_tools()
    return create_react_agent(llm, tools, prompt=SYSTEM_PROMPT)
