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
                {"name": "trace_count", "value": 4},
                {"name": "duration", "value": {"p50": 100.0, "p90": 900.0}},
                {"name": "usage.prompt_tokens", "value": 10.0},
                {"name": "usage.completion_tokens", "value": 2.5},
                {"name": "error_count", "value": {"count": 1}},
            ]}
        if path == "/spans/stats":
            return {"stats": [{"name": "span_count", "value": 7}]}
        return {"content": [{"id": "pid", "name": "proj"}]}

    with patch.object(h, "_get", new=AsyncMock(side_effect=fake)):
        d = client.get("/opik/stats?window=1h").json()
    assert d["traces"] == 4 and d["p50_ms"] == 100.0 and d["p90_ms"] == 900.0
    assert (d["tokens_in"], d["tokens_out"]) == (40, 10)
    assert d["error_rate"] == 0.25 and d["tool_calls"] == 7
    assert d["project_url"] == "https://www.comet.com/opik/ws/projects/pid/traces"


def test_stats_empty_window_has_no_division_error(keyed):
    async def fake(path, **kw):
        return {"content": []} if path == "/projects" else {"stats": []}

    with patch.object(h, "_get", new=AsyncMock(side_effect=fake)):
        d = client.get("/opik/stats").json()
    assert d["traces"] == 0 and d["error_rate"] == 0 and d["project_url"] is None


def test_stats_bad_window_400(keyed):
    assert client.get("/opik/stats?window=9y").status_code == 400


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
