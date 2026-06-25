"""
Unit tests for StreamableHttpMCPConnection and MCP_TRANSPORT config wiring.

Tests:
  - test_mcp_transport_default: MCPConfig.mcp_transport defaults to "websocket"
  - test_mcp_transport_env_override: MCP_TRANSPORT=streamable_http sets mcp_transport correctly
  - test_mcp_transport_invalid_raises: invalid MCP_TRANSPORT value raises ValueError
  - test_streamable_http_initialize: POST /mcp initialize captures mcp-session-id header
  - test_streamable_http_call_tool: POST /mcp tools/call sends mcp-session-id header
  - test_streamable_http_session_expired: 404 response raises MCPConnectionClosedError
  - test_streamable_http_list_tools: list_tools() returns tool names from tools/list
  - test_ws_pool_routing_unchanged: MCPConnectionPool returns MCPConnection for ws:// endpoint
"""
import os
import sys
import asyncio
from datetime import datetime
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _server_config_http():
    """MCPServerConfig with an HTTP endpoint (streamable_http transport)."""
    from src.models.mcp import (
        MCPServerConfig,
        AuthRequirements,
        AuthRequirementType,
    )
    return MCPServerConfig(
        name="bank-http",
        endpoint="http://localhost:8080",
        capabilities=["tool_execution"],
        auth_requirements=AuthRequirements(
            type=AuthRequirementType.AGENT_TOKEN, scopes=["read", "write"]
        ),
    )


def _server_config_ws():
    """MCPServerConfig with a WebSocket endpoint."""
    from src.models.mcp import (
        MCPServerConfig,
        AuthRequirements,
        AuthRequirementType,
    )
    return MCPServerConfig(
        name="bank-ws",
        endpoint="ws://localhost:8080/mcp",
        capabilities=["tool_execution"],
        auth_requirements=AuthRequirements(
            type=AuthRequirementType.AGENT_TOKEN, scopes=["read", "write"]
        ),
    )


def _access_token():
    from src.models.auth import AccessToken
    return AccessToken(
        token="agent-bearer-token",
        token_type="Bearer",
        expires_in=3600,
        scope="read write",
        issued_at=datetime.now(),
    )


def _tool_call(tool_name: str = "get_accounts"):
    from src.models.mcp import MCPToolCall
    return MCPToolCall(
        tool_name=tool_name,
        parameters={"accountId": "acc-123"},
        agent_token=_access_token(),
        user_auth_code=None,
        session_id="session-test-1",
    )


def _mock_response(status_code: int, json_body: Dict[str, Any], headers: Dict[str, str] = None):
    """Build a mock httpx.Response-like object."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_body
    resp.headers = headers or {}
    return resp


# ---------------------------------------------------------------------------
# Task 1 tests: MCPConfig.mcp_transport + env wiring
# ---------------------------------------------------------------------------

class TestMCPTransportConfig:
    """Verify MCP_TRANSPORT env var is wired to MCPConfig.mcp_transport."""

    def _build_config(self, env_overrides: Dict[str, str] = None):
        """Build config with minimal required env vars."""
        base_env = {
            "PINGONE_BASE_URL": "http://localhost",
            "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "http://localhost/reg",
            "PINGONE_TOKEN_ENDPOINT": "http://localhost/token",
            "PINGONE_AUTHORIZATION_ENDPOINT": "http://localhost/auth",
            "PINGONE_REDIRECT_URI": "http://localhost/callback",
        }
        if env_overrides:
            base_env.update(env_overrides)

        import importlib
        import src.config.settings as settings_mod
        # Force a fresh ConfigManager so cached config is not reused
        with patch.dict(os.environ, base_env, clear=False):
            # Strip any pre-existing MCP_TRANSPORT from test env
            env = {**base_env}
            with patch.dict(os.environ, env, clear=False):
                mgr = settings_mod.ConfigManager()
                return mgr.load_config("development")

    def test_mcp_transport_default(self):
        """MCPConfig.mcp_transport defaults to 'websocket' when MCP_TRANSPORT unset."""
        # Remove MCP_TRANSPORT if present in test env
        env = {
            "PINGONE_BASE_URL": "http://localhost",
            "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "http://localhost/reg",
            "PINGONE_TOKEN_ENDPOINT": "http://localhost/token",
            "PINGONE_AUTHORIZATION_ENDPOINT": "http://localhost/auth",
            "PINGONE_REDIRECT_URI": "http://localhost/callback",
        }
        from src.config.settings import ConfigManager
        with patch.dict(os.environ, env, clear=False):
            # Ensure MCP_TRANSPORT is unset
            os.environ.pop("MCP_TRANSPORT", None)
            mgr = ConfigManager()
            cfg = mgr.load_config("development")
        assert cfg.mcp.mcp_transport == "websocket", (
            f"Expected 'websocket', got {cfg.mcp.mcp_transport!r}"
        )

    def test_mcp_transport_env_override(self):
        """MCP_TRANSPORT=streamable_http is reflected in cfg.mcp.mcp_transport."""
        env = {
            "PINGONE_BASE_URL": "http://localhost",
            "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "http://localhost/reg",
            "PINGONE_TOKEN_ENDPOINT": "http://localhost/token",
            "PINGONE_AUTHORIZATION_ENDPOINT": "http://localhost/auth",
            "PINGONE_REDIRECT_URI": "http://localhost/callback",
            "MCP_TRANSPORT": "streamable_http",
        }
        from src.config.settings import ConfigManager
        with patch.dict(os.environ, env, clear=False):
            mgr = ConfigManager()
            cfg = mgr.load_config("development")
        assert cfg.mcp.mcp_transport == "streamable_http", (
            f"Expected 'streamable_http', got {cfg.mcp.mcp_transport!r}"
        )

    def test_mcp_transport_invalid_raises(self):
        """An unrecognised MCP_TRANSPORT value raises ValueError at build time."""
        env = {
            "PINGONE_BASE_URL": "http://localhost",
            "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "http://localhost/reg",
            "PINGONE_TOKEN_ENDPOINT": "http://localhost/token",
            "PINGONE_AUTHORIZATION_ENDPOINT": "http://localhost/auth",
            "PINGONE_REDIRECT_URI": "http://localhost/callback",
            "MCP_TRANSPORT": "grpc",
        }
        from src.config.settings import ConfigManager
        with patch.dict(os.environ, env, clear=False):
            mgr = ConfigManager()
            with pytest.raises(ValueError, match="MCP_TRANSPORT"):
                mgr.load_config("development")


# ---------------------------------------------------------------------------
# Task 2 tests: StreamableHttpMCPConnection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_streamable_http_initialize():
    """connect() sends initialize POST, captures mcp-session-id from response headers."""
    from src.mcp.connection import StreamableHttpMCPConnection

    server = _server_config_http()
    conn = StreamableHttpMCPConnection(server)

    # Mock httpx.AsyncClient
    mock_init_response = _mock_response(
        status_code=200,
        json_body={
            "jsonrpc": "2.0",
            "id": "ignored",
            "result": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
            },
        },
        headers={"mcp-session-id": "test-session-123"},
    )

    # tools/list response (called by _refresh_tools after initialize)
    mock_tools_response = _mock_response(
        status_code=200,
        json_body={
            "jsonrpc": "2.0",
            "id": "ignored",
            "result": {"tools": []},
        },
        headers={"mcp-session-id": "test-session-123"},
    )

    call_count = 0

    async def fake_post(url, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return mock_init_response
        return mock_tools_response

    mock_client = AsyncMock()
    mock_client.post = fake_post
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_client):
        await conn.connect(server)

    assert conn._mcp_session_id == "test-session-123", (
        f"Expected 'test-session-123', got {conn._mcp_session_id!r}"
    )
    assert conn._is_connected is True


@pytest.mark.asyncio
async def test_streamable_http_call_tool():
    """call_tool() sends tools/call POST with mcp-session-id header."""
    from src.mcp.connection import StreamableHttpMCPConnection

    server = _server_config_http()
    conn = StreamableHttpMCPConnection(server)
    conn._mcp_session_id = "existing-session-abc"
    conn._is_connected = True
    conn._available_tools = ["get_accounts"]
    conn._authorization_header = "agent-bearer-token"

    sent_headers = {}
    mock_response = _mock_response(
        status_code=200,
        json_body={
            "jsonrpc": "2.0",
            "id": "ignored",
            "result": {"accounts": ["chk-1", "sav-2"]},
        },
        headers={"mcp-session-id": "existing-session-abc"},
    )

    async def fake_post(url, **kwargs):
        # Capture the headers that were sent
        sent_headers.update(kwargs.get("headers", {}))
        return mock_response

    mock_client = AsyncMock()
    mock_client.post = fake_post
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_client):
        result = await conn.call_tool(_tool_call())

    # Verify session id was sent in the request headers
    assert "mcp-session-id" in sent_headers, (
        f"mcp-session-id header not sent. Headers sent: {sent_headers}"
    )
    assert sent_headers["mcp-session-id"] == "existing-session-abc"
    assert result == {"accounts": ["chk-1", "sav-2"]}


@pytest.mark.asyncio
async def test_streamable_http_session_expired():
    """A 404 response raises MCPConnectionClosedError (session expired)."""
    from src.mcp.connection import StreamableHttpMCPConnection, MCPConnectionClosedError

    server = _server_config_http()
    conn = StreamableHttpMCPConnection(server)
    conn._mcp_session_id = "expired-session"
    conn._is_connected = True
    conn._available_tools = ["get_accounts"]

    mock_404 = _mock_response(
        status_code=404,
        json_body={},
        headers={},
    )

    async def fake_post(url, **kwargs):
        return mock_404

    mock_client = AsyncMock()
    mock_client.post = fake_post
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(MCPConnectionClosedError):
            await conn.call_tool(_tool_call())


@pytest.mark.asyncio
async def test_streamable_http_non_200_raises():
    """A non-200/404 response raises a descriptive error with the status code
    instead of falling through to response.json()."""
    from src.mcp.connection import StreamableHttpMCPConnection

    server = _server_config_http()
    conn = StreamableHttpMCPConnection(server)
    conn._mcp_session_id = "session-500"
    conn._is_connected = True
    conn._available_tools = ["get_accounts"]

    mock_500 = _mock_response(status_code=500, json_body={}, headers={})

    async def fake_post(url, **kwargs):
        return mock_500

    mock_client = AsyncMock()
    mock_client.post = fake_post

    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(ConnectionError, match="500"):
            await conn.call_tool(_tool_call())

    # No silent {} success — json() must never have been consulted.
    mock_500.json.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", [401, 403])
async def test_streamable_http_auth_failure_clears_state(status_code):
    """401/403 clears the stored authorization state and marks the connection
    disconnected before raising."""
    from src.mcp.connection import StreamableHttpMCPConnection

    server = _server_config_http()
    conn = StreamableHttpMCPConnection(server)
    conn._mcp_session_id = "session-auth"
    conn._is_connected = True
    conn._available_tools = ["get_accounts"]

    mock_auth_fail = _mock_response(status_code=status_code, json_body={}, headers={})

    async def fake_post(url, **kwargs):
        return mock_auth_fail

    mock_client = AsyncMock()
    mock_client.post = fake_post

    with patch("httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(ConnectionError, match=str(status_code)):
            await conn.call_tool(_tool_call())

    assert conn._authorization_header is None
    assert conn._is_connected is False


@pytest.mark.asyncio
async def test_streamable_http_disconnect_sends_auth_header_and_closes_client():
    """disconnect() includes the Authorization header on the session DELETE and
    closes the per-connection HTTP client."""
    from src.mcp.connection import StreamableHttpMCPConnection

    server = _server_config_http()
    conn = StreamableHttpMCPConnection(server)
    conn._mcp_session_id = "session-del"
    conn._is_connected = True
    conn._authorization_header = "agent-bearer-token"

    sent = {}

    async def fake_delete(url, **kwargs):
        sent.update(kwargs.get("headers", {}))
        return _mock_response(status_code=200, json_body={}, headers={})

    mock_client = AsyncMock()
    mock_client.delete = fake_delete

    with patch("httpx.AsyncClient", return_value=mock_client):
        await conn.disconnect()

    assert sent.get("Authorization") == "Bearer agent-bearer-token"
    assert sent.get("mcp-session-id") == "session-del"
    mock_client.aclose.assert_awaited_once()
    assert conn._http_client is None
    assert conn._is_connected is False


@pytest.mark.asyncio
async def test_streamable_http_reuses_one_client_per_connection():
    """_post_rpc reuses a single httpx.AsyncClient per connection instance."""
    from src.mcp.connection import StreamableHttpMCPConnection

    server = _server_config_http()
    conn = StreamableHttpMCPConnection(server)
    conn._mcp_session_id = "session-reuse"
    conn._is_connected = True
    conn._available_tools = ["get_accounts"]

    mock_response = _mock_response(
        status_code=200,
        json_body={"jsonrpc": "2.0", "id": "ignored", "result": {"ok": True}},
        headers={},
    )

    async def fake_post(url, **kwargs):
        return mock_response

    mock_client = AsyncMock()
    mock_client.post = fake_post

    with patch("httpx.AsyncClient", return_value=mock_client) as client_ctor:
        await conn.call_tool(_tool_call())
        await conn.call_tool(_tool_call())

    assert client_ctor.call_count == 1, (
        f"Expected one AsyncClient per connection, got {client_ctor.call_count}"
    )


@pytest.mark.asyncio
async def test_http_pool_reuses_disconnected_connection():
    """The streamable_http pool branch reuses a disconnected instance instead
    of growing the pool unboundedly."""
    from src.mcp.connection import MCPConnectionPool, StreamableHttpMCPConnection

    server = _server_config_http()
    pool = MCPConnectionPool(max_connections_per_server=2)

    async def fake_connect(self_conn, sc):
        self_conn._is_connected = True

    # The pool now reads the transport from the validated config SSOT
    # (src.mcp.connection.get_config), not os.environ.
    from types import SimpleNamespace
    fake_config = SimpleNamespace(mcp=SimpleNamespace(mcp_transport="streamable_http"))
    with patch("src.mcp.connection.get_config", return_value=fake_config):
        with patch.object(StreamableHttpMCPConnection, "connect", fake_connect):
            conn1 = await pool.get_connection(server)
            assert len(pool._connections[server.name]) == 1

            # Simulate a dropped session — the same instance must be reused.
            conn1._is_connected = False
            conn2 = await pool.get_connection(server)

    assert conn2 is conn1
    assert len(pool._connections[server.name]) == 1


@pytest.mark.asyncio
async def test_streamable_http_list_tools():
    """list_tools() returns tool names populated during connect()."""
    from src.mcp.connection import StreamableHttpMCPConnection

    server = _server_config_http()
    conn = StreamableHttpMCPConnection(server)

    mock_init_response = _mock_response(
        status_code=200,
        json_body={
            "jsonrpc": "2.0",
            "id": "ignored",
            "result": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
            },
        },
        headers={"mcp-session-id": "list-session-456"},
    )

    mock_tools_response = _mock_response(
        status_code=200,
        json_body={
            "jsonrpc": "2.0",
            "id": "ignored",
            "result": {
                "tools": [
                    {"name": "get_accounts", "description": "Get accounts", "inputSchema": {}},
                    {"name": "get_balance", "description": "Get balance", "inputSchema": {}},
                ]
            },
        },
        headers={"mcp-session-id": "list-session-456"},
    )

    call_count = 0

    async def fake_post(url, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return mock_init_response
        return mock_tools_response

    mock_client = AsyncMock()
    mock_client.post = fake_post
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_client):
        await conn.connect(server)
        tools = await conn.list_tools()

    assert "get_accounts" in tools, f"get_accounts not in tools: {tools}"
    assert "get_balance" in tools, f"get_balance not in tools: {tools}"
    assert len(tools) == 2


@pytest.mark.asyncio
async def test_ws_pool_routing_unchanged():
    """MCPConnectionPool with ws:// endpoint returns MCPConnection (not HTTP conn)
    when MCP_TRANSPORT=websocket (or unset)."""
    from src.mcp.connection import MCPConnectionPool, MCPConnection

    server = _server_config_ws()
    pool = MCPConnectionPool()

    # Mock websockets.connect to avoid real network
    mock_ws = AsyncMock()
    mock_ws.send = AsyncMock()
    mock_ws.recv = AsyncMock(side_effect=Exception("not called in this test"))
    mock_ws.close = AsyncMock()

    # Patch MCPConnection.connect to avoid real websocket handshake
    with patch.dict(os.environ, {"MCP_TRANSPORT": "websocket"}):
        with patch.object(
            MCPConnection,
            "connect",
            new_callable=lambda: (
                lambda self: type(
                    "P",
                    (),
                    {
                        "__await__": lambda s: iter([None]),
                        "__call__": lambda *a, **kw: None,
                    },
                )
            ),
        ):
            # Directly patch connect to set state
            async def fake_connect(self_conn, sc):
                self_conn._state = __import__("src.mcp.connection", fromlist=["ConnectionState"]).ConnectionState.CONNECTED
                self_conn._websocket = mock_ws
                self_conn._agent_token = None
                self_conn._available_tools = []
                self_conn._tool_schemas = {}
                self_conn._start_reader()

            with patch.object(MCPConnection, "connect", fake_connect):
                conn = await pool.get_connection(server)

    assert isinstance(conn, MCPConnection), (
        f"Expected MCPConnection for ws:// endpoint, got {type(conn).__name__}"
    )
    # Cleanup
    await conn.disconnect()
