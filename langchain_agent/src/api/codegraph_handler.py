"""FastAPI routes: CodeGraph Explorer query (SSE) + live index refresh."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import time

from fastapi import APIRouter, Response
from fastapi.requests import Request
from fastapi.responses import JSONResponse, StreamingResponse
from codegraph.agent import create_codegraph_agent
from codegraph.db import CODEGRAPH_DB_PATH
from codegraph.ensure_index import (
    ensure_query_index,
    query_db_path,
    resolve_indexer_script,
)
from codegraph.index_guard import (
    inspect_demo_index,
    require_demo_db_path,
)
from codegraph.repo import repo_src_root

logger = logging.getLogger(__name__)

router = APIRouter()

_runner_cache: object = None
_runner_cache_key: object = None

# Only one re-index may run at a time — the button is unauthenticated (the Code
# Explorer page is public) and the indexer is CPU-heavy, so serialize to avoid
# piling up concurrent scans.
_reindex_lock = asyncio.Lock()


def _index_available() -> bool:
    """True if the Code Explorer query DB passes hardening checks.

    Self-heals first (demo-codegraph.db only — never the host product DB).
    """
    if require_demo_db_path(query_db_path()):
        return False
    ensure_query_index()
    return inspect_demo_index(query_db_path(), repo_root=repo_src_root()).get("ok", False)


def _get_runner():
    global _runner_cache, _runner_cache_key
    # Rebuild when the Anthropic key or llm-proxy model env changes.
    key = (os.getenv("ANTHROPIC_API_KEY", ""), os.getenv("LLAMACPP_MODEL", ""), os.getenv("LLAMACPP_BASE_URL", ""))
    if _runner_cache is None or _runner_cache_key != key:
        _runner_cache = create_codegraph_agent()
        _runner_cache_key = key
    return _runner_cache


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
    runner = None
    try:
        runner = _get_runner()
    except Exception as exc:
        logger.error("Failed to create CodeGraph agent: %s", exc)
        problems.append(
            f"CodeGraph LLM backend unavailable ({exc}) — check the llama.cpp/Helix service"
        )
    if problems:
        return JSONResponse({"error": "; ".join(problems)}, status_code=503)

    return StreamingResponse(
        runner.astream_sse(question, history),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/reindex")
async def codegraph_reindex() -> Response:
    """Rebuild the symbol index from the live source tree.

    After a successful run, hardening checks must pass (builder marker, no
    nested `live-repo/` paths, non-zero UI + API coverage) or the Refresh fails.
    """
    path_err = require_demo_db_path(CODEGRAPH_DB_PATH)
    if path_err:
        return JSONResponse({"error": path_err}, status_code=500)

    root = repo_src_root()
    script = resolve_indexer_script(root)
    if script is None:
        return JSONResponse(
            {"error": f"indexer not found under {root}/scripts or "
                      "/app/indexer; is the repo mounted at REPO_SRC_ROOT?"},
            status_code=503,
        )

    if _reindex_lock.locked():
        return JSONResponse(
            {"error": "A re-index is already running."}, status_code=409
        )

    async with _reindex_lock:
        started = time.monotonic()
        try:
            # Pass root explicitly — the baked /app/indexer copy resolves its
            # default REPO_ROOT to /app, which would nest paths as live-repo/...
            # and break read_file under REPO_SRC_ROOT=/app/live-repo.
            env = {**os.environ, "REPO_SRC_ROOT": str(root)}
            env.pop("CODEGRAPH_INDEX_ALL", None)  # Refresh stays UI+API scoped
            proc = await asyncio.create_subprocess_exec(
                sys.executable, str(script), str(root), "--out", CODEGRAPH_DB_PATH,
                cwd=str(root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
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

        info = inspect_demo_index(query_db_path(), repo_root=root)
        if not info.get("ok"):
            logger.error("CodeGraph reindex produced unusable index: %s", info.get("error"))
            return JSONResponse(
                {
                    "error": info.get("error") or "index failed hardening checks",
                    "log": out[-2000:],
                },
                status_code=500,
            )

        nodes = info.get("nodes")
        files = info.get("files")
        m = re.search(r"Found\s+(\d+)\s+nodes", out)
        if m:
            nodes = int(m.group(1))
        m = re.search(r"Indexing\s+(\d+)\s+files", out)
        if m:
            files = int(m.group(1))

        global _runner_cache, _runner_cache_key
        _runner_cache = None
        _runner_cache_key = None

        logger.info(
            "CodeGraph reindex OK in %sms (nodes=%s ui=%s api=%s indexer=%s)",
            elapsed_ms, nodes, info.get("uiFiles"), info.get("apiFiles"), script,
        )
        return JSONResponse({
            "ok": True,
            "nodes": nodes,
            "files": files,
            "uiFiles": info.get("uiFiles"),
            "apiFiles": info.get("apiFiles"),
            "samplePath": info.get("samplePath"),
            "durationMs": elapsed_ms,
        })
