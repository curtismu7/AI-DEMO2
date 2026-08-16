import pytest
import httpx
import respx
from pydantic_ai import ModelRetry
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
        tool_call_id = "tc-1"

    await tools[0].function(FakeCtx(), userId="u1")

    state_deltas = [e for e in emitted if e["type"] == "STATE_DELTA"]
    assert len(state_deltas) == 2
    assert state_deltas[0] == {
        "type": "STATE_DELTA",
        "delta": [{"op": "add", "path": "/tokenEvents/-", "value": token_events[0]}],
    }
    assert state_deltas[1] == {
        "type": "STATE_DELTA",
        "delta": [{"op": "add", "path": "/tokenEvents/-", "value": token_events[1]}],
    }


@pytest.mark.asyncio
@respx.mock
async def test_emits_tool_call_start_and_end_around_execution():
    """Bug: on_tool_start/on_tool_end were defined on AGUIEmitter but never
    invoked from the tool-execution path, so AGUIEmitter._any_visible_output
    stayed False for a tool-only turn (no trailing text) and on_run_end()
    reported RUN_ERROR even though the tool (e.g. create_transfer) already
    completed its side effect. tool_fn must emit TOOL_CALL_START before the
    BFF call and TOOL_CALL_END after, so AGUIEmitter observes the tool ran."""
    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(200, json={"result": {"ok": True}})
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
        tool_call_id = "tc-2"

    await tools[0].function(FakeCtx(), userId="u1")

    assert emitted[0] == {
        "type": "TOOL_CALL_START",
        "toolCallId": "tc-2",
        "toolName": "get_accounts",
    }
    assert emitted[-1] == {"type": "TOOL_CALL_END", "toolCallId": "tc-2"}


@pytest.mark.asyncio
@respx.mock
async def test_emits_tool_call_end_even_when_tool_call_fails():
    """TOOL_CALL_END must fire in a finally so the UI's tool-call timeline
    entry doesn't stay stuck at status 'running' when the BFF call fails."""
    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(400, text="bad request")
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
        tool_call_id = "tc-3"

    with pytest.raises(ModelRetry):
        await tools[0].function(FakeCtx(), userId="u1")

    assert emitted[0]["type"] == "TOOL_CALL_START"
    assert emitted[-1] == {"type": "TOOL_CALL_END", "toolCallId": "tc-3"}


@pytest.mark.asyncio
@respx.mock
async def test_403_policy_denial_raises_model_retry_with_real_reason():
    """Bug: a 403 tool-call policy denial (e.g. gateway_policy_denied,
    insufficient_scope, a P1AZ-blocked transfer) used to raise a bare
    RuntimeError, which pydantic_ai does not special-case -- it propagated out
    of agent.run_stream() uncaught and was only caught by run_handler's
    generic top-level `except Exception`, which discards the real message and
    emits a generic "internal error" response. It must instead raise
    ModelRetry so the model sees the real denial reason and can explain it
    (or decide what to do next) rather than the run hard-aborting."""
    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(
            403, text='{"error":"gateway_policy_denied","reason":"transfer exceeds daily limit"}'
        )
    )

    tools = build_tool_functions([SCHEMA])

    class FakeDeps:
        bff_tool_url = "http://127.0.0.1:3001/internal/agent-tool"
        bff_internal_secret = "secret"
        session_id = "sess_abc"

    class FakeCtx:
        deps = FakeDeps()
        tool_call_id = "tc-4"

    with pytest.raises(ModelRetry) as exc_info:
        await tools[0].function(FakeCtx(), userId="u1")

    message = str(exc_info.value)
    assert "403" in message
    assert "gateway_policy_denied" in message
    assert "transfer exceeds daily limit" in message


@pytest.mark.asyncio
@respx.mock
async def test_5xx_still_raises_model_retry():
    """Regression: transient server errors must keep raising ModelRetry."""
    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(503, text="service unavailable")
    )

    tools = build_tool_functions([SCHEMA])

    class FakeDeps:
        bff_tool_url = "http://127.0.0.1:3001/internal/agent-tool"
        bff_internal_secret = "secret"
        session_id = "sess_abc"

    class FakeCtx:
        deps = FakeDeps()
        tool_call_id = "tc-5"

    with pytest.raises(ModelRetry):
        await tools[0].function(FakeCtx(), userId="u1")
