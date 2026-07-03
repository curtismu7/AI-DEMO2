import pytest

from src.agui.emitter import AGUIEventEmitter


@pytest.mark.asyncio
async def test_on_llm_detail_emits_custom_event():
    events = []

    async def sink(evt):
        events.append(evt)

    emitter = AGUIEventEmitter("run-1", "thread-1", sink=sink)
    await emitter.on_llm_detail(
        model="qwen2.5-14b-instruct",
        messages=[{"role": "system", "content": "You are a banking assistant." * 100}],
        tool_calls=[{"name": "transfer_funds", "args": {"amount": 250}}],
        usage={"inputTokens": 1842, "outputTokens": 61},
    )

    assert len(events) == 1
    evt = events[0]
    assert evt["type"] == "CUSTOM"
    assert evt["name"] == "llm_detail"
    assert evt["value"]["model"] == "qwen2.5-14b-instruct"
    assert evt["value"]["toolCalls"][0]["name"] == "transfer_funds"
    assert evt["value"]["usage"]["outputTokens"] == 61
    # content truncated to 600 chars
    assert len(evt["value"]["request"]["messages"][0]["content"]) <= 600


@pytest.mark.asyncio
async def test_on_llm_detail_swallows_sink_errors():
    async def bad_sink(evt):
        raise RuntimeError("boom")

    emitter = AGUIEventEmitter("run-1", "thread-1", sink=bad_sink)
    await emitter.on_llm_detail(model="m", messages=[], tool_calls=[], usage=None)
