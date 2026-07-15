"""Code Explorer agent — ReAct when tools work; retrieve-then-answer for all LLMs."""

from __future__ import annotations

import logging
import os
import urllib.request
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Literal, Optional

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.prebuilt import create_react_agent

from src.codegraph.tools import get_codegraph_tools
from src.codegraph.llm_target import proxy_base_url, resolve_llamacpp_target
from src.codegraph.retrieve import gather_context
from src.agent.llm_factory import get_llm

logger = logging.getLogger(__name__)

Mode = Literal["react", "retrieve"]

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

RETRIEVE_SYSTEM = """You are a code navigator for the AI-Demo repository (PingOne / MCP / LangChain demo).
Answer ONLY from the CONTEXT pack below — do not invent files or APIs that are not present.
Cite file:line references from the excerpts. Keep answers focused and concrete.
If the context is insufficient, say what is missing instead of guessing."""

# Providers whose native tool-calling is reliable enough for create_react_agent.
_REACT_PROVIDERS = frozenset({
    "anthropic",
    "anthropic-lmstudio",
    "groq",
    "google",
})


def _llamacpp_reachable(base_url: str) -> bool:
    try:
        urllib.request.urlopen(base_url.rstrip("/") + "/health", timeout=2)
        return True
    except Exception:
        return False


def _helix_configured() -> bool:
    return bool(
        os.getenv("HELIX_ENVIRONMENT_ID") and os.getenv("HELIX_PROMPT_FIELD_ID")
    )


def _anthropic_configured() -> bool:
    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key or key in {"sk-ant-api03-placeholder", "test-key", "changeme"}:
        return False
    return key.startswith("sk-ant-")


def _resolve_provider() -> str:
    """Probe-based provider resolution (explicit env wins when reachable)."""
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
        logger.info("CodeGraph LLM: falling back to helix")
        return "helix"

    logger.warning("CodeGraph LLM: falling back to lmstudio")
    return "lmstudio"


def _resolve_mode(provider: str) -> Mode:
    """Choose ReAct vs retrieve-then-answer.

    Override with CODEGRAPH_AGENT_MODE=react|retrieve|auto.
    Default auto: ReAct only for providers with reliable native tool-calling;
    everyone else (Helix, llama.cpp, LM Studio) uses retrieve-then-answer so
    Code Explorer works on all configured LLMs.
    """
    raw = (os.getenv("CODEGRAPH_AGENT_MODE") or "auto").strip().lower()
    if raw in {"react", "retrieve"}:
        return raw  # type: ignore[return-value]
    if provider in _REACT_PROVIDERS:
        return "react"
    return "retrieve"


def _build_llm(provider: str, api_key: str) -> BaseChatModel:
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
    elif provider == "anthropic":
        if model_override and not model_override.lower().startswith("claude"):
            model_override = None
    elif provider not in {"lmstudio", "anthropic-lmstudio", "groq", "google"}:
        model_override = None

    return get_llm(
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


def _last_user_text(messages: list[BaseMessage]) -> str:
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def _chunk_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text") or "")
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return ""


@dataclass
class CodegraphRunner:
    """Unified stream surface for ReAct and retrieve-then-answer modes."""

    mode: Mode
    provider: str
    llm: BaseChatModel
    graph: Optional[Any] = None

    async def astream_sse(self, messages: list[BaseMessage]) -> AsyncGenerator[str, None]:
        import json

        yield f"data: {json.dumps({'type': 'status', 'text': 'Searching the codebase…'})}\n\n"
        try:
            if self.mode == "react" and self.graph is not None:
                async for frame in self._stream_react(messages):
                    yield frame
            else:
                async for frame in self._stream_retrieve(messages):
                    yield frame
        except Exception as exc:
            logger.error("CodeGraph stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'text': str(exc) or type(exc).__name__})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    async def _stream_react(self, messages: list[BaseMessage]) -> AsyncGenerator[str, None]:
        import json
        from langchain_core.messages import AIMessageChunk

        async for msg, _metadata in self.graph.astream(
            {"messages": messages}, stream_mode="messages"
        ):
            if not isinstance(msg, AIMessageChunk):
                yield f"data: {json.dumps({'type': 'status', 'text': 'Reading the code…'})}\n\n"
                continue
            text = _chunk_text(getattr(msg, "content", ""))
            if text:
                yield f"data: {json.dumps({'type': 'token', 'text': text})}\n\n"

    async def _stream_retrieve(self, messages: list[BaseMessage]) -> AsyncGenerator[str, None]:
        import asyncio
        import json

        question = _last_user_text(messages)
        context = await asyncio.to_thread(gather_context, question)
        yield f"data: {json.dumps({'type': 'status', 'text': 'Reading the code…'})}\n\n"

        history: list[BaseMessage] = []
        for msg in messages[:-1]:
            if isinstance(msg, (HumanMessage, AIMessage, SystemMessage)):
                history.append(msg)

        synth = [
            SystemMessage(content=RETRIEVE_SYSTEM),
            *history,
            HumanMessage(
                content=(
                    f"CONTEXT:\n{context}\n\n"
                    f"QUESTION: {question}\n\n"
                    "Answer using only the context. Cite file:line."
                )
            ),
        ]

        # Prefer token streaming; fall back to a single invoke for Helix et al.
        streamed = False
        try:
            async for chunk in self.llm.astream(synth):
                text = _chunk_text(getattr(chunk, "content", ""))
                if text:
                    streamed = True
                    yield f"data: {json.dumps({'type': 'token', 'text': text})}\n\n"
        except Exception as exc:
            logger.info("CodeGraph retrieve astream unavailable (%s) — using invoke", exc)

        if not streamed:
            result = await self.llm.ainvoke(synth)
            text = _chunk_text(getattr(result, "content", "")) or str(result)
            if text:
                yield f"data: {json.dumps({'type': 'token', 'text': text})}\n\n"


def create_codegraph_agent(api_key: str) -> CodegraphRunner:
    """Build a Code Explorer runner for the configured LLM provider."""
    provider = _resolve_provider()
    mode = _resolve_mode(provider)
    llm = _build_llm(provider, api_key)
    graph = None
    if mode == "react":
        try:
            graph = create_react_agent(llm, get_codegraph_tools(), prompt=SYSTEM_PROMPT)
        except Exception as exc:
            logger.warning(
                "CodeGraph ReAct build failed for %s (%s) — falling back to retrieve",
                provider, exc,
            )
            mode = "retrieve"
            graph = None
    logger.info("CodeGraph runner: provider=%s mode=%s", provider, mode)
    return CodegraphRunner(mode=mode, provider=provider, llm=llm, graph=graph)
