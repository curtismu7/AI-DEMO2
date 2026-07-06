"""
LLM factory — Helix, LM Studio (OpenAI/Anthropic-compat), llama.cpp, and none (heuristics-only).

Provider resolution rules (mirrors demo_api_server/services/llmProviderResolver.js):
  - "none"               → returns None; agent falls back to heuristic routing (no LLM required)
  - "helix"              → ChatHelix; requires HELIX_* config
  - "lmstudio"           → ChatOpenAI pointed at LM Studio's OpenAI-compatible endpoint
                           (default: http://localhost:1234/v1); any model loaded in LM Studio.
  - "anthropic-lmstudio" → ChatAnthropic pointed at LM Studio's Anthropic-compatible endpoint
                           (default: http://localhost:1234); uses the Anthropic SDK wire format
                           so the LangGraph tooling chain (function calling, tool_use blocks) works
                           without modification. Dummy API key accepted.
  - "llamacpp"           → ChatOpenAI pointed at llama.cpp's llama-server OpenAI-compatible
                           endpoint. LLAMACPP_BASE_URL is the origin only (default
                           http://127.0.0.1:8090); we append /v1. Native tool-calling, no API key.
                           Use 127.0.0.1 (not localhost) — clients resolve localhost to ::1 where
                           llama-server isn't bound; Python uses the same default for consistency.
  - no provider / unknown → falls back to "none" (heuristic routing)

No other module may inline a provider default.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from langchain_core.language_models.chat_models import BaseChatModel

logger = logging.getLogger(__name__)

def get_llm(
    provider: str = "helix",
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 1000,
    streaming: bool = True,
    lmstudio_base_url: str = "http://localhost:1234/v1",
    anthropic_base_url: str = "",
    llamacpp_base_url: str = "http://127.0.0.1:8090",
    llamacpp_model: str = "phi-4-mini-instruct",
    # Helix-specific kwargs (passed through from LangChainConfig)
    helix_base_url: str = "",
    helix_api_key: str = "",
    helix_environment_id: str = "",
    helix_agent_id: str = "",
    helix_prompt_field_id: str = "",
    **kwargs: Any,
) -> BaseChatModel:
    """
    Return a chat model for the given provider.

    Args:
        provider: "helix" (default), "lmstudio", or "anthropic-lmstudio".
        model: Model name hint (LM Studio; Helix ignores it).
        api_key: Anthropic API key for "anthropic-lmstudio" (any non-empty string works).
        temperature: Sampling temperature (not used by Helix).
        max_tokens: Max tokens to generate.
        streaming: Enable streaming.
        lmstudio_base_url: Base URL for LM Studio endpoint (OpenAI or Anthropic compat).
        helix_*: Helix connection fields.

    Returns:
        A BaseChatModel instance.
    """
    resolved = provider.lower() if provider else "none"

    if resolved == "none":
        logger.info("LLM provider=none — heuristic routing only, no LLM will be used")
        return None

    if resolved == "anthropic-lmstudio":
        # Use the Anthropic SDK wire format pointing at LM Studio's Anthropic-compatible
        # endpoint. The base_url must be the origin only (no /v1 path) — the Anthropic
        # SDK appends /v1/messages itself. LM Studio accepts any non-empty API key.
        resolved_model = model or "local-model"
        # Strip trailing /v1 path if the user provided the OpenAI-style URL
        base = lmstudio_base_url.rstrip("/")
        if base.endswith("/v1"):
            base = base[:-3]
        resolved_api_key = api_key or "lm-studio"
        logger.info(
            "Initializing LLM: provider=anthropic-lmstudio model=%s url=%s",
            resolved_model, base,
        )
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=resolved_model,
            anthropic_api_url=base,
            anthropic_api_key=resolved_api_key,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    if resolved == "anthropic":
        # Real Anthropic cloud — or LM Studio proxy when ANTHROPIC_BASE_URL is set to localhost.
        # anthropic_base_url="" → SDK default (api.anthropic.com); non-empty → override.
        resolved_model = model or "claude-sonnet-4-5"
        resolved_api_key = api_key or "lm-studio"
        base = (anthropic_base_url or "").rstrip("/")
        if base.endswith("/v1"):
            base = base[:-3]
        logger.info(
            "Initializing LLM: provider=anthropic model=%s base=%s",
            resolved_model, base or "api.anthropic.com",
        )
        from langchain_anthropic import ChatAnthropic
        kwargs_anthro = dict(
            model=resolved_model,
            anthropic_api_key=resolved_api_key,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if base:
            kwargs_anthro["anthropic_api_url"] = base
        return ChatAnthropic(**kwargs_anthro)

    if resolved == "lmstudio":
        resolved_model = model or "local-model"
        logger.info("Initializing LLM: provider=lmstudio model=%s url=%s", resolved_model, lmstudio_base_url)
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=resolved_model,
            openai_api_base=lmstudio_base_url,
            openai_api_key="lm-studio",  # LM Studio ignores the key; any non-empty string works
            temperature=temperature,
            max_tokens=max_tokens,
            streaming=streaming,
        )

    if resolved == "llamacpp":
        # Local small LLM via llama.cpp's llama-server (OpenAI-compatible /v1 API with
        # native tool-calling — e.g. Gemma 3). llamacpp_base_url is the origin only; we
        # append /v1. llama-server ignores the API key but the client requires one.
        resolved_model = model or llamacpp_model
        base = llamacpp_base_url.rstrip("/")
        if not base.endswith("/v1"):
            base = base + "/v1"
        logger.info("Initializing LLM: provider=llamacpp model=%s url=%s", resolved_model, base)
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=resolved_model,
            openai_api_base=base,
            openai_api_key="llama-cpp",  # llama-server ignores the key; any non-empty string works
            temperature=temperature,
            max_tokens=max_tokens,
            streaming=streaming,
        )

    if resolved != "helix":
        logger.warning("Unknown LLM provider %r — falling back to none (heuristic routing)", provider)
        return None

    # Reaching here means provider == "helix" explicitly — unknown providers
    # already returned None above (they fall back to heuristic routing, not Helix).
    # Fail fast with a clear error: these tenant-specific fields have no
    # defaults (see LangChainConfig) and ChatHelix would otherwise fail later
    # with an opaque HTTP error against a malformed URL.
    if not helix_environment_id or not helix_prompt_field_id:
        raise ValueError(
            "Helix provider requires HELIX_ENVIRONMENT_ID and HELIX_PROMPT_FIELD_ID "
            "to be set (tenant-specific; no defaults). Set them in the environment "
            "or choose another provider via LANGCHAIN_LLM_PROVIDER."
        )
    logger.info("Initializing LLM: provider=helix agent=%s", helix_agent_id or "(from env)")
    from .helix_llm import ChatHelix
    return ChatHelix(
        helix_base_url=helix_base_url,
        helix_api_key=helix_api_key,
        helix_environment_id=helix_environment_id,
        helix_agent_id=helix_agent_id,
        helix_prompt_field_id=helix_prompt_field_id,
    )
