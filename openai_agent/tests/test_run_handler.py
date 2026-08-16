import pytest
import json
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, AsyncMock

from src.agui_emitter import AGUIEmitter
from src.run_handler import _handle_sdk_event
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


@pytest.mark.asyncio
async def test_handle_sdk_event_extracts_tool_call_id_name_args_from_pydantic_raw_item():
    """Regression test for the bug where `item.raw_item` for a real function-tool
    call is a pydantic model (ResponseFunctionToolCall), never a dict, so the old
    `isinstance(raw, dict)` check always failed -- every tool-call start got
    name="unknown", args="{}", and a random UUID as toolCallId, and start/end
    ids never matched (breaking the grounding guardrail and the UI timeline).
    """
    from agents.items import ToolCallItem, ToolCallOutputItem
    from agents.stream_events import RunItemStreamEvent
    from openai.types.responses import ResponseFunctionToolCall

    collected = []

    async def sink(event):
        collected.append(event)

    emitter = AGUIEmitter(run_id="r1", thread_id="t1", sink=sink)
    fake_agent = MagicMock()

    # Start item: raw_item is a real pydantic model, as produced by the SDK for
    # every actual function-tool call (e.g. transfer_funds, get_accounts).
    raw_start = ResponseFunctionToolCall(
        call_id="call_abc123",
        name="transfer_funds",
        arguments='{"amount": 50, "toAccount": "savings"}',
        type="function_call",
    )
    start_item = ToolCallItem(agent=fake_agent, raw_item=raw_start)
    start_event = RunItemStreamEvent(item=start_item, name="tool_called")
    await _handle_sdk_event(start_event, emitter)

    tool_start = next(e for e in collected if e["type"] == "TOOL_CALL_START")
    assert tool_start["toolCallId"] == "call_abc123"
    assert tool_start["toolCallName"] == "transfer_funds"
    args_event = next(e for e in collected if e["type"] == "TOOL_CALL_ARGS")
    assert args_event["delta"] == '{"amount": 50, "toAccount": "savings"}'

    # End item: raw_item carries the same call_id (dict-shaped, matching what
    # ItemHelpers.tool_call_output_item builds) -- ids must match the start.
    raw_end = {"call_id": "call_abc123", "output": "ok", "type": "function_call_output"}
    end_item = ToolCallOutputItem(agent=fake_agent, raw_item=raw_end, output="ok")
    end_event = RunItemStreamEvent(item=end_item, name="tool_output")
    await _handle_sdk_event(end_event, emitter)

    tool_end = next(e for e in collected if e["type"] == "TOOL_CALL_END")
    assert tool_end["toolCallId"] == "call_abc123"

    # The pending tool call must have been popped (matched) rather than lost --
    # this is what the grounding guardrail's _turn_tool_calls depends on.
    assert emitter._pending_tool_calls == {}
    assert len(emitter._turn_tool_calls) == 1
    assert emitter._turn_tool_calls[0].name == "transfer_funds"
