import pytest
import json
import os
from unittest.mock import patch, MagicMock

# Provide BFF_INTERNAL_SECRET; AGENT_LLM_* defaults to LM Studio so no key
# is needed. (Regression: the previous test set OPENAI_API_KEY because the
# old config.py crashed at import without it.)
os.environ.setdefault("BFF_INTERNAL_SECRET", "test-secret")

from fastapi.testclient import TestClient

# /run is gated by AuthMiddleware on the shared internal secret; the BFF sends
# this header on every call, so the tests must too or they only exercise the 401.
AUTH_HEADERS = {"x-internal-gateway-secret": "test-secret"}


RUN_PAYLOAD = {
    "threadId": "t1",
    "runId": "r1",
    "messages": [{"role": "user", "content": "What are my accounts?"}],
    "tools": [
        {
            "name": "get_accounts",
            "description": "List accounts",
            "inputSchema": {"type": "object", "properties": {}},
        }
    ],
    "context": {
        "bffToolUrl": "http://127.0.0.1:3001/internal/agent-tool",
        "bffInternalSecret": "secret",
        "sessionId": "sess_abc",
        # Empty model intentionally to exercise the cfg.LLM_MODEL fallback.
        "model": "",
    },
}


def _parse_sse(text: str) -> list[dict]:
    return [
        json.loads(line[6:])
        for line in text.splitlines()
        if line.startswith("data: ")
    ]


def _make_mock_agent(tokens=None):  # type: ignore[no-untyped-def]
    """Return a mock Agent whose run_stream yields the given tokens."""
    tokens = tokens or ["Hello", " world"]

    class FakeStreamResult:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def stream_text(self, delta: bool = False):
            for t in tokens:
                yield t

    mock_agent = MagicMock()
    mock_agent.run_stream.return_value = FakeStreamResult()
    return mock_agent


def test_run_returns_200_with_sse_content_type():
    with patch("src.run_handler.build_agent", return_value=_make_mock_agent()):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


def test_run_emits_run_started_first():
    with patch("src.run_handler.build_agent", return_value=_make_mock_agent()):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    assert events[0]["type"] == "RUN_STARTED"
    assert events[0]["runId"] == "r1"


def test_run_emits_run_finished_last():
    with patch("src.run_handler.build_agent", return_value=_make_mock_agent()):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    assert events[-1]["type"] == "RUN_FINISHED"


def test_run_emits_text_content_events():
    with patch("src.run_handler.build_agent", return_value=_make_mock_agent(["Hello", " world"])):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    content_events = [e for e in events if e["type"] == "TEXT_MESSAGE_CONTENT"]
    assert len(content_events) == 2
    assert "".join(e["delta"] for e in content_events) == "Hello world"


def test_run_emits_run_error_event_on_exception():
    """When the agent raises, the stream must emit RUN_ERROR (not ERROR) so
    the UI dock surfaces the failure instead of rendering an empty pane."""
    mock_agent = MagicMock()
    mock_agent.run_stream.side_effect = RuntimeError("LLM failed")

    with patch("src.run_handler.build_agent", return_value=mock_agent):
        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
    events = _parse_sse(resp.text)
    error_events = [e for e in events if e["type"] == "RUN_ERROR"]
    assert len(error_events) == 1
    assert "LLM failed" in error_events[0]["message"]


def test_run_forwards_llm_provider_config_to_build_agent():
    """build_agent must be called with cfg.LLM_BASE_URL and cfg.LLM_API_KEY,
    not just a bare model URI like 'openai:gpt-4o'. This is the regression
    that broke LM Studio routing."""
    with patch("src.run_handler.build_agent", return_value=_make_mock_agent()) as mock_build:
        from src.main import app
        client = TestClient(app)
        client.post("/run", json=RUN_PAYLOAD, headers=AUTH_HEADERS)
        call_kwargs = mock_build.call_args.kwargs
        assert "base_url" in call_kwargs
        assert "api_key" in call_kwargs
        assert "model_name" in call_kwargs
