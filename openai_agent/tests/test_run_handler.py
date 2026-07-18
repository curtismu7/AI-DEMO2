import pytest
import json
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, AsyncMock

from src.agui_emitter import AGUIEmitter
from guardrails.validator_base import FailResult


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


def test_run_emits_grounding_correction_on_overclaiming_reply():
    """When the reply overclaims relative to tool results, a CUSTOM
    grounding_correction event must appear before RUN_FINISHED."""
    with patch("src.run_handler.build_agent") as mock_build, \
         patch("src.run_handler.Runner") as mock_runner_cls, \
         patch(
             "src.grounding_guardrail.CommitmentGroundingValidator.async_validate",
             new=AsyncMock(
                 return_value=FailResult(
                     error_message="overclaim",
                     fix_value="I've submitted a fee waiver request (ID: fwr-123) for human review.",
                 )
             ),
         ):
        mock_agent = MagicMock()
        mock_build.return_value = mock_agent
        mock_result = MagicMock()

        async def fake_stream_events():
            from agents.stream_events import RawResponsesStreamEvent
            from openai.types.responses import ResponseTextDeltaEvent
            yield RawResponsesStreamEvent(data=ResponseTextDeltaEvent(
                delta="I've waived your fee!", item_id="i1", output_index=0,
                content_index=0, type="response.output_text.delta", sequence_number=1,
                logprobs=[],
            ))

        mock_result.stream_events = fake_stream_events
        mock_result.usage = None
        mock_runner_cls.run_streamed.return_value = mock_result

        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD)

    events = _parse_sse(resp.text)
    custom_events = [e for e in events if e["type"] == "CUSTOM" and e["name"] == "grounding_correction"]
    assert len(custom_events) == 1
    assert "fwr-123" in custom_events[0]["value"]["corrected"]
    run_finished_idx = next(i for i, e in enumerate(events) if e["type"] == "RUN_FINISHED")
    grounding_idx = next(i for i, e in enumerate(events) if e["type"] == "CUSTOM" and e["name"] == "grounding_correction")
    assert grounding_idx < run_finished_idx


def test_run_emits_no_grounding_correction_on_grounded_reply():
    with patch("src.run_handler.build_agent") as mock_build, \
         patch("src.run_handler.Runner") as mock_runner_cls:
        mock_agent = MagicMock()
        mock_build.return_value = mock_agent
        mock_result = MagicMock()

        async def fake_stream_events():
            from agents.stream_events import RawResponsesStreamEvent
            from openai.types.responses import ResponseTextDeltaEvent
            yield RawResponsesStreamEvent(data=ResponseTextDeltaEvent(
                delta="Your checking balance is $1,204.55.", item_id="i1", output_index=0,
                content_index=0, type="response.output_text.delta", sequence_number=1,
                logprobs=[],
            ))

        mock_result.stream_events = fake_stream_events
        mock_result.usage = None
        mock_runner_cls.run_streamed.return_value = mock_result

        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD)

    events = _parse_sse(resp.text)
    custom_events = [e for e in events if e["type"] == "CUSTOM" and e["name"] == "grounding_correction"]
    assert len(custom_events) == 0
