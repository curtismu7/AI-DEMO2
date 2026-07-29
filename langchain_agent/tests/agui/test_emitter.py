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


@pytest.mark.asyncio
async def test_hitl_interrupt_terminates_the_run_with_an_interrupt_outcome(emitter):
    """The UI opens its consent modal only on RUN_FINISHED whose outcome is an
    interrupt (useAgentState.js). Without an outcome field that trigger is
    unreachable, so a typed free-text prompt that hits the HITL gate created a
    challenge nobody could approve — the LLM just narrated "pending approval"."""
    await emitter.on_run_start()
    await emitter.on_hitl_interrupt({
        "interruptId": "c1",
        "consentId": "c1",
        "tool": "checkout",
        "reason": "consent",
        "message": "Human approval is required.",
    })

    finished = [e for e in emitter._sink_list if e["type"] == "RUN_FINISHED"]
    assert len(finished) == 1
    assert finished[0]["outcome"]["type"] == "interrupt"
    assert finished[0]["outcome"]["interrupts"][0]["consentId"] == "c1"


@pytest.mark.asyncio
async def test_hitl_interrupt_suppresses_a_trailing_plain_run_finished(emitter):
    """on_run_end() still runs in the /run handler's finally block; it must not
    append a second, outcome-less RUN_FINISHED that clears hitlPending."""
    await emitter.on_run_start()
    await emitter.on_hitl_interrupt({"interruptId": "c1", "tool": "checkout"})
    await emitter.on_run_end()

    finished = [e for e in emitter._sink_list if e["type"] == "RUN_FINISHED"]
    assert len(finished) == 1
    assert "outcome" in finished[0]


@pytest.mark.asyncio
async def test_plain_run_end_carries_no_outcome(emitter):
    """A normal run must stay outcome-less — useAgentState clears hitlPending on
    any RUN_FINISHED that is not an interrupt, and that behavior is relied upon."""
    await emitter.on_run_start()
    await emitter.on_run_end()

    finished = [e for e in emitter._sink_list if e["type"] == "RUN_FINISHED"]
    assert len(finished) == 1
    assert "outcome" not in finished[0]
