import pytest
import json
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock


RUN_PAYLOAD = {
    "threadId": "t1",
    "runId": "r1",
    "messages": [{"role": "user", "content": "What are my accounts?"}],
    "tools": [{"name": "get_accounts", "description": "...", "inputSchema": {"type": "object", "properties": {}}}],
    "context": {
        "bffToolUrl": "http://127.0.0.1:3001/internal/agent-tool",
        "sessionId": "sess_abc",
        "initialTokenEvents": [],
        "provider": "openai",
        "model": "gpt-4o",
    },
}


def _parse_sse(text: str) -> list[dict]:
    events = []
    for line in text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events


def test_run_returns_sse_with_run_started_and_finished():
    """POST /run produces at minimum RUN_STARTED and RUN_FINISHED."""
    with patch("src.run_handler.build_agent") as mock_build, \
         patch("src.run_handler.Runner") as mock_runner_cls:
        mock_agent = MagicMock()
        mock_build.return_value = mock_agent

        # Mock the result returned directly by Runner.run_streamed (not a context manager)
        mock_result = MagicMock()

        async def fake_stream_events():
            return
            yield  # make it an async generator

        mock_result.stream_events = fake_stream_events
        mock_result.usage = None  # prevent MagicMock auto-attr from triggering on_usage
        mock_runner_cls.run_streamed.return_value = mock_result

        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD)

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    events = _parse_sse(resp.text)
    types = [e["type"] for e in events]
    assert "RUN_STARTED" in types
    assert "RUN_FINISHED" in types
