"""ReAct agent factory for CodeGraph Explorer."""

import logging
import os
import urllib.request

from langgraph.prebuilt import create_react_agent

from src.codegraph.tools import get_codegraph_tools
from src.codegraph.llm_target import proxy_base_url, resolve_llamacpp_target
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
    """Return True if the llm-proxy / llama-server origin answers /health."""
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


def _anthropic_configured() -> bool:
    """True when a non-placeholder Anthropic key is available."""
    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        return False
    # Demo images sometimes ship a literal placeholder.
    if key in {"sk-ant-api03-placeholder", "test-key", "changeme"}:
        return False
    return key.startswith("sk-ant-")


def _resolve_provider() -> str:
    """
    Probe-based provider resolution.

    Priority:
      1. CODEGRAPH_LLM_PROVIDER env var (explicit), but `llamacpp` falls through
         when the proxy/origin is unreachable
      2. llama.cpp via llm-proxy when /health is reachable
      3. Anthropic when a real API key is present (ReAct needs tool-calling)
      4. Helix when configured (note: Helix cannot bind tools — last-resort)
      5. lmstudio
    """
    llamacpp_url = proxy_base_url()

    explicit = os.getenv("CODEGRAPH_LLM_PROVIDER", "").strip().lower()
    if explicit and explicit not in {"auto", "default"}:
        if explicit == "llamacpp" and not _llamacpp_reachable(llamacpp_url):
            logger.warning(
                "CodeGraph LLM: CODEGRAPH_LLM_PROVIDER=llamacpp but %s unreachable — falling through",
                llamacpp_url,
            )
        else:
            logger.info("CodeGraph LLM: using explicit CODEGRAPH_LLM_PROVIDER=%s", explicit)
            return explicit

    if _llamacpp_reachable(llamacpp_url):
        logger.info("CodeGraph LLM: llm-proxy reachable at %s — using llamacpp", llamacpp_url)
        return "llamacpp"

    if _anthropic_configured():
        logger.info("CodeGraph LLM: local proxy down; Anthropic key present — using anthropic")
        return "anthropic"

    if _helix_configured():
        logger.info("CodeGraph LLM: falling back to helix (no tool-calling)")
        return "helix"

    logger.warning("CodeGraph LLM: falling back to lmstudio")
    return "lmstudio"


def create_codegraph_agent(api_key: str):
    """
    Create a LangGraph ReAct agent for CodeGraph exploration.

    For llamacpp, probes llm-proxy `/health` and pins `model=` to a currently
    healthy tier name so ChatOpenAI hits the running backend via the proxy.
    """
    provider = _resolve_provider()
    model_override = os.getenv("CODEGRAPH_MODEL") or None
    llamacpp_base = proxy_base_url()
    llamacpp_model = os.getenv("LLAMACPP_MODEL", "phi-4-mini-instruct")

    if provider == "llamacpp":
        base, model, reason = resolve_llamacpp_target()
        llamacpp_base = base
        if model:
            model_override = model
            llamacpp_model = model
        logger.info("CodeGraph LLM target: %s", reason)
    elif provider not in {"lmstudio", "anthropic-lmstudio", "groq", "google"}:
        model_override = None
    elif provider == "anthropic":
        if model_override and not model_override.lower().startswith("claude"):
            model_override = None

    llm = get_llm(
        provider=provider,
        model=model_override,
        api_key=api_key,
        llamacpp_base_url=llamacpp_base,
        llamacpp_model=llamacpp_model,
        lmstudio_base_url=os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1"),
        helix_base_url=os.getenv("HELIX_BASE_URL", ""),
        helix_api_key=os.getenv("HELIX_API_KEY", ""),
        helix_environment_id=os.getenv("HELIX_ENVIRONMENT_ID", ""),
        helix_agent_id=os.getenv("HELIX_AGENT_ID", ""),
        helix_prompt_field_id=os.getenv("HELIX_PROMPT_FIELD_ID", ""),
    )
    tools = get_codegraph_tools()
    return create_react_agent(llm, tools, prompt=SYSTEM_PROMPT)
