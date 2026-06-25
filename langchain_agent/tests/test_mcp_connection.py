"""
Unit tests for MCP connection management.

Uses the JSON-RPC 2.0 / CR-06 reader protocol (initialize, tools/list,
tools/call with id correlation) — the legacy handshake_ack/tools_list frames
were removed with the CR-06 rewrite.
"""
import pytest
import asyncio
from unittest.mock import patch
from datetime import datetime
import json

from websockets.exceptions import ConnectionClosed

from src.mcp.connection import MCPConnection, MCPConnectionPool, ConnectionState
# Import models via the same path the production code uses (`models.*`, see
# pythonpath in pytest.ini) so isinstance checks see the same class objects.
from models.mcp import MCPServerConfig, AuthRequirements, AuthRequirementType, MCPToolCall, AuthChallenge
from models.auth import AccessToken


@pytest.fixture
def sample_server_config():
    """Sample MCP server configuration for testing"""
    auth_requirements = AuthRequirements(
        type=AuthRequirementType.AGENT_TOKEN,
        scopes=["read", "write"]
    )
    return MCPServerConfig(
        name="test-server",
        endpoint="ws://localhost:8080/mcp",
        capabilities=["tool_execution"],
        auth_requirements=auth_requirements
    )


@pytest.fixture
def sample_access_token():
    """Sample access token for testing"""
    return AccessToken(
        token="test-token-123",
        token_type="Bearer",
        expires_in=3600,
        scope="read write",
        issued_at=datetime.now()
    )


@pytest.fixture
def sample_tool_call(sample_access_token):
    """Sample MCP tool call for testing"""
    return MCPToolCall(
        tool_name="test_tool",
        parameters={"param1": "value1"},
        agent_token=sample_access_token,
        user_auth_code=None,
        session_id="session-123"
    )


class FakeJsonRpcServerWebSocket:
    """Fake WebSocket that speaks the MCP JSON-RPC 2.0 protocol.

    send() records each outbound frame and queues an id-correlated response
    for initialize / tools/list / tools/call so the CR-06 reader task can
    recv() it. tool_responses is a list of dicts merged into the JSON-RPC
    envelope for successive tools/call requests, e.g. {"result": {...}} or
    {"error": {...}}.
    """

    def __init__(self, tools=None, tool_responses=None):
        self.sent = []
        self._inbox: "asyncio.Queue" = asyncio.Queue()
        self.closed = False
        self.tools = tools or []
        self.tool_responses = list(tool_responses or [])

    async def send(self, raw: str):
        if self.closed:
            raise ConnectionClosed(None, None)
        msg = json.loads(raw)
        self.sent.append(msg)
        method = msg.get("method")
        if msg.get("id") is None:
            return  # notification — no response
        if method == "initialize":
            self._reply(msg["id"], {"result": {"protocolVersion": "2024-11-05", "capabilities": {}}})
        elif method == "tools/list":
            self._reply(msg["id"], {"result": {"tools": [
                {"name": name, "description": "", "inputSchema": {}} for name in self.tools
            ]}})
        elif method == "tools/call":
            body = self.tool_responses.pop(0) if self.tool_responses else {"result": {}}
            self._reply(msg["id"], body)

    def _reply(self, msg_id, body):
        self._inbox.put_nowait(json.dumps({"jsonrpc": "2.0", "id": msg_id, **body}))

    async def recv(self):
        if self.closed:
            raise ConnectionClosed(None, None)
        return await self._inbox.get()

    async def close(self):
        self.closed = True

    @property
    def sent_methods(self):
        return [frame.get("method") for frame in self.sent]


def _patched_connect(ws_or_factory):
    """Patch websockets.connect to return the fake socket (accepts the header
    kwarg that connect() passes when an agent token is set)."""
    async def mock_connect(endpoint, **kwargs):
        ws = ws_or_factory() if callable(ws_or_factory) else ws_or_factory
        return ws
    return patch('websockets.connect', side_effect=mock_connect)


class TestMCPConnection:
    """Test cases for MCPConnection class"""

    @pytest.mark.asyncio
    async def test_connection_initialization(self, sample_server_config):
        """Test MCP connection initialization"""
        connection = MCPConnection(sample_server_config)

        assert connection.server_config == sample_server_config
        assert connection.state == ConnectionState.DISCONNECTED
        assert not connection.is_connected
        assert connection.last_error is None

    @pytest.mark.asyncio
    async def test_successful_connection(self, sample_server_config):
        """Test successful connection to MCP server"""
        ws = FakeJsonRpcServerWebSocket(tools=["tool1", "tool2"])
        connection = MCPConnection(sample_server_config)

        with _patched_connect(ws):
            await connection.connect(sample_server_config)

        assert connection.state == ConnectionState.CONNECTED
        assert connection.is_connected
        assert await connection.list_tools() == ["tool1", "tool2"]

        # Verify handshake, initialized notification and tools list calls
        assert ws.sent_methods == ["initialize", "notifications/initialized", "tools/list"]

        await connection.disconnect()

    @pytest.mark.asyncio
    async def test_connection_retry_logic(self, sample_server_config):
        """Test connection retry logic with exponential backoff"""
        connection = MCPConnection(sample_server_config, max_retries=2, retry_delay=0.05)

        connection_attempts = 0

        async def mock_connect(endpoint, **kwargs):
            nonlocal connection_attempts
            connection_attempts += 1
            if connection_attempts < 3:  # Fail first 2 attempts
                raise ConnectionError("Connection failed")
            return FakeJsonRpcServerWebSocket(tools=["tool1"])

        with patch('websockets.connect', side_effect=mock_connect):
            await connection.connect(sample_server_config)

        assert connection.state == ConnectionState.CONNECTED
        assert connection_attempts == 3

        await connection.disconnect()

    @pytest.mark.asyncio
    async def test_connection_max_retries_exceeded(self, sample_server_config):
        """Test connection failure after max retries exceeded"""
        connection = MCPConnection(sample_server_config, max_retries=1, retry_delay=0.05)

        async def mock_connect(endpoint, **kwargs):
            raise ConnectionError("Connection failed")

        with patch('websockets.connect', side_effect=mock_connect):
            with pytest.raises(ConnectionError):
                await connection.connect(sample_server_config)

        assert connection.state == ConnectionState.FAILED
        assert connection.last_error is not None

    @pytest.mark.asyncio
    async def test_handshake_failure_closes_socket_and_reader(self, sample_server_config):
        """A failed handshake must not leak the just-opened socket or the
        reader task across retries (and the failure must be retryable)."""
        connection = MCPConnection(sample_server_config, max_retries=1, retry_delay=0.05)

        opened = []

        class HandshakeRefusingWebSocket(FakeJsonRpcServerWebSocket):
            async def send(self, raw):
                # Server drops the connection instead of answering initialize.
                raise ConnectionClosed(None, None)

        async def mock_connect(endpoint, **kwargs):
            ws = HandshakeRefusingWebSocket()
            opened.append(ws)
            return ws

        with patch('websockets.connect', side_effect=mock_connect):
            with pytest.raises(Exception):
                await connection.connect(sample_server_config)

        # One socket per attempt (initial + 1 retry) — each closed, no reader left.
        assert len(opened) == 2
        assert all(ws.closed for ws in opened)
        assert connection._reader_task is None
        assert connection._websocket is None
        assert connection.state == ConnectionState.FAILED

    @pytest.mark.asyncio
    async def test_successful_tool_call(self, sample_server_config, sample_tool_call):
        """Test successful tool call execution"""
        ws = FakeJsonRpcServerWebSocket(
            tools=["test_tool"],
            tool_responses=[{"result": {"output": "success"}}]
        )
        connection = MCPConnection(sample_server_config)
        # Pre-set the agent token so call_tool() does not take the
        # "token changed -> reconnect" path.
        connection._agent_token = "test-token-123"

        with _patched_connect(ws):
            await connection.connect(sample_server_config)
            result = await connection.call_tool(sample_tool_call)

        assert result == {"output": "success"}

        # Verify the JSON-RPC tools/call envelope
        call_frame = ws.sent[-1]
        assert call_frame["method"] == "tools/call"
        assert call_frame["params"]["name"] == "test_tool"
        assert call_frame["params"]["arguments"] == {"param1": "value1"}
        assert call_frame["jsonrpc"] == "2.0"
        assert call_frame["id"]

        await connection.disconnect()

    @pytest.mark.asyncio
    async def test_tool_call_auth_challenge(self, sample_server_config, sample_tool_call):
        """Test tool call returning authentication challenge"""
        ws = FakeJsonRpcServerWebSocket(
            tools=["test_tool"],
            tool_responses=[{"result": {
                "type": "auth_challenge",
                "challenge_type": "oauth_authorization_code",
                "authorization_url": "https://auth.example.com/authorize",
                "scope": "read write",
                "state": "state-123"
            }}]
        )
        connection = MCPConnection(sample_server_config)
        connection._agent_token = "test-token-123"

        with _patched_connect(ws):
            await connection.connect(sample_server_config)
            result = await connection.call_tool(sample_tool_call)

        assert result["type"] == "auth_challenge"
        assert isinstance(result["challenge"], AuthChallenge)
        assert result["challenge"].challenge_type == "oauth_authorization_code"

        await connection.disconnect()

    @pytest.mark.asyncio
    async def test_tool_call_synthesized_auth_challenge_uses_plain_scopes(
            self, sample_server_config, sample_tool_call):
        """A -32001 auth error synthesizes a challenge with plain default
        scopes ("read write" — never banking:*-prefixed)."""
        ws = FakeJsonRpcServerWebSocket(
            tools=["test_tool"],
            tool_responses=[{"error": {
                "code": -32001,
                "message": "Authentication required",
                "data": {"type": "authentication_error"}
            }}]
        )
        connection = MCPConnection(sample_server_config)
        connection._agent_token = "test-token-123"

        with _patched_connect(ws):
            await connection.connect(sample_server_config)
            result = await connection.call_tool(sample_tool_call)

        assert result["type"] == "auth_challenge"
        challenge = result["challenge"]
        assert isinstance(challenge, AuthChallenge)
        assert challenge.scope == "read write"
        # The CSRF state must resolve back to the originating session (WR-11).
        assert connection.validate_auth_challenge_state(challenge.state) == "session-123"

        await connection.disconnect()

    @pytest.mark.asyncio
    async def test_tool_call_synthesized_auth_challenge_derives_scope_from_error(
            self, sample_server_config, sample_tool_call):
        """The synthesized challenge derives its scope from the server's error
        payload when present."""
        ws = FakeJsonRpcServerWebSocket(
            tools=["test_tool"],
            tool_responses=[{"error": {
                "code": -32001,
                "message": "Authentication required",
                "data": {"type": "authentication_error", "scope": ["read", "admin"]}
            }}]
        )
        connection = MCPConnection(sample_server_config)
        connection._agent_token = "test-token-123"

        with _patched_connect(ws):
            await connection.connect(sample_server_config)
            result = await connection.call_tool(sample_tool_call)

        assert result["type"] == "auth_challenge"
        assert result["challenge"].scope == "read admin"

        await connection.disconnect()

    @pytest.mark.asyncio
    async def test_tool_call_error_response(self, sample_server_config, sample_tool_call):
        """Test tool call returning error response"""
        ws = FakeJsonRpcServerWebSocket(
            tools=["test_tool"],
            tool_responses=[{"error": {"code": -32000, "message": "Tool execution failed"}}]
        )
        connection = MCPConnection(sample_server_config)
        connection._agent_token = "test-token-123"

        with _patched_connect(ws):
            await connection.connect(sample_server_config)

            with pytest.raises(Exception, match="Tool execution failed"):
                await connection.call_tool(sample_tool_call)

        await connection.disconnect()

    @pytest.mark.asyncio
    async def test_disconnect(self, sample_server_config):
        """Test connection disconnect"""
        ws = FakeJsonRpcServerWebSocket(tools=["tool1"])
        connection = MCPConnection(sample_server_config)

        with _patched_connect(ws):
            await connection.connect(sample_server_config)
            assert connection.is_connected

            await connection.disconnect()
            assert connection.state == ConnectionState.DISCONNECTED
            assert not connection.is_connected
            assert ws.closed

    @pytest.mark.asyncio
    async def test_reader_death_marks_connection_disconnected(self, sample_server_config):
        """When the reader loop dies (socket closed by the server), the
        connection must drop the stale socket and report not connected."""
        ws = FakeJsonRpcServerWebSocket(tools=["tool1"])
        connection = MCPConnection(sample_server_config)

        with _patched_connect(ws):
            await connection.connect(sample_server_config)
            assert connection.is_connected

            # Server closes the socket: recv() starts raising ConnectionClosed.
            ws.closed = True
            # Wake the reader (it is blocked on the inbox queue).
            ws._inbox.put_nowait("{}")

            for _ in range(200):
                if not connection.is_connected:
                    break
                await asyncio.sleep(0.001)

        assert not connection.is_connected
        assert connection.state == ConnectionState.DISCONNECTED
        assert connection._websocket is None

        await connection.disconnect()


class TestMCPConnectionPool:
    """Test cases for MCPConnectionPool class"""

    @pytest.mark.asyncio
    async def test_pool_initialization(self):
        """Test connection pool initialization"""
        pool = MCPConnectionPool(max_connections_per_server=3)
        assert pool.max_connections_per_server == 3
        assert len(pool._connections) == 0

    @pytest.mark.asyncio
    async def test_get_connection_new_server(self, sample_server_config):
        """Test getting connection for new server"""
        pool = MCPConnectionPool()

        with _patched_connect(lambda: FakeJsonRpcServerWebSocket(tools=["tool1"])):
            connection = await pool.get_connection(sample_server_config)

        assert connection.is_connected
        assert connection.server_config == sample_server_config
        assert len(pool._connections["test-server"]) == 1

        await pool.close_all_connections()

    @pytest.mark.asyncio
    async def test_get_connection_reuse_existing(self, sample_server_config):
        """Test reusing existing connection from pool"""
        pool = MCPConnectionPool()

        with _patched_connect(lambda: FakeJsonRpcServerWebSocket(tools=["tool1"])):
            connection1 = await pool.get_connection(sample_server_config)
            connection2 = await pool.get_connection(sample_server_config)

        # Should reuse the same connection
        assert connection1 is connection2
        assert len(pool._connections["test-server"]) == 1

        await pool.close_all_connections()

    @pytest.mark.asyncio
    async def test_slow_dial_to_one_server_does_not_block_another(self):
        """A slow connect to server A must not block get_connection for
        server B (per-server locks, no pool-wide head-of-line blocking)."""
        auth = AuthRequirements(type=AuthRequirementType.AGENT_TOKEN, scopes=["read"])
        slow_config = MCPServerConfig(
            name="slow-server", endpoint="ws://localhost:9001/slow",
            capabilities=["tool_execution"], auth_requirements=auth)
        fast_config = MCPServerConfig(
            name="fast-server", endpoint="ws://localhost:9002/fast",
            capabilities=["tool_execution"], auth_requirements=auth)

        pool = MCPConnectionPool()
        dial_started = asyncio.Event()
        release_dial = asyncio.Event()

        async def mock_connect(endpoint, **kwargs):
            if "slow" in endpoint:
                dial_started.set()
                await release_dial.wait()
            return FakeJsonRpcServerWebSocket(tools=[])

        with patch('websockets.connect', side_effect=mock_connect):
            slow_task = asyncio.create_task(pool.get_connection(slow_config))
            await asyncio.wait_for(dial_started.wait(), timeout=2)

            # While server A is mid-dial, server B must connect promptly.
            fast_conn = await asyncio.wait_for(
                pool.get_connection(fast_config), timeout=1
            )
            assert fast_conn.is_connected

            release_dial.set()
            slow_conn = await asyncio.wait_for(slow_task, timeout=2)
            assert slow_conn.is_connected

        await pool.close_all_connections()

    @pytest.mark.asyncio
    async def test_close_all_connections(self, sample_server_config):
        """Test closing all connections in pool"""
        pool = MCPConnectionPool()
        ws = FakeJsonRpcServerWebSocket(tools=["tool1"])

        with _patched_connect(ws):
            connection = await pool.get_connection(sample_server_config)
            assert connection.is_connected

            await pool.close_all_connections()

            assert len(pool._connections) == 0
            assert ws.closed

    @pytest.mark.asyncio
    async def test_get_pool_status(self, sample_server_config):
        """Test getting pool status"""
        pool = MCPConnectionPool()

        with _patched_connect(lambda: FakeJsonRpcServerWebSocket(tools=["tool1"])):
            await pool.get_connection(sample_server_config)

            status = await pool.get_pool_status()

            assert "test-server" in status
            assert status["test-server"]["total_connections"] == 1
            assert status["test-server"]["connected"] == 1
            assert status["test-server"]["failed"] == 0

        await pool.close_all_connections()
