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
