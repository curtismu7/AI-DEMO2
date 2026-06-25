import pytest
import httpx
import respx
from src.models import BffDeps
from src.bff_tool_adapter import build_tool_functions, BffToolError

SCHEMA = {
    "name": "get_accounts",
    "description": "List accounts",
    "inputSchema": {"type": "object", "properties": {"userId": {"type": "string"}}},
}

DEPS = BffDeps(
    bff_tool_url="http://127.0.0.1:3001/internal/agent-tool",
    bff_internal_secret="secret",
    session_id="sess_abc",
)


def test_build_tool_functions_returns_one_tool():
    tools = build_tool_functions([SCHEMA])
    assert len(tools) == 1


def test_tool_has_correct_name():
    tools = build_tool_functions([SCHEMA])
    assert tools[0].name == "get_accounts"


@pytest.mark.asyncio
@respx.mock
async def test_emits_state_delta_per_token_event():
    """Each tokenEvent in the BFF response produces one STATE_DELTA add patch."""
    from src.bff_tool_adapter import build_tool_functions

    token_events = [{"type": "exchanger-token"}, {"type": "mcp-token"}]
    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(
            200, json={"result": {}, "tokenEvents": token_events}
        )
    )

    emitted: list = []

    async def emit_fn(event: dict) -> None:
        emitted.append(event)

    tools = build_tool_functions([SCHEMA], emit_fn=emit_fn)

    class FakeDeps:
        bff_tool_url = "http://127.0.0.1:3001/internal/agent-tool"
        bff_internal_secret = "secret"
        session_id = "sess_abc"

    class FakeCtx:
        deps = FakeDeps()

    await tools[0].function(FakeCtx(), userId="u1")

    assert len(emitted) == 2
    assert emitted[0] == {
        "type": "STATE_DELTA",
        "delta": [{"op": "add", "path": "/tokenEvents/-", "value": token_events[0]}],
    }
    assert emitted[1] == {
        "type": "STATE_DELTA",
        "delta": [{"op": "add", "path": "/tokenEvents/-", "value": token_events[1]}],
    }
