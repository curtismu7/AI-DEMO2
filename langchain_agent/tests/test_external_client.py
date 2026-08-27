"""
Unit tests for external_client.py's door-selection and connection wiring.
Both doors are exercised with mocked connections — no live network calls.
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _access_token(tok="test-token"):
    from src.models.auth import AccessToken
    return AccessToken(
        token=tok, token_type="Bearer", expires_in=3600,
        scope="read", issued_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_run_agent_gateway_uses_oauth_authentication_manager():
    from src.mcp import external_client

    mock_server_config = MagicMock()
    mock_server_config.endpoint = "ws://localhost:8080/mcp"

    mock_conn = AsyncMock()
    mock_conn.list_tools = AsyncMock(return_value=["get_my_accounts"])
    mock_conn.call_tool = AsyncMock(return_value={"accounts": ["chk-1"]})

    mock_auth_manager = AsyncMock()
    mock_auth_manager.get_client_credentials_token = AsyncMock(return_value=_access_token("gw-token"))
    mock_auth_manager.__aenter__ = AsyncMock(return_value=mock_auth_manager)
    mock_auth_manager.__aexit__ = AsyncMock(return_value=False)

    with patch.object(external_client, "_build_server_config", return_value=mock_server_config), \
         patch.object(external_client, "MCPConnection", return_value=mock_conn), \
         patch.object(external_client, "OAuthAuthenticationManager", return_value=mock_auth_manager):
        result = await external_client.run(
            server_name="agent_gateway", tool_name="get_my_accounts", tool_args={}
        )

    assert result == {"accounts": ["chk-1"]}
    mock_conn.call_tool.assert_called_once()
    # MCPConnection (WS) reads _agent_token, NOT _authorization_header —
    # the two connection classes use different attribute names (see
    # connection.py:130 vs :933). Assert the WS-specific one so a future
    # regression that sets the wrong attribute (silently sending no
    # Authorization header over WS) fails this test instead of shipping.
    assert mock_conn._agent_token == "gw-token"


@pytest.mark.asyncio
async def test_run_privilege_uses_pkce_flow():
    from src.mcp import external_client

    mock_server_config = MagicMock()
    mock_server_config.endpoint = "https://cmuir-agentless-mcpgw.ping-devops.com/app/mcp"

    mock_conn = AsyncMock()
    mock_conn.list_tools = AsyncMock(return_value=["get_my_accounts"])
    mock_conn.call_tool = AsyncMock(return_value={"accounts": ["chk-1"]})

    mock_config = MagicMock()
    mock_config.privilege = MagicMock()

    with patch.object(external_client, "_build_server_config", return_value=mock_server_config), \
         patch.object(external_client, "StreamableHttpMCPConnection", return_value=mock_conn), \
         patch.object(external_client, "get_config", return_value=mock_config), \
         patch.object(
             external_client, "authorize_and_get_token",
             new=AsyncMock(return_value=_access_token("priv-token")),
         ):
        result = await external_client.run(
            server_name="privilege", tool_name="get_my_accounts", tool_args={}
        )

    assert result == {"accounts": ["chk-1"]}
    assert mock_conn._authorization_header == "priv-token"


@pytest.mark.asyncio
async def test_run_list_tools_only_when_no_tool_name():
    from src.mcp import external_client

    mock_server_config = MagicMock()
    mock_server_config.endpoint = "ws://localhost:8080/mcp"

    mock_conn = AsyncMock()
    mock_conn.list_tools = AsyncMock(return_value=["get_my_accounts", "get_transactions"])

    mock_auth_manager = AsyncMock()
    mock_auth_manager.get_client_credentials_token = AsyncMock(return_value=_access_token())
    mock_auth_manager.__aenter__ = AsyncMock(return_value=mock_auth_manager)
    mock_auth_manager.__aexit__ = AsyncMock(return_value=False)

    with patch.object(external_client, "_build_server_config", return_value=mock_server_config), \
         patch.object(external_client, "MCPConnection", return_value=mock_conn), \
         patch.object(external_client, "OAuthAuthenticationManager", return_value=mock_auth_manager):
        result = await external_client.run(server_name="agent_gateway", tool_name=None, tool_args=None)

    assert result == {"tools": ["get_my_accounts", "get_transactions"]}
    mock_conn.call_tool.assert_not_called()


@pytest.mark.asyncio
async def test_invalid_server_name_raises_before_any_connection():
    from src.mcp import external_client
    with pytest.raises(ValueError, match="server_name must be one of"):
        await external_client.run(server_name="bogus", tool_name=None, tool_args=None)
