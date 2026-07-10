"""FastAPI routes: CodeGraph Explorer query (SSE) + live index refresh."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, Response
from fastapi.requests import Request
from fastapi.responses import JSONResponse, StreamingResponse
from langchain_core.messages import AIMessageChunk, HumanMessage, AIMessage

from codegraph.agent import create_codegraph_agent
from codegraph.db import CODEGRAPH_DB_PATH
from codegraph.repo import repo_src_root

logger = logging.getLogger(__name__)

router = APIRouter()

_graph_cache: object = None

# Only one re-index may run at a time — the button is unauthenticated (the Code
# Explorer page is public) and the indexer is CPU-heavy, so serialize to avoid
# piling up concurrent scans.
_reindex_lock = asyncio.Lock()


def _index_available() -> bool:
    """True if the CodeGraph DB exists and is non-empty."""
    try:
        db_file = Path(CODEGRAPH_DB_PATH)
        return db_file.is_file() and db_file.stat().st_size > 0
    except OSError:
        return False


def _get_graph():
    global _graph_cache
    if _graph_cache is None:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        _graph_cache = create_codegraph_agent(api_key=api_key)
    return _graph_cache


def _build_messages(question: str, history: list[dict]) -> list:
    """Convert history + question into LangChain message objects."""
    messages = []
    for entry in history:
        role = entry.get("role", "")
        content = entry.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
    messages.append(HumanMessage(content=question))
    return messages


@router.post("/query")
async def codegraph_query(request: Request) -> Response:
    body = await request.json()
    question: str = body.get("question", "").strip()
    if not question:
        return JSONResponse({"error": "question is required"}, status_code=400)

    history: list[dict] = body.get("history") or []

    # Check both failure classes independently so the user sees the real
    # blocker(s): a missing/empty index and an unreachable LLM backend are
    # separate problems — agent creation never touches the index.
    problems: list[str] = []
    if not _index_available():
        problems.append(
            f"CodeGraph index not available (missing or empty at {CODEGRAPH_DB_PATH}) "
            "— use Refresh index to rebuild it"
        )
    graph = None
    try:
        graph = _get_graph()
    except Exception as exc:
        logger.error("Failed to create CodeGraph agent: %s", exc)
        problems.append(
            f"CodeGraph LLM backend unavailable ({exc}) — check the llama.cpp/Helix service"
        )
    if problems:
        return JSONResponse({"error": "; ".join(problems)}, status_code=503)

    messages = _build_messages(question, history)

    return StreamingResponse(
        _stream(graph, messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _stream(graph, messages: list) -> AsyncGenerator[str, None]:
    """Drive the agent graph and yield SSE frames."""
    # Emit an immediate status frame so the client shows activity within ~1s.
    # The ReAct agent does tool-call rounds that produce NO text tokens, and a
    # slow/loaded local LLM can take many seconds before the first token — without
    # this the UI sits on a bare typing indicator and looks frozen.
    yield f"data: {json.dumps({'type': 'status', 'text': 'Searching the codebase…'})}\n\n"
    try:
        async for msg, _metadata in graph.astream(
            {"messages": messages}, stream_mode="messages"
        ):
            # Tool execution / tool results carry no text — surface a heartbeat
            # status so a slow ReAct loop keeps signalling progress.
            if not isinstance(msg, AIMessageChunk):
                yield f"data: {json.dumps({'type': 'status', 'text': 'Reading the code…'})}\n\n"
                continue

            content = msg.content if hasattr(msg, "content") else ""
            if isinstance(content, str) and content:
                yield f"data: {json.dumps({'type': 'token', 'text': content})}\n\n"
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text = block.get("text", "")
                        if text:
                            yield f"data: {json.dumps({'type': 'token', 'text': text})}\n\n"
    except Exception as exc:
        logger.error("CodeGraph stream error: %s", exc)
        yield f"data: {json.dumps({'type': 'error', 'text': str(exc)})}\n\n"
    finally:
        yield f"data: {json.dumps({'type': 'done'})}\n\n"


@router.post("/reindex")
async def codegraph_reindex() -> Response:
    """Rebuild the symbol index from the live source tree.

    The repo is bind-mounted at REPO_SRC_ROOT (/app/live-repo); the indexer is
    told to write to CODEGRAPH_DB_PATH (via --out) — the exact DB the query
    tools read — so no image rebuild or re-stage is needed.
    """
    root = repo_src_root()
    script = root / "scripts" / "build-codegraph.py"
    if not script.is_file():
        return JSONResponse(
            {"error": f"indexer not found at {script}; is the repo mounted at "
                      "REPO_SRC_ROOT?"},
            status_code=503,
        )

    if _reindex_lock.locked():
        return JSONResponse(
            {"error": "A re-index is already running."}, status_code=409
        )

    async with _reindex_lock:
        started = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, str(script), "--out", CODEGRAPH_DB_PATH,
                cwd=str(root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            stdout, _ = await proc.communicate()
        except Exception as exc:
            logger.error("CodeGraph reindex failed to launch: %s", exc)
            return JSONResponse({"error": str(exc)}, status_code=500)

    out = (stdout or b"").decode("utf-8", "replace")
    elapsed_ms = int((time.monotonic() - started) * 1000)

    if proc.returncode != 0:
        logger.error("CodeGraph reindex exited %s:\n%s", proc.returncode, out)
        return JSONResponse(
            {"error": "indexer exited non-zero", "log": out[-2000:]},
            status_code=500,
        )

    # The indexer prints "Indexing N files ..." and "Found M nodes ..." — surface
    # the counts (None if the output format ever changes; never a wrong number).
    nodes = files = None
    m = re.search(r"Found\s+(\d+)\s+nodes", out)
    if m:
        nodes = int(m.group(1))
    m = re.search(r"Indexing\s+(\d+)\s+files", out)
    if m:
        files = int(m.group(1))

    # Drop the cached agent so the next query rebuilds against the fresh DB
    # (and re-probes the LLM provider).
    global _graph_cache
    _graph_cache = None

    logger.info("CodeGraph reindex OK in %sms (nodes=%s)", elapsed_ms, nodes)
    return JSONResponse({"ok": True, "nodes": nodes, "files": files,
                         "durationMs": elapsed_ms})
