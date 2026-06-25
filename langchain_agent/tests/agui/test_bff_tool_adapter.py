import pytest
import httpx
import respx

from src.agui.bff_tool_adapter import build_bff_tools

SCHEMA = {
    "name": "get_accounts",
    "description": "List accounts",
    "inputSchema": {
        "type": "object",
        "properties": {"userId": {"type": "string"}},
        "required": ["userId"],
    },
}

BFF_URL = "http://127.0.0.1:3001/internal/agent-tool"


@pytest.mark.asyncio
@respx.mock
async def test_emits_one_add_op_per_token_event_in_single_delta():
    """All tokenEvents in a response are batched into one STATE_DELTA, one add op each."""
    token_events = [{"type": "exchanger-token"}, {"type": "mcp-token"}]
    respx.post(BFF_URL).mock(
        return_value=httpx.Response(
            200, json={"result": {"accounts": []}, "tokenEvents": token_events}
        )
    )

    emitted: list[dict] = []

    async def sink(event: dict) -> None:
        emitted.append(event)

    tools = build_bff_tools([SCHEMA], BFF_URL, "sess_abc", sink=sink)
    await tools[0]._arun(userId="u1")

    assert len(emitted) == 1
    assert emitted[0] == {
        "type": "STATE_DELTA",
        "delta": [
            {"op": "add", "path": "/tokenEvents/-", "value": token_events[0]},
            {"op": "add", "path": "/tokenEvents/-", "value": token_events[1]},
        ],
    }


@pytest.mark.asyncio
@respx.mock
async def test_error_response_still_emits_token_events():
    """Non-200 bodies carry tokenEvents (e.g. exchange-failed) that are still emitted."""
    err_events = [{"type": "exchange-failed"}]
    respx.post(BFF_URL).mock(
        return_value=httpx.Response(
            502, json={"error": "token_exchange_failed", "tokenEvents": err_events}
        )
    )

    emitted: list[dict] = []

    async def sink(event: dict) -> None:
        emitted.append(event)

    tools = build_bff_tools([SCHEMA], BFF_URL, "sess_abc", sink=sink)
    result = await tools[0]._arun(userId="u1")

    assert "HTTP 502" in result
    assert len(emitted) == 1
    assert emitted[0]["delta"] == [
        {"op": "add", "path": "/tokenEvents/-", "value": err_events[0]},
    ]


@pytest.mark.asyncio
@respx.mock
async def test_multi_tool_calls_accumulate_events():
    """Two sequential tool calls each emit their own add patches (not replace)."""
    respx.post(BFF_URL).mock(
        return_value=httpx.Response(
            200, json={"result": {}, "tokenEvents": [{"type": "t1"}]}
        )
    )

    emitted: list[dict] = []

    async def sink(event: dict) -> None:
        emitted.append(event)

    tools = build_bff_tools([SCHEMA], BFF_URL, "sess_abc", sink=sink)
    await tools[0]._arun(userId="u1")
    await tools[0]._arun(userId="u1")

    # Two calls × one event each = two add patches total (no replace)
    assert len(emitted) == 2
    for ev in emitted:
        assert ev["delta"][0]["op"] == "add"
        assert ev["delta"][0]["path"] == "/tokenEvents/-"
