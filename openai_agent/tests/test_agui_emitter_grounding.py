import pytest
from src.agui_emitter import AGUIEmitter


@pytest.mark.asyncio
async def test_on_grounding_correction_emits_custom_event():
    events = []

    async def sink(evt):
        events.append(evt)

    emitter = AGUIEmitter("run-1", "thread-1", sink)
    await emitter.on_grounding_correction(
        original="I've waived your fee!",
        corrected="I've submitted a fee waiver request (ID: fwr-123) for human review.",
        note="overclaim",
    )
    assert len(events) == 1
    assert events[0]["type"] == "CUSTOM"
    assert events[0]["name"] == "grounding_correction"
    assert "fwr-123" in events[0]["value"]["corrected"]


@pytest.mark.asyncio
async def test_emitter_accumulates_turn_reply_text_and_tool_calls():
    async def noop_sink(evt):
        pass

    emitter = AGUIEmitter("run-1", "thread-1", noop_sink)
    await emitter.on_llm_start()
    await emitter.on_llm_token("I've ")
    await emitter.on_llm_token("waived your fee!")
    assert emitter._turn_reply_text == "I've waived your fee!"

    await emitter.on_tool_start("request_fee_waiver", "call_1", '{"account_id": "acc_1"}')
    await emitter.on_tool_end("call_1", '{"requestId": "fwr-123", "status": "logged_for_review"}')
    assert len(emitter._turn_tool_calls) == 1
    assert emitter._turn_tool_calls[0].name == "request_fee_waiver"
    assert "fwr-123" in emitter._turn_tool_calls[0].result
