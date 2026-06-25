import asyncio
import pytest
from src.agui.emitter import AGUIEventEmitter


@pytest.fixture
def emitter():
    sink = []

    async def collect(event_dict):
        sink.append(event_dict)

    e = AGUIEventEmitter(run_id="run_test", thread_id="thread_test", sink=collect)
    e._sink_list = sink
    return e


@pytest.mark.asyncio
async def test_on_llm_new_token_emits_text_events(emitter):
    await emitter.on_run_start()
    await emitter.on_llm_start()
    await emitter.on_llm_new_token("hello")
    await emitter.on_llm_new_token(" world")
    await emitter.on_llm_end()
    await emitter.on_run_end()

    types = [e["type"] for e in emitter._sink_list]
    assert "RUN_STARTED" in types
    assert "TEXT_MESSAGE_START" in types
    assert "TEXT_MESSAGE_CONTENT" in types
    assert "TEXT_MESSAGE_END" in types
    assert "RUN_FINISHED" in types

    content_events = [e for e in emitter._sink_list if e["type"] == "TEXT_MESSAGE_CONTENT"]
    assert content_events[0]["delta"] == "hello"
    assert content_events[1]["delta"] == " world"


@pytest.mark.asyncio
async def test_on_tool_start_and_end_emits_tool_events(emitter):
    await emitter.on_run_start()
    await emitter.on_tool_start({"name": "get_accounts"}, tool_call_id="tc_abc")
    await emitter.on_tool_end({"output": "[{...}]"}, tool_call_id="tc_abc")
    await emitter.on_run_end()

    types = [e["type"] for e in emitter._sink_list]
    assert "TOOL_CALL_START" in types
    assert "TOOL_CALL_END" in types

    start = next(e for e in emitter._sink_list if e["type"] == "TOOL_CALL_START")
    assert start["toolCallName"] == "get_accounts"
    assert start["toolCallId"] == "tc_abc"
