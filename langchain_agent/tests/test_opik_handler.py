"""Tests for GET /opik/* — read-only Opik view behind the BFF (Trace tab)."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.api.opik_handler as h

app = FastAPI()
app.include_router(h.router, prefix="/opik")
client = TestClient(app)


@pytest.fixture
def keyed(monkeypatch):
    monkeypatch.setenv("OPIK_API_KEY", "k")
    monkeypatch.setenv("OPIK_WORKSPACE", "ws")
    monkeypatch.setenv("OPIK_PROJECT_NAME", "proj")
    h._project_ids.clear()


@pytest.fixture
def unkeyed(monkeypatch):
    monkeypatch.delenv("OPIK_API_KEY", raising=False)


@pytest.mark.parametrize("path", ["/opik/stats", "/opik/traces", "/opik/traces/abc/spans"])
def test_disabled_without_key(unkeyed, path):
    with patch.object(h, "_get", new=AsyncMock(side_effect=AssertionError("no call"))):
        r = client.get(path)
    assert r.status_code == 200 and r.json() == {"enabled": False}


def test_stats_normalised(keyed):
    async def fake(path, **kw):
        if path == "/traces/stats":
            return {"stats": [
                {"name": "trace_count", "value": 3},  # one of these has no usage
                {"name": "duration", "value": {"p50": 100.0, "p90": 900.0}},
                {"name": "usage.prompt_tokens", "value": 4240.0},
                {"name": "usage.completion_tokens", "value": 236.0},
                {"name": "error_count", "value": {"count": 1}},
            ]}
        if path == "/spans/stats":
            return {"stats": [{"name": "span_count", "value": 7}]}
        return {"content": [{"id": "pid", "name": "proj"}]}

    with patch.object(h, "_get", new=AsyncMock(side_effect=fake)):
        d = client.get("/opik/stats?window=1h").json()
    assert d["traces"] == 3 and d["p50_ms"] == 100.0 and d["p90_ms"] == 900.0
    # per-trace averages passed through, never multiplied by trace_count
    assert (d["avg_tokens_in"], d["avg_tokens_out"]) == (4240, 236)
    assert "tokens_in" not in d
    assert d["error_rate"] == pytest.approx(1 / 3) and d["tool_calls"] == 7
    assert d["project_url"] == "https://www.comet.com/opik/ws/projects/pid/traces"


def test_stats_empty_window_has_no_division_error(keyed):
    async def fake(path, **kw):
        return {"content": []} if path == "/projects" else {"stats": []}

    with patch.object(h, "_get", new=AsyncMock(side_effect=fake)):
        d = client.get("/opik/stats").json()
    assert d["traces"] == 0 and d["error_rate"] == 0 and d["project_url"] is None


def test_stats_bad_window_400(keyed):
    assert client.get("/opik/stats?window=9y").status_code == 400
    # 24h was replaced by 3h and 12h; the error names exactly the supported windows.
    old = client.get("/opik/stats?window=24h")
    assert old.status_code == 400
    assert old.json()["error"] == "window must be one of 1h, 3h, 12h, 7d"
    assert client.get("/opik/traces?window=24h").status_code == 400


@pytest.mark.parametrize("window", ["1h", "3h", "12h", "7d"])
def test_each_window_is_accepted_and_echoed(keyed, window):
    async def fake(path, **kw):
        if path == "/traces/stats":
            return {"stats": [{"name": "trace_count", "value": 0}]}
        if path == "/spans/stats":
            return {"stats": []}
        return {"content": [{"id": "pid", "name": "proj"}]}

    with patch.object(h, "_get", new=AsyncMock(side_effect=fake)):
        d = client.get(f"/opik/stats?window={window}").json()
    assert d["window"] == window


def test_upstream_failure_is_502_without_leaking(keyed):
    with patch.object(h, "_get", new=AsyncMock(side_effect=RuntimeError("secret detail"))):
        r = client.get("/opik/stats")
    assert r.status_code == 502 and "secret" not in r.text


def test_traces_drop_prompt_bodies(keyed):
    async def fake(path, **kw):
        if path == "/projects":
            return {"content": []}
        return {"content": [{
            "id": "t1", "name": "LangGraph", "start_time": "s", "duration": 12.5,
            "usage": {"total_tokens": 99}, "span_count": 3, "has_tool_spans": True,
            "input": {"messages": ["SECRET PROMPT"]},
        }]}

    with patch.object(h, "_get", new=AsyncMock(side_effect=fake)):
        r = client.get("/opik/traces?limit=5")
    t = r.json()["traces"][0]
    assert t["total_tokens"] == 99 and t["tool_calls"] is True and t["error"] is False
    assert "SECRET PROMPT" not in r.text


def test_spans_offsets_and_sorting(keyed):
    spans = [
        {"id": "b", "parent_span_id": "a", "name": "tool", "type": "tool",
         "start_time": "2026-10-05T10:00:01.000000Z", "duration": 500},
        {"id": "a", "name": "agent", "type": "general",
         "start_time": "2026-10-05T10:00:00.000000Z", "duration": 2000,
         "error_info": {"message": "x"}, "input": "SECRET"},
    ]
    with patch.object(h, "_get", new=AsyncMock(return_value={"content": spans})):
        r = client.get("/opik/traces/t1/spans")
    d = r.json()
    assert [s["id"] for s in d["spans"]] == ["a", "b"]
    assert d["spans"][1]["offset_ms"] == 1000 and d["total_ms"] == 2000
    assert d["spans"][0]["error"] is True and "SECRET" not in r.text


# --- POST /opik/trace --------------------------------------------------------
def _rec(**kw):
    base = {"name": "bff.nl", "thread_id": "s1", "start_ms": 1700000000000, "end_ms": 1700000000050,
            "tags": ["bff", "source:heuristic"],
            "spans": [{"name": "intent", "type": "general", "start_ms": 1700000000000, "end_ms": 1700000000010,
                       "output": "heuristic:get_balance", "bogus": 1}], "bogus": 1}
    base.update(kw)
    return base


def test_trace_noop_without_key(unkeyed):
    with patch.object(h, "_write_trace", new=AsyncMock(side_effect=AssertionError("no write"))):
        r = client.post("/opik/trace", json=_rec())
    assert r.status_code == 202 and r.json() == {"enabled": False}


def test_trace_rejects_bad_record(keyed):
    assert client.post("/opik/trace", json={"name": "x"}).status_code == 400


def test_trace_accepted_and_written(keyed):
    posted = []

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            posted.append((url, json))

            class R:
                def raise_for_status(self):
                    pass

            return R()

    with patch.object(h.httpx, "AsyncClient", FakeClient):
        r = client.post("/opik/trace", json=_rec())
    assert r.status_code == 202 and r.json()["accepted"] is True
    assert [u.rsplit("/", 1)[-1] for u, _ in posted] == ["batch", "batch"]
    assert [u.rsplit("/", 2)[-2] for u, _ in posted] == ["traces", "spans"]
    t = posted[0][1]["traces"][0]
    assert t["thread_id"] == "s1" and t["tags"] == ["bff", "source:heuristic"] and t["project_name"] == "proj"
    assert t["id"][14] == "7" and "bogus" not in t
    sp = posted[1][1]["spans"][0]
    assert sp["trace_id"] == t["id"] and sp["type"] == "general" and "usage" not in sp and "bogus" not in sp


def test_span_mapping_llm_usage_and_error(keyed):
    rec = _rec(error={"type": "PrivilegePolicyDenied", "message": "denied"}, spans=[
        {"name": "llm", "type": "llm", "start_ms": 1, "end_ms": 2, "model": "m", "provider": "privilege_llm",
         "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}},
        {"name": "partial", "type": "llm", "start_ms": 1, "end_ms": 2, "usage": {"prompt_tokens": 1}},
    ])
    t, spans = h._trace_bodies(rec)
    assert t["error_info"]["exception_type"] == "PrivilegePolicyDenied"
    assert spans[0]["usage"] == {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}
    assert spans[0]["provider"] == "privilege_llm" and "usage" not in spans[1]


def test_span_cap(keyed):
    _, spans = h._trace_bodies(_rec(spans=[{"name": "s", "start_ms": 1, "end_ms": 2}] * 50))
    assert len(spans) == h._MAX_SPANS
