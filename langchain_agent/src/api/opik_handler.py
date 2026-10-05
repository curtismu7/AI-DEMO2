"""FastAPI routes: read-only Opik trace view for the embedded agent's Trace tab.

The Opik key lives only in this container (OPIK_API_KEY), so the BFF proxies
here instead of calling Opik itself. Every route returns {"enabled": false}
when the key is unset. Output is compact and normalised — raw Opik traces carry
full prompts, which never leave this module.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter()

_BASE = "https://www.comet.com/opik/api/v1/private"
_WINDOWS = {"1h": timedelta(hours=1), "24h": timedelta(hours=24), "7d": timedelta(days=7)}
_project_ids: dict[str, str] = {}


def _enabled() -> bool:
    return bool(os.getenv("OPIK_API_KEY"))


def _project() -> str:
    return os.getenv("OPIK_PROJECT_NAME") or "ai-demo-langchain"


def _headers() -> dict:
    h = {"Authorization": os.environ["OPIK_API_KEY"]}
    if os.getenv("OPIK_WORKSPACE"):
        h["Comet-Workspace"] = os.environ["OPIK_WORKSPACE"]
    return h


async def _get(path: str, **params) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(_BASE + path, headers=_headers(), params=params)
        r.raise_for_status()
        return r.json()


def _since_filter(window: str, field: str = "start_time") -> str:
    since = datetime.now(timezone.utc) - _WINDOWS[window]
    return json.dumps([{"field": field, "operator": ">", "value": since.strftime("%Y-%m-%dT%H:%M:%SZ")}])


def _stat(stats: list, name: str, default=0):
    for s in stats:
        if s.get("name") == name:
            return s.get("value", default)
    return default


async def _project_url() -> str | None:
    """Link to the project's Traces page in Opik (None when it cannot be resolved)."""
    ws = os.getenv("OPIK_WORKSPACE")
    if not ws:
        return None
    pid = _project_ids.get(_project())
    if not pid:
        found = (await _get("/projects", name=_project())).get("content") or []
        pid = next((p["id"] for p in found if p.get("name") == _project()), None)
        if not pid:
            return None
        _project_ids[_project()] = pid
    return f"https://www.comet.com/opik/{ws}/projects/{pid}/traces"


def _failure(exc: Exception) -> JSONResponse:
    logger.warning("Opik request failed: %s", exc)
    return JSONResponse({"enabled": True, "error": "Opik request failed"}, status_code=502)


@router.get("/stats")
async def opik_stats(window: str = Query("24h")):
    if not _enabled():
        return {"enabled": False}
    if window not in _WINDOWS:
        return JSONResponse({"error": "window must be one of 1h, 24h, 7d"}, status_code=400)
    try:
        flt = _since_filter(window)
        traces = await _get("/traces/stats", project_name=_project(), filters=flt)
        tools = await _get(
            "/spans/stats", project_name=_project(),
            filters=json.dumps(json.loads(flt) + [{"field": "type", "operator": "=", "value": "tool"}]),
        )
        url = await _project_url()
    except Exception as exc:  # network / auth / shape — surfaced as one honest 502
        return _failure(exc)
    st = traces.get("stats", [])
    n = int(_stat(st, "trace_count"))
    dur = _stat(st, "duration", {}) or {}
    err = _stat(st, "error_count", {}) or {}
    errors = int(err.get("count", 0)) if isinstance(err, dict) else 0
    return {
        "enabled": True,
        "window": window,
        "project": _project(),
        "project_url": url,
        "traces": n,
        "p50_ms": dur.get("p50"),
        "p90_ms": dur.get("p90"),
        # Opik reports per-trace averages; totals are average x trace count.
        "tokens_in": round(float(_stat(st, "usage.prompt_tokens")) * n),
        "tokens_out": round(float(_stat(st, "usage.completion_tokens")) * n),
        "errors": errors,
        "error_rate": (errors / n) if n else 0,
        "tool_calls": int(_stat(tools.get("stats", []), "span_count")),
    }


@router.get("/traces")
async def opik_traces(limit: int = Query(20, ge=1, le=50), window: str = Query("24h")):
    if not _enabled():
        return {"enabled": False}
    if window not in _WINDOWS:
        return JSONResponse({"error": "window must be one of 1h, 24h, 7d"}, status_code=400)
    try:
        data = await _get("/traces", project_name=_project(), size=limit, filters=_since_filter(window))
        url = await _project_url()
    except Exception as exc:
        return _failure(exc)
    return {
        "enabled": True,
        "project_url": url,
        "traces": [
            {
                "id": t["id"],
                "name": t.get("name"),
                "start_time": t.get("start_time"),
                "duration_ms": t.get("duration"),
                "total_tokens": (t.get("usage") or {}).get("total_tokens"),
                "span_count": t.get("span_count"),
                "tool_calls": bool(t.get("has_tool_spans")),
                "error": bool(t.get("error_info")),
            }
            for t in data.get("content", [])
        ],
    }


def _ms(ts: str) -> float:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000


@router.get("/traces/{trace_id}/spans")
async def opik_spans(trace_id: str):
    if not _enabled():
        return {"enabled": False}
    try:
        data = await _get("/spans", project_name=_project(), trace_id=trace_id, size=200)
    except Exception as exc:
        return _failure(exc)
    raw = [s for s in data.get("content", []) if s.get("start_time")]
    if not raw:
        return {"enabled": True, "total_ms": 0, "spans": []}
    t0 = min(_ms(s["start_time"]) for s in raw)
    spans = [
        {
            "id": s["id"],
            "parent_id": s.get("parent_span_id"),
            "name": s.get("name"),
            "type": s.get("type"),
            "model": s.get("model"),
            "offset_ms": _ms(s["start_time"]) - t0,
            "duration_ms": s.get("duration") or 0,
            "tokens": (s.get("usage") or {}).get("total_tokens"),
            "error": bool(s.get("error_info")),
        }
        for s in raw
    ]
    spans.sort(key=lambda s: s["offset_ms"])
    return {"enabled": True, "total_ms": max(s["offset_ms"] + s["duration_ms"] for s in spans), "spans": spans}
