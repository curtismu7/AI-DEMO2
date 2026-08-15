import pytest
import json
from src.agui_emitter import AGUIEmitter

RUN_ID = "run-1"
THREAD_ID = "thread-1"


@pytest.fixture
def captured():
    events = []

    async def sink(data: str):
        events.append(json.loads(data.removeprefix("data: ").strip()))

    return events, sink


@pytest.mark.asyncio
async def test_run_start_emits_run_started(captured):
    events, sink = captured
    emitter = AGUIEmitter(RUN_ID, THREAD_ID, sink)
    await emitter.on_run_start()
    assert events[0]["type"] == "RUN_STARTED"
    assert events[0]["runId"] == RUN_ID


@pytest.mark.asyncio
async def test_text_token_emits_content(captured):
    events, sink = captured
    emitter = AGUIEmitter(RUN_ID, THREAD_ID, sink)
    await emitter.on_text_token("msg-1", "hello")
    assert events[0]["type"] == "TEXT_MESSAGE_CONTENT"
    assert events[0]["delta"] == "hello"


@pytest.mark.asyncio
async def test_tool_start_emits_tool_call_start(captured):
    events, sink = captured
    emitter = AGUIEmitter(RUN_ID, THREAD_ID, sink)
    await emitter.on_tool_start("tc-1", "get_accounts")
    assert events[0]["type"] == "TOOL_CALL_START"
    assert events[0]["toolName"] == "get_accounts"


@pytest.mark.asyncio
async def test_run_end_after_tool_only_turn_emits_run_finished_not_error(captured):
    """Regression: a tool-only turn (a tool executes, e.g. create_transfer,
    but the model emits no trailing narration text) must not be reported as
    RUN_ERROR -- the tool's side effect already happened, so telling the
    client the run failed risks the user retrying and double-transferring.
    bff_tool_adapter.tool_fn emits a TOOL_CALL_START event (via emit_fn ->
    emitter.emit()) around every tool call; _emit() already treats that event
    type as visible output, so on_run_end() must finish cleanly here even
    though no TEXT_MESSAGE_CONTENT delta was ever emitted."""
    events, sink = captured
    emitter = AGUIEmitter(RUN_ID, THREAD_ID, sink)
    await emitter.emit({"type": "TOOL_CALL_START", "toolCallId": "tc-1", "toolName": "create_transfer"})
    await emitter.emit({"type": "TOOL_CALL_END", "toolCallId": "tc-1"})
    events.clear()

    await emitter.on_run_end()

    assert events[0]["type"] == "RUN_FINISHED"


@pytest.mark.asyncio
async def test_run_end_with_no_output_and_no_tool_call_emits_run_error(captured):
    """Control case: with neither text nor a tool call, on_run_end() must
    still report RUN_ERROR -- only an observed tool call (or text) should
    suppress it."""
    events, sink = captured
    emitter = AGUIEmitter(RUN_ID, THREAD_ID, sink)

    await emitter.on_run_end()

    assert events[0]["type"] == "RUN_ERROR"


@pytest.mark.asyncio
async def test_error_emits_run_error_event(captured):
    """on_error() emits RUN_ERROR (not ERROR). useAgentRun.js only handles
    RUN_ERROR; an ERROR event would leave the dock empty."""
    events, sink = captured
    emitter = AGUIEmitter(RUN_ID, THREAD_ID, sink)
    await emitter.on_error("something failed")
    assert events[0]["type"] == "RUN_ERROR"
    assert events[0]["code"] == "AGENT_ERROR"
    assert events[0]["message"] == "something failed"
    assert events[0]["runId"] == RUN_ID
    assert events[0]["threadId"] == THREAD_ID
