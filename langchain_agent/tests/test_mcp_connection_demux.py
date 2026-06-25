"""
CR-06 leak-proof tests: JSON-RPC id correlation on the shared MCP connection.

These tests prove the cross-session response-leak (a caller receiving another
caller's response on the pooled, reused-across-sessions connection) is closed:

1. Two concurrent call_tool() invocations on the SAME connection, server
   responds OUT OF ORDER (2nd request first) with a delay — each caller still
   gets the response whose JSON-RPC id matches its own request.
2. Connection closes mid-flight with N pending requests — all N futures reject
   promptly with the typed MCPConnectionClosedError (no hang).
3. A notification / id-less frame interleaved with responses does not resolve
   or corrupt any pending waiter.
4. Happy path: a single call_tool() still works end to end.
"""
import asyncio
import json
from unittest.mock import patch

import pytest

from src.mcp.connection import (
    MCPConnection,
    MCPConnectionClosedError,
    MCPRequestTimeoutError,
    MCPServerCancelledError,
    ConnectionState,
)
from src.models.mcp import (
    MCPServerConfig,
    AuthRequirements,
    AuthRequirementType,
    MCPToolCall,
)
from src.models.auth import AccessToken
from datetime import datetime


def _server_config():
    return MCPServerConfig(
        name="bank-shared",
        endpoint="ws://localhost:8080/mcp",
        capabilities=["tool_execution"],
        auth_requirements=AuthRequirements(
            type=AuthRequirementType.AGENT_TOKEN, scopes=["read", "write"]
        ),
    )


def _tool_call(arg_value: str):
    token = AccessToken(
        token="agent-token-abc",
        token_type="Bearer",
        expires_in=3600,
        scope="read write",
        issued_at=datetime.now(),
    )
    return MCPToolCall(
        tool_name="get_accounts",
        parameters={"marker": arg_value},
        agent_token=token,
        user_auth_code=None,
        session_id=f"session-{arg_value}",
    )


class FakeReorderingWebSocket:
    """A fake WS that the reader can recv() from.

    send() records the outbound JSON-RPC frame. Tests then push response
    frames onto an internal queue in whatever (possibly out-of-order) sequence
    they choose; recv() drains that queue. close()/raising is supported to
    simulate mid-flight disconnects.
    """

    def __init__(self):
        self.sent: list = []
        self._inbox: "asyncio.Queue" = asyncio.Queue()
        self._closed = False

    async def send(self, raw: str):
        self.sent.append(json.loads(raw))

    async def recv(self):
        if self._closed:
            from websockets.exceptions import ConnectionClosed

            raise ConnectionClosed(None, None)
        frame = await self._inbox.get()
        if frame is _CLOSE_SENTINEL:
            from websockets.exceptions import ConnectionClosed

            self._closed = True
            raise ConnectionClosed(None, None)
        return frame

    def push(self, frame: dict):
        self._inbox.put_nowait(json.dumps(frame))

    def push_raw(self, raw: str):
        self._inbox.put_nowait(raw)

    def schedule_close(self):
        self._inbox.put_nowait(_CLOSE_SENTINEL)

    async def close(self):
        self._closed = True


_CLOSE_SENTINEL = object()


def _connected(connection: MCPConnection, ws: FakeReorderingWebSocket):
    """Attach a fake socket + start the single reader, bypassing handshake.

    Pre-set _agent_token to match the test tool calls so call_tool() does not
    trip its "token changed -> reconnect" path (which would try a real
    websockets.connect).
    """
    connection._websocket = ws
    connection._state = ConnectionState.CONNECTED
    connection._agent_token = "agent-token-abc"
    connection._start_reader()


@pytest.mark.asyncio
async def test_concurrent_calls_out_of_order_do_not_leak():
    """The core leak proof.

    Two concurrent call_tool() on ONE connection. The server responds to the
    SECOND request first (with a delay), then the first. Each caller must get
    the result whose id matches its OWN request — never the other's.
    """
    conn = MCPConnection(_server_config())
    ws = FakeReorderingWebSocket()
    _connected(conn, ws)

    call_a = asyncio.create_task(conn.call_tool(_tool_call("A")))
    call_b = asyncio.create_task(conn.call_tool(_tool_call("B")))

    # Wait until both requests have been sent so we know both ids.
    for _ in range(200):
        if len(ws.sent) >= 2:
            break
        await asyncio.sleep(0.001)
    assert len(ws.sent) == 2

    # Map ids to which caller's marker they carried.
    sent_by_marker = {f["params"]["arguments"]["marker"]: f["id"] for f in ws.sent}
    id_a = sent_by_marker["A"]
    id_b = sent_by_marker["B"]
    assert id_a != id_b

    # Respond to B FIRST (out of order), after a deliberate delay, then A.
    async def respond_out_of_order():
        await asyncio.sleep(0.05)
        ws.push({"jsonrpc": "2.0", "id": id_b, "result": {"who": "B-data"}})
        await asyncio.sleep(0.05)
        ws.push({"jsonrpc": "2.0", "id": id_a, "result": {"who": "A-data"}})

    asyncio.create_task(respond_out_of_order())

    result_a = await asyncio.wait_for(call_a, timeout=5)
    result_b = await asyncio.wait_for(call_b, timeout=5)

    # Each caller got ITS OWN response despite reversed server ordering.
    assert result_a == {"who": "A-data"}
    assert result_b == {"who": "B-data"}

    await conn.disconnect()


@pytest.mark.asyncio
async def test_connection_close_rejects_all_pending_promptly():
    """N in-flight requests + mid-flight close → all reject with the typed
    MCPConnectionClosedError quickly (no per-request-timeout hang)."""
    conn = MCPConnection(_server_config())
    # call_tool now attempts a reconnect on MCPConnectionClosedError before
    # re-raising — fail that dial fast/deterministically (no real network).
    conn.max_retries = 0
    conn.retry_delay = 0
    ws = FakeReorderingWebSocket()
    _connected(conn, ws)

    n = 5
    calls = [
        asyncio.create_task(conn.call_tool(_tool_call(f"P{i}"))) for i in range(n)
    ]

    for _ in range(200):
        if len(ws.sent) >= n:
            break
        await asyncio.sleep(0.001)
    assert len(ws.sent) == n

    # No response for any of them — instead the socket dies mid-flight.
    async def refuse_connect(*args, **kwargs):
        raise ConnectionError("dial refused (test)")

    with patch("websockets.connect", side_effect=refuse_connect):
        ws.schedule_close()

        results = await asyncio.wait_for(
            asyncio.gather(*calls, return_exceptions=True), timeout=3
        )
    assert len(results) == n
    for r in results:
        assert isinstance(r, MCPConnectionClosedError), f"got {r!r}"

    await conn.disconnect()


@pytest.mark.asyncio
async def test_idless_notification_does_not_corrupt_waiters():
    """A notification (no id) interleaved with a real response must not
    resolve or corrupt the pending waiter."""
    conn = MCPConnection(_server_config())
    ws = FakeReorderingWebSocket()
    _connected(conn, ws)

    call = asyncio.create_task(conn.call_tool(_tool_call("N")))

    for _ in range(200):
        if len(ws.sent) >= 1:
            break
        await asyncio.sleep(0.001)
    assert len(ws.sent) == 1
    real_id = ws.sent[0]["id"]

    # Interleave: a malformed frame, an id-less notification, a frame for an
    # unknown id, THEN the real correlated response.
    ws.push_raw("this is not json{{{")
    ws.push({"jsonrpc": "2.0", "method": "notifications/progress",
             "params": {"pct": 50}})
    ws.push({"jsonrpc": "2.0", "id": "some-other-id", "result": {"who": "X"}})
    await asyncio.sleep(0.05)
    # The waiter must still be pending — none of the above resolved it.
    assert not call.done()
    ws.push({"jsonrpc": "2.0", "id": real_id, "result": {"who": "correct"}})

    result = await asyncio.wait_for(call, timeout=5)
    assert result == {"who": "correct"}

    await conn.disconnect()


@pytest.mark.asyncio
async def test_happy_path_single_call():
    """Basic happy path: a single call_tool() still works end to end."""
    conn = MCPConnection(_server_config())
    ws = FakeReorderingWebSocket()
    _connected(conn, ws)

    call = asyncio.create_task(conn.call_tool(_tool_call("solo")))

    for _ in range(200):
        if len(ws.sent) >= 1:
            break
        await asyncio.sleep(0.001)
    sent_id = ws.sent[0]["id"]
    ws.push({"jsonrpc": "2.0", "id": sent_id,
             "result": {"accounts": ["chk-1", "sav-2"]}})

    result = await asyncio.wait_for(call, timeout=5)
    assert result == {"accounts": ["chk-1", "sav-2"]}

    await conn.disconnect()


@pytest.mark.asyncio
async def test_per_request_timeout_is_typed_and_leaves_connection_usable():
    """A request with no response times out with MCPRequestTimeoutError; the
    pending entry is cleaned up so a later waiter still works."""
    conn = MCPConnection(_server_config())
    conn.connection_timeout = 0.1  # tighten the per-request timeout for the test
    ws = FakeReorderingWebSocket()
    _connected(conn, ws)

    with pytest.raises(MCPRequestTimeoutError):
        await conn.call_tool(_tool_call("times-out"))

    # Registry did not leak the timed-out id.
    assert conn._pending == {}

    # Connection is still usable for a subsequent waiter.
    call = asyncio.create_task(conn.call_tool(_tool_call("after")))
    for _ in range(200):
        if len(ws.sent) >= 2:
            break
        await asyncio.sleep(0.001)
    later_id = ws.sent[-1]["id"]
    ws.push({"jsonrpc": "2.0", "id": later_id, "result": {"ok": True}})
    result = await asyncio.wait_for(call, timeout=5)
    assert result == {"ok": True}

    await conn.disconnect()


@pytest.mark.asyncio
async def test_cancelled_notification_rejects_matching_pending():
    """A notifications/cancelled frame with a matching requestId immediately
    rejects the corresponding pending future with MCPServerCancelledError and
    removes it from self._pending."""
    conn = MCPConnection(_server_config())
    ws = FakeReorderingWebSocket()
    _connected(conn, ws)

    call = asyncio.create_task(conn.call_tool(_tool_call("cancel-target")))

    # Wait for the request to be sent so we can retrieve its id.
    for _ in range(200):
        if len(ws.sent) >= 1:
            break
        await asyncio.sleep(0.001)
    assert len(ws.sent) == 1
    sent_id = ws.sent[0]["id"]

    # Push a notifications/cancelled frame with the matching requestId.
    ws.push({
        "jsonrpc": "2.0",
        "method": "notifications/cancelled",
        "params": {"requestId": sent_id, "reason": "server timeout"},
    })

    results = await asyncio.wait_for(
        asyncio.gather(call, return_exceptions=True), timeout=5
    )
    assert len(results) == 1
    assert isinstance(results[0], MCPServerCancelledError), (
        f"Expected MCPServerCancelledError, got {results[0]!r}"
    )
    # The pending registry must be empty — no leak.
    assert conn._pending == {}

    await conn.disconnect()


@pytest.mark.asyncio
async def test_cancelled_notification_for_unknown_id_is_ignored():
    """A notifications/cancelled with an unknown requestId must not affect any
    pending futures; the real call still completes successfully once its
    correlated response arrives."""
    conn = MCPConnection(_server_config())
    ws = FakeReorderingWebSocket()
    _connected(conn, ws)

    call = asyncio.create_task(conn.call_tool(_tool_call("real-call")))

    # Wait for the request to be sent so we can retrieve the real id.
    for _ in range(200):
        if len(ws.sent) >= 1:
            break
        await asyncio.sleep(0.001)
    real_id = ws.sent[0]["id"]

    # Push a notifications/cancelled with a fabricated unknown requestId.
    ws.push({
        "jsonrpc": "2.0",
        "method": "notifications/cancelled",
        "params": {"requestId": "wrong-id-xyz"},
    })

    # Brief pause — the call must still be pending (not cancelled by the spurious frame).
    await asyncio.sleep(0.05)
    assert not call.done(), "call was unexpectedly resolved by wrong-id notifications/cancelled"

    # Now deliver the real correlated response.
    ws.push({"jsonrpc": "2.0", "id": real_id, "result": {"ok": True}})

    result = await asyncio.wait_for(call, timeout=5)
    assert result == {"ok": True}

    await conn.disconnect()


@pytest.mark.asyncio
async def test_cancelled_error_does_not_permanently_break_connection():
    """After a notifications/cancelled resolves one future, the connection
    remains fully usable for a subsequent call_tool()."""
    conn = MCPConnection(_server_config())
    ws = FakeReorderingWebSocket()
    _connected(conn, ws)

    # First call — will be cancelled by a notifications/cancelled frame.
    first_call = asyncio.create_task(conn.call_tool(_tool_call("cancel-me")))

    for _ in range(200):
        if len(ws.sent) >= 1:
            break
        await asyncio.sleep(0.001)
    id1 = ws.sent[0]["id"]

    ws.push({
        "jsonrpc": "2.0",
        "method": "notifications/cancelled",
        "params": {"requestId": id1, "reason": "timeout"},
    })

    first_results = await asyncio.wait_for(
        asyncio.gather(first_call, return_exceptions=True), timeout=5
    )
    assert isinstance(first_results[0], MCPServerCancelledError)

    # Second call — connection must still work normally.
    second_call = asyncio.create_task(conn.call_tool(_tool_call("after-cancel")))

    for _ in range(200):
        if len(ws.sent) >= 2:
            break
        await asyncio.sleep(0.001)
    id2 = ws.sent[-1]["id"]

    ws.push({"jsonrpc": "2.0", "id": id2, "result": {"alive": True}})

    result = await asyncio.wait_for(second_call, timeout=5)
    assert result == {"alive": True}
    assert conn._pending == {}

    await conn.disconnect()


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_frame", [
    {"jsonrpc": "2.0", "method": "notifications/cancelled"},                       # no params key
    {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {}},         # params but no requestId
    {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": None},       # params=None
])
async def test_cancelled_notification_missing_request_id_is_ignored(bad_frame):
    """A malformed notifications/cancelled frame (missing params or requestId)
    must not affect any pending future; the real call still completes."""
    conn = MCPConnection(_server_config())
    ws = FakeReorderingWebSocket()
    _connected(conn, ws)

    call = asyncio.create_task(conn.call_tool(_tool_call("safe")))

    for _ in range(200):
        if len(ws.sent) >= 1:
            break
        await asyncio.sleep(0.001)
    real_id = ws.sent[0]["id"]

    ws.push(bad_frame)
    await asyncio.sleep(0.05)
    assert not call.done(), "call was unexpectedly resolved by malformed notifications/cancelled"

    ws.push({"jsonrpc": "2.0", "id": real_id, "result": {"ok": True}})
    result = await asyncio.wait_for(call, timeout=5)
    assert result == {"ok": True}

    await conn.disconnect()
