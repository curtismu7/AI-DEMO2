import pytest
from src.agui.emitter import AGUIEventEmitter


@pytest.mark.asyncio
async def test_on_grounding_correction_emits_custom_event():
    events = []

    async def sink(evt):
        events.append(evt)

    emitter = AGUIEventEmitter("run-1", "thread-1", sink=sink)
    await emitter.on_grounding_correction(
        original="I've waived your fee!",
        corrected="I've submitted a fee waiver request (ID: fwr-123) for human review.",
        note="Reply claimed a completed action beyond what the tool results support.",
    )

    assert len(events) == 1
    evt = events[0]
    assert evt["type"] == "CUSTOM"
    assert evt["name"] == "grounding_correction"
    assert evt["value"]["original"] == "I've waived your fee!"
    assert "fwr-123" in evt["value"]["corrected"]
    assert evt["value"]["correctionNote"]
