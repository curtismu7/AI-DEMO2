# openai_agent/tests/test_bff_tool_adapter.py
import pytest
import httpx
import respx


TOOL_SCHEMA = {
    "name": "get_accounts",
    "description": "List the user's bank accounts.",
    "inputSchema": {
        "type": "object",
        "properties": {"userId": {"type": "string"}},
        "required": ["userId"],
    },
}

RUN_CONTEXT = {
    "bff_tool_url": "http://127.0.0.1:3001/internal/agent-tool",
    "bff_internal_secret": "secret",
    "session_id": "sess_abc",
}


def test_build_tools_returns_one_callable_per_schema():
    from src.bff_tool_adapter import build_bff_tools
    tools = build_bff_tools([TOOL_SCHEMA], RUN_CONTEXT)
    assert len(tools) == 1


@pytest.mark.asyncio
@respx.mock
async def test_tool_posts_to_bff_and_returns_result():
    """Tool function calls BFF and returns result JSON."""
    from src.bff_tool_adapter import build_bff_tools

    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(200, json={"result": {"accounts": []}})
    )

    tools = build_bff_tools([TOOL_SCHEMA], RUN_CONTEXT)
    result = await tools[0].on_invoke_tool(None, '{"userId": "u1"}')
    assert result is not None


@pytest.mark.asyncio
@respx.mock
async def test_tool_raises_on_bff_error():
    from src.bff_tool_adapter import build_bff_tools, BffToolError

    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(500, json={"error": "internal"})
    )

    tools = build_bff_tools([TOOL_SCHEMA], RUN_CONTEXT)
    with pytest.raises(BffToolError):
        await tools[0].on_invoke_tool(None, '{"userId": "u1"}')


@pytest.mark.asyncio
@respx.mock
async def test_error_response_still_emits_token_events():
    """Non-200 bodies carry tokenEvents (e.g. exchange-failed) that are still emitted."""
    from src.bff_tool_adapter import build_bff_tools, BffToolError

    err_events = [{"type": "exchange-failed"}]
    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(
            502, json={"error": "token_exchange_failed", "tokenEvents": err_events}
        )
    )

    emitted: list = []

    async def sink(event: dict) -> None:
        emitted.append(event)

    tools = build_bff_tools([TOOL_SCHEMA], RUN_CONTEXT, sink=sink)
    with pytest.raises(BffToolError):
        await tools[0].on_invoke_tool(None, '{"userId": "u1"}')

    assert emitted == [
        {
            "type": "STATE_DELTA",
            "delta": [{"op": "add", "path": "/tokenEvents/-", "value": err_events[0]}],
        }
    ]


@pytest.mark.asyncio
@respx.mock
async def test_emits_one_state_delta_with_one_op_per_token_event():
    """All tokenEvents are batched into a single STATE_DELTA, one add op each."""
    from src.bff_tool_adapter import build_bff_tools

    token_events = [{"type": "exchanger-token"}, {"type": "mcp-token"}]
    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(
            200, json={"result": {"accounts": []}, "tokenEvents": token_events}
        )
    )

    emitted: list = []

    async def sink(event: dict) -> None:
        emitted.append(event)

    tools = build_bff_tools([TOOL_SCHEMA], RUN_CONTEXT, sink=sink)
    await tools[0].on_invoke_tool(None, '{"userId": "u1"}')

    assert len(emitted) == 1
    assert emitted[0] == {
        "type": "STATE_DELTA",
        "delta": [
            {"op": "add", "path": "/tokenEvents/-", "value": token_events[0]},
            {"op": "add", "path": "/tokenEvents/-", "value": token_events[1]},
        ],
    }
