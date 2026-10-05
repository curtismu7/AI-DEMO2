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
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, BackgroundTasks, Query, Request
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
        # Opik averages usage over only the traces that report it, so a total
        # (avg x trace_count) would overcount; expose the average itself.
        "avg_tokens_in": round(float(_stat(st, "usage.prompt_tokens"))),
        "avg_tokens_out": round(float(_stat(st, "usage.completion_tokens"))),
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


# --- POST /trace: BFF chat-turn records (slice 1) ---------------------------
# The BFF has no Opik key, so it posts one compact record per chat turn here and
# we write it as a trace + spans. Metadata-only is the BFF's call; this route
# stores whatever input/output it is given (truncated). Never raises to caller.
_MAX_SPANS = 20
_MAX_TEXT = 2000
_SPAN_TYPES = {"llm", "tool", "general"}
_USAGE_KEYS = ("prompt_tokens", "completion_tokens", "total_tokens")


def _uuid7(ms: int) -> str:
    """UUIDv7 for epoch-ms (Opik wants time-ordered ids; python < 3.14 has no uuid7)."""
    h = (ms & (2**48 - 1)) << 80 | 0x7 << 76 | secrets.randbits(12) << 64 | 0b10 << 62 | secrets.randbits(62)
    s = f"{h:032x}"
    return f"{s[:8]}-{s[8:12]}-{s[12:16]}-{s[16:20]}-{s[20:]}"


def _iso(ms) -> str:
    return datetime.fromtimestamp(float(ms) / 1000, timezone.utc).isoformat().replace("+00:00", "Z")


def _txt(v):
    return None if v is None else str(v)[:_MAX_TEXT]


def _err(e) -> dict | None:
    if not isinstance(e, dict):
        return None
    return {"exception_type": _txt(e.get("type")) or "Error", "traceback": _txt(e.get("message")) or ""}


def _trace_bodies(rec: dict) -> tuple[dict, list[dict]]:
    """Map the compact record to Opik trace + span batch bodies. Unknown fields are ignored."""
    start, end = float(rec["start_ms"]), float(rec["end_ms"])
    tid = _uuid7(int(start))
    trace = {
        "id": tid, "project_name": _project(), "name": _txt(rec.get("name")) or "bff",
        "start_time": _iso(start), "end_time": _iso(end),
        "tags": [str(t)[:64] for t in (rec.get("tags") or [])[:20]],
        "thread_id": _txt(rec.get("thread_id")),
    }
    for k in ("input", "output"):
        if rec.get(k) is not None:
            trace[k] = {k: _txt(rec[k])}
    if _err(rec.get("error")):
        trace["error_info"] = _err(rec["error"])
    spans = []
    for sp in (rec.get("spans") or [])[:_MAX_SPANS]:
        s0, s1 = float(sp["start_ms"]), float(sp["end_ms"])
        out = {
            "id": _uuid7(int(s0)), "trace_id": tid, "project_name": _project(),
            "name": _txt(sp.get("name")) or "span",
            "type": sp.get("type") if sp.get("type") in _SPAN_TYPES else "general",
            "start_time": _iso(s0), "end_time": _iso(s1),
        }
        for k in ("model", "provider"):
            if sp.get(k):
                out[k] = _txt(sp[k])
        u = sp.get("usage")  # omitted unless complete: heuristic traces must not skew token averages
        if isinstance(u, dict) and all(isinstance(u.get(k), int) for k in _USAGE_KEYS):
            out["usage"] = {k: u[k] for k in _USAGE_KEYS}
        for k in ("input", "output"):
            if sp.get(k) is not None:
                out[k] = {k: _txt(sp[k])}
        if _err(sp.get("error")):
            out["error_info"] = _err(sp["error"])
        spans.append(out)
    return trace, spans


async def _write_trace(rec: dict) -> None:
    try:
        trace, spans = _trace_bodies(rec)
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(_BASE + "/traces/batch", headers=_headers(), json={"traces": [trace]})
            r.raise_for_status()
            if spans:
                r = await client.post(_BASE + "/spans/batch", headers=_headers(), json={"spans": spans})
                r.raise_for_status()
    except Exception as exc:  # fire-and-forget: log, never raise
        logger.warning("Opik trace write failed: %s", exc)


@router.post("/trace", status_code=202)
async def opik_trace(request: Request, background: BackgroundTasks):
    if not _enabled():
        return JSONResponse({"enabled": False}, status_code=202)
    try:
        rec = await request.json()
        _trace_bodies(rec)  # validate shape now: a bad record is a 400, not a silent drop
    except Exception:
        return JSONResponse({"error": "invalid trace record"}, status_code=400)
    background.add_task(_write_trace, rec)
    return {"enabled": True, "accepted": True}
