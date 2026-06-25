"""
Integration tests for MCP server communication.

These tests verify complete end-to-end MCP server communication including:
- Mock MCP server interactions (JSON-RPC 2.0 / CR-06 protocol — the legacy
  handshake_ack/tools_list frame protocol was removed with the CR-06 rewrite)
- Authentication challenge handling
- Tool execution with various authentication scenarios
"""
import pytest
import asyncio
import json
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any, List
from aioresponses import aioresponses

from src.mcp.connection import MCPConnection, MCPConnectionPool, ConnectionState
from src.mcp.auth_handler import AuthenticationHandler, AuthRequest, AuthResponse
from src.mcp.tool_registry import ToolRegistry, MCPToolExecutor, MCPClientManager
# Import models via the same path the production code uses (`models.*`, see
# pythonpath in pytest.ini) so isinstance checks see the same class objects.
from models.mcp import MCPServerConfig, AuthRequirements, AuthRequirementType, AuthChallenge, MCPToolCall
from models.auth import AccessToken, AuthorizationCode
from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.config.settings import AppConfig, PingOneConfig, SecurityConfig, LangChainConfig

from tests.conftest import TEST_SECURITY_KWARGS
# Reuse the JSON-RPC-speaking fake WebSocket from the connection unit tests.
from tests.test_mcp_connection import FakeJsonRpcServerWebSocket, _patched_connect


@pytest.fixture
def integration_config():
    """Create configuration for MCP integration testing."""
    return AppConfig(
        environment="integration",
        debug=True,
        log_level="DEBUG",
        pingone=PingOneConfig(
            base_url="https://integration-tenant.forgeblocks.com",
            client_registration_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/register",
            token_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token",
            authorization_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize",
            default_scope="openid profile mcp:access",
            redirect_uri="https://localhost:8080/oauth/callback",
            realm="alpha",
            # These tests mock the DCR HTTP endpoint with aioresponses —
            # force the DCR code path (register_client() reads config SSOT).
            agent_dcr_enabled=True,
        ),
        security=SecurityConfig(**TEST_SECURITY_KWARGS),
        mcp=MagicMock(),
        chat=MagicMock(),
        langchain=LangChainConfig(),
    )


@pytest.fixture
def mock_agent_token():
    """Create a mock agent access token."""
    return AccessToken(
        token="mock-agent-token-abc123",
        token_type="Bearer",
        expires_in=3600,
        scope="openid profile mcp:access",
        issued_at=datetime.now(timezone.utc)
    )


@pytest.fixture
def mock_user_auth_code():
    """Create a mock user authorization code."""
    return AuthorizationCode(
        code="mock-user-auth-code-xyz789",
        state="mock-state-parameter",
        session_id="integration-session-123",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10)
    )


@pytest.fixture
def github_server_config():
    """Create GitHub MCP server configuration."""
    return MCPServerConfig(
        name="github-mcp",
        endpoint="ws://localhost:8080/mcp/github",
        capabilities=["tool_execution", "authentication"],
        auth_requirements=AuthRequirements(
            type=AuthRequirementType.BOTH,
            scopes=["repo", "user:read"]
        )
    )


@pytest.fixture
def slack_server_config():
    """Create Slack MCP server configuration."""
    return MCPServerConfig(
        name="slack-mcp",
        endpoint="ws://localhost:8080/mcp/slack",
        capabilities=["tool_execution", "authentication"],
        auth_requirements=AuthRequirements(
            type=AuthRequirementType.USER_AUTHORIZATION,
            scopes=["channels:read", "users:read"]
        )
    )


class TestMCPConnectionIntegration:
    """Integration tests for MCP connection management."""

    @pytest.mark.asyncio
    async def test_successful_connection_and_handshake(self, github_server_config):
        """Test successful connection and handshake with mock MCP server."""
        ws = FakeJsonRpcServerWebSocket(tools=["list_repositories", "create_issue"])
        connection = MCPConnection(github_server_config)

        with _patched_connect(ws):
            await connection.connect(github_server_config)

            assert connection.is_connected
            assert connection.state == ConnectionState.CONNECTED
            assert await connection.list_tools() == ["list_repositories", "create_issue"]

            await connection.disconnect()
            assert not connection.is_connected

        # Verify the JSON-RPC handshake sequence (CR-06 protocol)
        assert ws.sent_methods == ["initialize", "notifications/initialized", "tools/list"]

    @pytest.mark.asyncio
    async def test_connection_retry_on_failure(self, github_server_config):
        """Test connection retry mechanism on initial failure."""
        attempts = 0

        async def mock_connect(endpoint, **kwargs):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise ConnectionError("Connection refused")
            return FakeJsonRpcServerWebSocket(tools=["list_repositories"])

        # First call fails, second succeeds
        with patch('websockets.connect', side_effect=mock_connect):
            connection = MCPConnection(github_server_config, retry_delay=0.1)

            await connection.connect(github_server_config)

            assert connection.is_connected
            assert connection.state == ConnectionState.CONNECTED
            assert attempts == 2

            await connection.disconnect()

    @pytest.mark.asyncio
    async def test_tool_execution_with_agent_token(self, github_server_config, mock_agent_token):
        """Test tool execution with agent token injection.

        Zero-trust contract: the agent token travels as an Authorization
        header at WebSocket connect time, NOT inside the JSON-RPC tools/call
        params (the old in-body agent_token field was removed).
        """
        created_sockets = []
        connect_kwargs = []

        async def mock_connect(endpoint, **kwargs):
            connect_kwargs.append(kwargs)
            ws = FakeJsonRpcServerWebSocket(
                tools=["list_repositories"],
                tool_responses=[{
                    "result": {"repositories": [{"name": "test-repo"}]}
                }],
            )
            created_sockets.append(ws)
            return ws

        with patch('websockets.connect', side_effect=mock_connect):
            connection = MCPConnection(github_server_config)
            await connection.connect(github_server_config)

            tool_call = MCPToolCall(
                tool_name="list_repositories",
                parameters={},
                agent_token=mock_agent_token,
                user_auth_code=None,
                session_id="test-session"
            )

            # call_tool sees a new agent token -> reconnects with the
            # Authorization header before sending the tools/call request.
            result = await connection.call_tool(tool_call)

            assert "repositories" in result
            assert result["repositories"][0]["name"] == "test-repo"

            # Verify the agent token was sent as an Authorization header on
            # the (re)connect...
            header_lists = [
                v for kwargs in connect_kwargs
                for v in kwargs.values() if isinstance(v, list)
            ]
            assert any(
                ("Authorization", f"Bearer {mock_agent_token.token}") in headers
                for headers in header_lists
            )

            # ...and NOT inside any JSON-RPC frame body.
            call_frames = [
                frame for ws in created_sockets for frame in ws.sent
                if frame.get("method") == "tools/call"
            ]
            assert call_frames
            assert mock_agent_token.token not in json.dumps(call_frames)

            await connection.disconnect()

    @pytest.mark.asyncio
    async def test_authentication_challenge_handling(self, github_server_config, mock_agent_token):
        """Test handling of authentication challenges from MCP server."""
        ws = FakeJsonRpcServerWebSocket(
            tools=["create_issue"],
            tool_responses=[{
                "result": {
                    "type": "auth_challenge",
                    "challenge_type": "oauth_authorization_code",
                    "authorization_url": "https://github.com/login/oauth/authorize?client_id=test&scope=repo",
                    "scope": "repo",
                    "state": "challenge-state-123"
                }
            }],
        )

        with _patched_connect(ws):
            connection = MCPConnection(github_server_config)
            # Pre-set the agent token so call_tool() does not take the
            # "token changed -> reconnect" path.
            connection._agent_token = mock_agent_token.token
            await connection.connect(github_server_config)

            tool_call = MCPToolCall(
                tool_name="create_issue",
                parameters={"title": "Test Issue"},
                agent_token=mock_agent_token,
                user_auth_code=None,
                session_id="test-session"
            )

            result = await connection.call_tool(tool_call)

            assert result["type"] == "auth_challenge"
            assert "challenge" in result

            challenge = result["challenge"]
            assert challenge.challenge_type == "oauth_authorization_code"
            assert "github.com" in challenge.authorization_url
            assert challenge.scope == "repo"

            await connection.disconnect()


class TestAuthenticationHandlerIntegration:
    """Integration tests for authentication challenge handling."""

    @pytest.mark.asyncio
    async def test_complete_auth_challenge_flow(self):
        """Test complete authentication challenge flow from request to response."""
        auth_requests = []

        async def auth_request_callback(auth_request: AuthRequest):
            auth_requests.append(auth_request)

        handler = AuthenticationHandler(auth_request_callback)

        # Create mock challenge
        challenge = AuthChallenge(
            challenge_type="oauth_authorization_code",
            authorization_url="https://github.com/login/oauth/authorize?client_id=test&scope=repo&state=test-state",
            scope="repo user:read",
            state="test-state"
        )

        # Start challenge handling in background
        challenge_task = asyncio.create_task(
            handler.handle_auth_challenge(
                challenge=challenge,
                session_id="test-session",
                server_name="github-mcp",
                tool_name="create_issue",
                timeout_seconds=10
            )
        )

        # Wait a bit for challenge to be processed
        await asyncio.sleep(0.1)

        # Verify auth request was created
        assert len(auth_requests) == 1
        auth_request = auth_requests[0]
        assert auth_request.session_id == "test-session"
        assert auth_request.server_name == "github-mcp"
        assert auth_request.tool_name == "create_issue"
        assert auth_request.scope == "repo user:read"

        # Provide auth response
        success = await handler.provide_auth_response(
            challenge_id=auth_request.challenge_id,
            authorization_code="test-auth-code-123",
            state="test-state"
        )

        assert success

        # Wait for challenge to complete
        auth_response = await challenge_task

        assert auth_response.is_success()
        assert auth_response.authorization_code == "test-auth-code-123"
        assert auth_response.state == "test-state"

        await handler.shutdown()

    @pytest.mark.asyncio
    async def test_auth_challenge_timeout(self):
        """Test authentication challenge timeout handling."""
        handler = AuthenticationHandler()

        challenge = AuthChallenge(
            challenge_type="oauth_authorization_code",
            authorization_url="https://github.com/login/oauth/authorize",
            scope="repo",
            state="timeout-test-state"
        )

        # Handle challenge with short timeout
        auth_response = await handler.handle_auth_challenge(
            challenge=challenge,
            session_id="timeout-session",
            server_name="github-mcp",
            tool_name="create_issue",
            timeout_seconds=0.1  # Very short timeout
        )

        assert not auth_response.is_success()
        assert "timed out" in auth_response.error.lower()

        await handler.shutdown()

    @pytest.mark.asyncio
    async def test_multiple_concurrent_challenges(self):
        """Test handling multiple concurrent authentication challenges."""
        auth_requests = []

        async def auth_request_callback(auth_request: AuthRequest):
            auth_requests.append(auth_request)

        handler = AuthenticationHandler(auth_request_callback)

        # Create multiple challenges
        challenges = []
        for i in range(3):
            challenge = AuthChallenge(
                challenge_type="oauth_authorization_code",
                authorization_url=f"https://server{i}.com/oauth/authorize",
                scope=f"scope{i}",
                state=f"state{i}"
            )
            challenges.append(challenge)

        # Start all challenges concurrently
        challenge_tasks = [
            asyncio.create_task(
                handler.handle_auth_challenge(
                    challenge=challenge,
                    session_id=f"session-{i}",
                    server_name=f"server-{i}",
                    tool_name=f"tool-{i}",
                    timeout_seconds=10
                )
            )
            for i, challenge in enumerate(challenges)
        ]

        # Wait for all challenges to be processed
        await asyncio.sleep(0.1)

        # Verify all auth requests were created
        assert len(auth_requests) == 3

        # Provide responses for all challenges
        for i, auth_request in enumerate(auth_requests):
            await handler.provide_auth_response(
                challenge_id=auth_request.challenge_id,
                authorization_code=f"auth-code-{i}",
                state=f"state{i}"
            )

        # Wait for all challenges to complete
        auth_responses = await asyncio.gather(*challenge_tasks)

        # Verify all responses are successful
        for i, response in enumerate(auth_responses):
            assert response.is_success()
            assert response.authorization_code == f"auth-code-{i}"
            assert response.state == f"state{i}"

        await handler.shutdown()


class TestMCPToolExecutionIntegration:
    """Integration tests for MCP tool execution with authentication."""

    @pytest.mark.asyncio
    async def test_tool_execution_without_user_auth(self, github_server_config, mock_agent_token):
        """Test tool execution that doesn't require user authorization."""
        # Mock connection pool
        mock_connection = AsyncMock()
        mock_connection.call_tool = AsyncMock(return_value={
            "repositories": [{"name": "test-repo", "url": "https://github.com/user/test-repo"}]
        })

        mock_pool = AsyncMock()
        mock_pool.get_connection = AsyncMock(return_value=mock_connection)

        # Create tool registry and executor (the executor resolves the
        # connection through its registered server_configs)
        tool_registry = ToolRegistry()
        await tool_registry.register_server_tools("github-mcp", ["list_repositories"])

        executor = MCPToolExecutor(
            mock_pool, tool_registry, {"github-mcp": github_server_config}
        )

        # Execute tool
        result = await executor.execute_tool(
            server_name="github-mcp",
            tool_name="list_repositories",
            parameters={},
            agent_token=mock_agent_token,
            session_id="test-session"
        )

        assert "repositories" in result
        assert result["repositories"][0]["name"] == "test-repo"

        # Verify tool call was made with correct parameters
        mock_connection.call_tool.assert_called_once()
        call_args = mock_connection.call_tool.call_args[0][0]
        assert call_args.tool_name == "list_repositories"
        assert call_args.agent_token == mock_agent_token
        assert call_args.user_auth_code is None

    @pytest.mark.asyncio
    async def test_tool_execution_with_user_auth(self, github_server_config, mock_agent_token, mock_user_auth_code):
        """Test tool execution that requires user authorization."""
        # Mock connection pool
        mock_connection = AsyncMock()
        mock_connection.call_tool = AsyncMock(return_value={
            "issue": {"id": 123, "title": "Test Issue", "url": "https://github.com/user/repo/issues/123"}
        })

        mock_pool = AsyncMock()
        mock_pool.get_connection = AsyncMock(return_value=mock_connection)

        # Create tool registry and executor
        tool_registry = ToolRegistry()
        await tool_registry.register_server_tools("github-mcp", ["create_issue"])

        executor = MCPToolExecutor(
            mock_pool, tool_registry, {"github-mcp": github_server_config}
        )

        # Execute tool with user authorization
        result = await executor.execute_tool(
            server_name="github-mcp",
            tool_name="create_issue",
            parameters={"title": "Test Issue", "body": "Test body"},
            agent_token=mock_agent_token,
            session_id="test-session",
            user_auth_code=mock_user_auth_code
        )

        assert "issue" in result
        assert result["issue"]["title"] == "Test Issue"

        # Verify tool call included user auth code
        call_args = mock_connection.call_tool.call_args[0][0]
        assert call_args.user_auth_code == mock_user_auth_code

    @pytest.mark.asyncio
    async def test_batch_tool_execution(self, github_server_config, mock_agent_token):
        """Test batch execution of multiple tools."""
        # Mock connection pool
        mock_connection = AsyncMock()
        mock_connection.call_tool = AsyncMock(side_effect=[
            {"repositories": [{"name": "repo1"}]},
            {"issue": {"id": 123, "title": "Issue 1"}},
            {"issue": {"id": 124, "title": "Issue 2"}}
        ])

        mock_pool = AsyncMock()
        mock_pool.get_connection = AsyncMock(return_value=mock_connection)

        # Create tool registry and executor
        tool_registry = ToolRegistry()
        await tool_registry.register_server_tools("github-mcp", ["list_repositories", "create_issue"])

        executor = MCPToolExecutor(
            mock_pool, tool_registry, {"github-mcp": github_server_config}
        )

        # Batch tool calls
        tool_calls = [
            {
                "server_name": "github-mcp",
                "tool_name": "list_repositories",
                "parameters": {}
            },
            {
                "server_name": "github-mcp",
                "tool_name": "create_issue",
                "parameters": {"title": "Issue 1"}
            },
            {
                "server_name": "github-mcp",
                "tool_name": "create_issue",
                "parameters": {"title": "Issue 2"}
            }
        ]

        results = await executor.batch_execute_tools(
            tool_calls=tool_calls,
            agent_token=mock_agent_token,
            session_id="batch-session"
        )

        assert len(results) == 3
        assert "repositories" in results[0]
        assert results[1]["issue"]["title"] == "Issue 1"
        assert results[2]["issue"]["title"] == "Issue 2"

        # Verify all tools were called
        assert mock_connection.call_tool.call_count == 3


class TestEndToEndMCPIntegration:
    """End-to-end integration tests combining OAuth and MCP functionality."""

    @pytest.mark.asyncio
    async def test_complete_mcp_workflow_with_oauth(self, integration_config):
        """Test complete workflow from OAuth registration to MCP tool execution."""
        # Mock OAuth responses
        registration_response = {
            "client_id": "e2e-test-client",
            "client_secret": "e2e-test-secret",
            "registration_access_token": "e2e-reg-token",
            "client_secret_expires_at": 0
        }

        token_response = {
            "access_token": "e2e-agent-token",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile mcp:access"
        }

        # Factory: call_tool() reconnects when the agent token is first seen,
        # so every opened socket must be able to serve the whole sequence.
        def ws_factory():
            return FakeJsonRpcServerWebSocket(
                tools=["list_repositories", "create_issue"],
                tool_responses=[{
                    "result": {"repositories": [{"name": "integration-repo"}]}
                }],
            )

        with aioresponses() as m:
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            m.post(
                integration_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )

            with _patched_connect(ws_factory):
                # Step 1: Set up OAuth manager (auto_register/auto_cleanup off
                # so the single-shot aioresponses mocks are consumed only by
                # the explicit calls below)
                async with OAuthAuthenticationManager(
                    integration_config, auto_register=False, auto_cleanup=False
                ) as oauth_mgr:
                    # Register OAuth client
                    credentials = await oauth_mgr.register_client()
                    assert credentials.client_id == "e2e-test-client"

                    # Get agent token
                    agent_token = await oauth_mgr.get_client_credentials_token()
                    assert agent_token.token == "e2e-agent-token"

                    # Step 2: Set up MCP client manager
                    mcp_manager = MCPClientManager()

                    # Register MCP server
                    server_config = MCPServerConfig(
                        name="github-mcp",
                        endpoint="ws://localhost:8080/mcp/github",
                        capabilities=["tool_execution"],
                        auth_requirements=AuthRequirements(
                            type=AuthRequirementType.AGENT_TOKEN,
                            scopes=["repo"]
                        )
                    )

                    await mcp_manager.register_server(server_config)

                    # Step 3: Execute tool with agent token
                    result = await mcp_manager.execute_tool(
                        server_name="github-mcp",
                        tool_name="list_repositories",
                        parameters={},
                        agent_token=agent_token,
                        session_id="e2e-session"
                    )

                    assert "repositories" in result
                    assert result["repositories"][0]["name"] == "integration-repo"

                    await mcp_manager.shutdown()

    @pytest.mark.asyncio
    async def test_mcp_auth_challenge_with_oauth_flow(self, integration_config):
        """Test MCP authentication challenge integrated with OAuth flow."""
        # Mock OAuth responses
        registration_response = {
            "client_id": "auth-challenge-client",
            "client_secret": "auth-challenge-secret",
            "registration_access_token": "auth-challenge-reg-token",
            "client_secret_expires_at": 0
        }

        token_response = {
            "access_token": "auth-challenge-agent-token",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile mcp:access"
        }

        # Mock MCP server that answers the tools/call with an auth challenge
        ws = FakeJsonRpcServerWebSocket(
            tools=["create_issue"],
            tool_responses=[{
                "result": {
                    "type": "auth_challenge",
                    "challenge_type": "oauth_authorization_code",
                    "authorization_url": "https://github.com/login/oauth/authorize?client_id=auth-challenge-client&scope=repo&state=challenge-state",
                    "scope": "repo",
                    "state": "challenge-state"
                }
            }],
        )

        with aioresponses() as m:
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            m.post(
                integration_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )

            with _patched_connect(ws):
                # Set up OAuth manager
                async with OAuthAuthenticationManager(
                    integration_config, auto_register=False, auto_cleanup=False
                ) as oauth_mgr:
                    await oauth_mgr.register_client()
                    agent_token = await oauth_mgr.get_client_credentials_token()

                    # Set up MCP connection
                    server_config = MCPServerConfig(
                        name="github-mcp",
                        endpoint="ws://localhost:8080/mcp/github",
                        capabilities=["tool_execution", "authentication"],
                        auth_requirements=AuthRequirements(
                            type=AuthRequirementType.BOTH,
                            scopes=["repo"]
                        )
                    )

                    connection = MCPConnection(server_config)
                    # Pre-set the agent token so call_tool() does not take the
                    # "token changed -> reconnect" path.
                    connection._agent_token = agent_token.token
                    await connection.connect(server_config)

                    # Execute tool that triggers auth challenge
                    tool_call = MCPToolCall(
                        tool_name="create_issue",
                        parameters={"title": "Test Issue"},
                        agent_token=agent_token,
                        user_auth_code=None,
                        session_id="auth-challenge-session"
                    )

                    result = await connection.call_tool(tool_call)

                    # Verify auth challenge was received
                    assert result["type"] == "auth_challenge"
                    challenge = result["challenge"]
                    assert challenge.challenge_type == "oauth_authorization_code"
                    assert "github.com" in challenge.authorization_url

                    # Generate user authorization URL using OAuth manager
                    user_auth_url = oauth_mgr.generate_user_authorization_url(
                        scope=challenge.scope,
                        session_id="auth-challenge-session",
                        mcp_server_id="github-mcp"
                    )

                    assert "response_type=code" in user_auth_url
                    assert "scope=repo" in user_auth_url

                    await connection.disconnect()

    @pytest.mark.asyncio
    async def test_multiple_mcp_servers_with_different_auth(self, integration_config):
        """Test managing multiple MCP servers with different authentication requirements."""
        # Mock OAuth responses
        registration_response = {
            "client_id": "multi-server-client",
            "client_secret": "multi-server-secret",
            "registration_access_token": "multi-server-reg-token",
            "client_secret_expires_at": 0
        }

        token_response = {
            "access_token": "multi-server-agent-token",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile mcp:access"
        }

        with aioresponses() as m:
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            m.post(
                integration_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )

            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                await oauth_mgr.register_client()
                agent_token = await oauth_mgr.get_client_credentials_token()

                # Create MCP client manager
                mcp_manager = MCPClientManager()

                # Server 1: Requires only agent token
                server1_config = MCPServerConfig(
                    name="simple-mcp",
                    endpoint="ws://localhost:8080/mcp/simple",
                    capabilities=["tool_execution"],
                    auth_requirements=AuthRequirements(
                        type=AuthRequirementType.AGENT_TOKEN,
                        scopes=["read"]
                    )
                )

                # Server 2: Requires user authorization
                server2_config = MCPServerConfig(
                    name="user-auth-mcp",
                    endpoint="ws://localhost:8080/mcp/userauth",
                    capabilities=["tool_execution", "authentication"],
                    auth_requirements=AuthRequirements(
                        type=AuthRequirementType.USER_AUTHORIZATION,
                        scopes=["user:read", "user:write"]
                    )
                )

                # Server 3: Requires both
                server3_config = MCPServerConfig(
                    name="both-auth-mcp",
                    endpoint="ws://localhost:8080/mcp/both",
                    capabilities=["tool_execution", "authentication"],
                    auth_requirements=AuthRequirements(
                        type=AuthRequirementType.BOTH,
                        scopes=["admin"]
                    )
                )

                # Mock connections for each server
                with patch.object(mcp_manager.connection_pool, 'get_connection') as mock_get_conn:
                    mock_connections = {
                        "simple-mcp": AsyncMock(),
                        "user-auth-mcp": AsyncMock(),
                        "both-auth-mcp": AsyncMock()
                    }

                    # Configure mock connections
                    for server_name, mock_conn in mock_connections.items():
                        mock_conn.list_tools = AsyncMock(return_value=[f"{server_name}_tool"])
                        mock_conn.get_tool_schema = AsyncMock(return_value=None)

                    def get_connection_side_effect(server_config):
                        return mock_connections[server_config.name]

                    mock_get_conn.side_effect = get_connection_side_effect

                    # Register all servers
                    await mcp_manager.register_server(server1_config)
                    await mcp_manager.register_server(server2_config)
                    await mcp_manager.register_server(server3_config)

                    # Verify all servers are registered
                    available_tools = await mcp_manager.get_available_tools()
                    assert "simple-mcp" in available_tools
                    assert "user-auth-mcp" in available_tools
                    assert "both-auth-mcp" in available_tools

                    # Verify authentication requirements are preserved
                    assert server1_config.requires_agent_token()
                    assert not server1_config.requires_user_authorization()

                    assert not server2_config.requires_agent_token()
                    assert server2_config.requires_user_authorization()

                    assert server3_config.requires_agent_token()
                    assert server3_config.requires_user_authorization()

                await mcp_manager.shutdown()


class TestMCPErrorHandlingIntegration:
    """Integration tests for MCP error handling scenarios."""

    @pytest.mark.asyncio
    async def test_mcp_server_connection_failure(self, github_server_config):
        """Test handling of MCP server connection failures."""
        with patch('websockets.connect', side_effect=ConnectionError("Connection refused")):
            connection = MCPConnection(github_server_config, max_retries=2, retry_delay=0.1)

            with pytest.raises(ConnectionError):
                await connection.connect(github_server_config)

            assert connection.state == ConnectionState.FAILED
            assert not connection.is_connected

    @pytest.mark.asyncio
    async def test_mcp_tool_execution_error(self, github_server_config, mock_agent_token):
        """Test handling of tool execution errors from MCP server."""
        ws = FakeJsonRpcServerWebSocket(
            tools=["failing_tool"],
            tool_responses=[{
                "error": {
                    "code": -32000,
                    "message": "Tool execution failed: Invalid parameters"
                }
            }],
        )

        with _patched_connect(ws):
            connection = MCPConnection(github_server_config)
            # Pre-set the agent token so call_tool() does not take the
            # "token changed -> reconnect" path.
            connection._agent_token = mock_agent_token.token
            await connection.connect(github_server_config)

            tool_call = MCPToolCall(
                tool_name="failing_tool",
                parameters={"invalid": "params"},
                agent_token=mock_agent_token,
                user_auth_code=None,
                session_id="error-session"
            )

            with pytest.raises(Exception, match="Tool execution failed"):
                await connection.call_tool(tool_call)

            await connection.disconnect()

    @pytest.mark.asyncio
    async def test_expired_token_handling(self, github_server_config):
        """Test handling of expired agent tokens."""
        # Create expired token
        expired_token = AccessToken(
            token="expired-token",
            token_type="Bearer",
            expires_in=3600,
            scope="openid profile",
            issued_at=datetime.now(timezone.utc) - timedelta(hours=2)  # Expired
        )

        tool_registry = ToolRegistry()
        await tool_registry.register_server_tools("github-mcp", ["test_tool"])

        mock_pool = AsyncMock()
        executor = MCPToolExecutor(
            mock_pool, tool_registry, {"github-mcp": github_server_config}
        )

        with pytest.raises(ValueError, match="Agent token is expired"):
            await executor.execute_tool(
                server_name="github-mcp",
                tool_name="test_tool",
                parameters={},
                agent_token=expired_token,
                session_id="expired-token-session"
            )
