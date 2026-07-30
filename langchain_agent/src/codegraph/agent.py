"""Code Explorer — pydantic-ai ReAct agent backed by the local llm-proxy (llama / omlx)."""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Optional

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart
from pydantic_ai.settings import ModelSettings

from src.codegraph import db, repo

logger = logging.getLogger(__name__)

# SSE keepalive interval so proxies/ALBs don't idle-close during slow LLM warmup.
KEEPALIVE_SECONDS = 10.0

SYSTEM_PROMPT = """You are a code navigator for the AI-Demo repository — a multi-vertical AI agent \
security demo built on PingOne, MCP, and LangChain. The repo contains:
- demo_api_server: Node.js BFF (mcpGatewayClient.callToolViaGateway is the BFF→MCP-gateway HTTP chokepoint)
- demo_mcp_gateway / demo_mcp_server: MCP protocol services
- langchain_agent: Python LangChain agent
- demo_api_ui: React frontend
- demo_authz_server: mock PingOne Authorize

For "How does the MCP gateway work?" start with mcpGatewayClient.js and \
demo_mcp_gateway authorize/router — not UI tests.

Answer ONLY from real code you have looked up. Recommended flow:
1. `grep` with a keyword from the question (an identifier, route, or config key) \
to LOCATE the relevant files — this is your strongest tool.
2. `read_file` on the most relevant hit (optionally a ':start:end' line window) \
to read the ACTUAL implementation you will explain.
3. `codegraph_search` / `codegraph_callers` / `codegraph_callees` to trace \
structure ("what calls X", "what does X call") when the question is about flow.
Always cite file:line references. Keep answers focused and concrete. If grep \
finds nothing, try a synonym or a broader pattern before giving up."""

# ── Tool constants ────────────────────────────────────────────────────────────

_TRUNCATE_AT = 3970
_TRUNCATE_SUFFIX = "\n... (truncated)"
_READ_MAX_CHARS = 8000
_GREP_MAX_PER_FILE = 2
_GREP_MAX_FILES = 40
_GREP_MAX_CHARS = 6000


def _fmt(rows: list[dict], *, call_line: bool = False) -> str:
    if not rows:
        return "No results found."
    parts = []
    for row in rows:
        entry = (
            f"{row.get('name', '')} ({row.get('kind', '')}) — "
            f"{row.get('file_path', '')}:{row.get('start_line', '')}"
        )
        if call_line:
            entry += f" (calls at line {row.get('call_line', '')})"
        parts.append(entry)
    result = "\n".join(parts)
    if len(result) > 4000:
        result = result[:_TRUNCATE_AT] + _TRUNCATE_SUFFIX
    return result


# ── Tool implementations (plain functions — no RunContext needed) ─────────────

def grep(pattern: str) -> str:
    """Search the repo source with a regular expression; returns matching lines as 'file:line: text'. \
Use this first to locate code by identifier name, route string, or config key."""
    try:
        rx = re.compile(pattern, re.IGNORECASE)
    except re.error as exc:
        return f"Invalid regex: {exc}"
    root = repo.repo_src_root()
    lines: list[str] = []
    files_matched = 0
    for path in repo.iter_source_files(root):
        if files_matched >= _GREP_MAX_FILES:
            break
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:
            continue
        file_hits: list[str] = []
        if rx.search(rel):
            file_hits.append(f"{rel}:0: (filename match)")
        try:
            with path.open(encoding="utf-8", errors="replace") as fh:
                for n, line in enumerate(fh, 1):
                    if rx.search(line):
                        file_hits.append(f"{rel}:{n}: {line.rstrip()}")
                        if len(file_hits) >= _GREP_MAX_PER_FILE + 1:
                            break
        except OSError:
            continue
        if file_hits:
            lines.extend(file_hits)
            files_matched += 1
    if not lines:
        return "No matches found."
    result = "\n".join(lines)
    if len(result) > _GREP_MAX_CHARS:
        result = result[:_GREP_MAX_CHARS - len(_TRUNCATE_SUFFIX)] + _TRUNCATE_SUFFIX
    return result


def read_file(path: str) -> str:
    """Read actual source of a repo file. Input: repo-relative path, optionally with \
line range as 'path:start:end' e.g. 'demo_api_server/services/mcpGatewayClient.js:140:175'. \
Use after grep or codegraph_search gives you a file:line."""
    spec = path.strip()
    start = end = None
    m = re.match(r"^(.*?):(\d+):(\d+)$", spec)
    if m:
        spec, start, end = m.group(1), int(m.group(2)), int(m.group(3))
    target = repo.resolve_in_root(spec)
    if target is None:
        return f"File not found or outside repo: {spec}"
    raw = target.read_text(encoding="utf-8", errors="replace").splitlines()
    if start is not None:
        s = max(1, start)
        e = min(len(raw), end)
        window, offset = raw[s - 1:e], s
    else:
        window, offset = raw, 1
    numbered = "\n".join(f"{offset + i}\t{ln}" for i, ln in enumerate(window))
    if len(numbered) > _READ_MAX_CHARS:
        numbered = numbered[:_READ_MAX_CHARS - len(_TRUNCATE_SUFFIX)] + _TRUNCATE_SUFFIX
    return numbered or "(empty file)"


def codegraph_search(term: str) -> str:
    """Search for a code symbol by name; returns qualified names and file:line locations."""
    return _fmt(db.search(term))


def codegraph_callers(symbol: str) -> str:
    """Find all code locations that call a given symbol. Input: exact symbol name."""
    return _fmt(db.callers(symbol), call_line=True)


def codegraph_callees(symbol: str) -> str:
    """Find all symbols called by a given function. Input: exact symbol name."""
    return _fmt(db.callees(symbol), call_line=True)


# ── Model selection ───────────────────────────────────────────────────────────

def _anthropic_configured() -> bool:
    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    return bool(key) and key not in {"sk-ant-api03-placeholder", "test-key", "changeme"} and key.startswith("sk-ant-")


def _resolve_model():
    """Pick model: Anthropic if key is present, else the local llm-proxy (llama / omlx)."""
    if _anthropic_configured():
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider
        key = os.getenv("ANTHROPIC_API_KEY", "")
        model_name = os.getenv("CODEGRAPH_MODEL", "claude-haiku-4-5")
        if not model_name.startswith("claude"):
            model_name = "claude-haiku-4-5"
        logger.info("CodeGraph LLM: Anthropic %s", model_name)
        return AnthropicModel(model_name, provider=AnthropicProvider(api_key=key or None))
    # Default: local llm-proxy at :8090 routes to llama.cpp (Linux/x86) or omlx (Apple Silicon).
    base_url = (
        os.getenv("CODEGRAPH_LLAMACPP_BASE_URL")
        or os.getenv("LLAMACPP_BASE_URL")
        or "http://host.docker.internal:8090/v1"
    )
    model_name = os.getenv("LLAMACPP_MODEL", "gpt-oss-20b")
    logger.info("CodeGraph LLM: llm-proxy %s at %s", model_name, base_url)
    return OpenAIModel(
        model_name=model_name,
        provider=OpenAIProvider(base_url=base_url, api_key="llama-cpp"),
    )


# ── Agent + runner ────────────────────────────────────────────────────────────

def _build_agent() -> Agent:
    model = _resolve_model()
    agent = Agent(
        model,
        system_prompt=SYSTEM_PROMPT,
        tools=[grep, read_file, codegraph_search, codegraph_callers, codegraph_callees],
        defer_model_check=True,
    )
    return agent


def _to_msg_history(history: list[dict]) -> list:
    """Convert [{role, content}] dicts to pydantic-ai ModelMessage objects."""
    msgs = []
    for entry in history:
        content = entry.get("content", "") or ""
        if not content:
            continue
        if entry.get("role") == "assistant":
            msgs.append(ModelResponse(parts=[TextPart(content=content)]))
        else:
            msgs.append(ModelRequest(parts=[UserPromptPart(content=content)]))
    return msgs


@dataclass
class CodegraphRunner:
    agent: Agent

    async def astream_sse(self, question: str, history: list[dict]) -> AsyncGenerator[str, None]:
        import asyncio

        yield f"data: {json.dumps({'type': 'status', 'text': 'Searching the codebase\u2026'})}\n\n"
        msg_history = _to_msg_history(history)
        queue: asyncio.Queue = asyncio.Queue()

        async def _produce() -> None:
            try:
                async with self.agent.run_stream(
                    question,
                    message_history=msg_history or None,
                    model_settings=ModelSettings(timeout=120.0),
                ) as result:
                    first_token = True
                    async for delta in result.stream_text(delta=True):
                        if first_token:
                            await queue.put(("status", "Reading the code\u2026"))
                            first_token = False
                        await queue.put(("token", delta))
            except Exception as exc:
                logger.error("CodeGraph stream error: %s", exc)
                await queue.put(("error", str(exc) or type(exc).__name__))
            finally:
                await queue.put(("done", None))

        producer = asyncio.create_task(_produce())
        try:
            while True:
                try:
                    kind, payload = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_SECONDS)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if kind == "token":
                    yield f"data: {json.dumps({'type': 'token', 'text': payload})}\n\n"
                elif kind == "status":
                    yield f"data: {json.dumps({'type': 'status', 'text': payload})}\n\n"
                elif kind == "error":
                    yield f"data: {json.dumps({'type': 'error', 'text': payload})}\n\n"
                    break
                elif kind == "done":
                    break
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            if not producer.done():
                producer.cancel()
                try:
                    await producer
                except asyncio.CancelledError:
                    pass


def create_codegraph_agent() -> CodegraphRunner:
    """Build a Code Explorer runner."""
    agent = _build_agent()
    return CodegraphRunner(agent=agent)

