"""
Standalone external MCP client — the "external agent" a person runs to reach
either front door (Agent Gateway or Privilege-agentless) and call a real
banking tool. Not part of the live LangGraph agent request path; a proof
harness and a usable minimal client in one.

Usage:
    python -m src.mcp.external_client --server agent_gateway
    python -m src.mcp.external_client --server privilege --call get_my_accounts '{}'
"""
import argparse
import asyncio
import json
import logging
import sys
import uuid
from typing import Any, Dict, Optional

from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.config.settings import get_config, get_mcp_server_configs
from src.mcp.connection import MCPConnection, StreamableHttpMCPConnection
from src.mcp.privilege_auth import authorize_and_get_token
from src.models.mcp import AuthRequirements, AuthRequirementType, MCPServerConfig, MCPToolCall

logger = logging.getLogger(__name__)

_VALID_SERVERS = ("agent_gateway", "privilege")


def _build_server_config(server_name: str) -> MCPServerConfig:
    """Look up MCP_SERVER_{NAME}_ENDPOINT for the given door and build a MCPServerConfig."""
    configured = get_mcp_server_configs()
    raw = configured.get(server_name)
    if not raw:
        raise ValueError(
            f"No MCP_SERVER_{server_name.upper()}_ENDPOINT configured for door {server_name!r}"
        )
    return MCPServerConfig(
        name=server_name,
        endpoint=raw["endpoint"],
        capabilities=raw.get("capabilities", []),
        auth_requirements=AuthRequirements(type=AuthRequirementType.AGENT_TOKEN, scopes=["read", "write"]),
    )


async def _get_agent_gateway_token(scopes: Optional[list] = None):
    """Reuse the live agent's own client-credentials mechanism (DCR + token fetch)."""
    async with OAuthAuthenticationManager() as auth_manager:
        return await auth_manager.get_client_credentials_token(additional_scopes=scopes)


async def run(
    server_name: str, tool_name: Optional[str], tool_args: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Connect to the named door, list tools, and optionally call one. Returns the result."""
    if server_name not in _VALID_SERVERS:
        raise ValueError(f"server_name must be one of {_VALID_SERVERS}, got {server_name!r}")

    server_config = _build_server_config(server_name)
    session_id = str(uuid.uuid4())

    if server_name == "agent_gateway":
        token = await _get_agent_gateway_token()
        connection_cls = StreamableHttpMCPConnection if server_config.endpoint.startswith(
            ("http://", "https://")
        ) else MCPConnection
    else:  # privilege
        token = await authorize_and_get_token(get_config().privilege)
        connection_cls = StreamableHttpMCPConnection

    conn = connection_cls(server_config)
    # Prime the bearer token before the first connect()/list_tools() call.
    # The two connection classes use DIFFERENT private attributes for this —
    # MCPConnection (WS) reads self._agent_token at connect() to set the
    # WebSocket handshake's Authorization header (connection.py:130,190-191);
    # StreamableHttpMCPConnection reads self._authorization_header on every
    # POST (connection.py:1139-1140). Both are already set the same way by
    # the existing test suite (test_mcp_connection.py, test_mcp_streamable_http.py:236)
    # — no new public setter needed, just the right attribute per class.
    if connection_cls is MCPConnection:
        conn._agent_token = token.token
    else:
        conn._authorization_header = token.token

    if tool_name is None:
        tools = await conn.list_tools()
        return {"tools": tools}

    tool_call = MCPToolCall(
        tool_name=tool_name,
        parameters=tool_args or {},
        agent_token=token,
        user_auth_code=None,
        session_id=session_id,
    )
    return await conn.call_tool(tool_call)


def _parse_args(argv):
    parser = argparse.ArgumentParser(description="External MCP client — reach either front door")
    parser.add_argument("--server", required=True, choices=_VALID_SERVERS, help="Which front door to use")
    parser.add_argument("--call", nargs=2, metavar=("TOOL_NAME", "JSON_ARGS"), default=None,
                         help="Tool to call and its JSON arguments, e.g. --call get_my_accounts '{}'")
    return parser.parse_args(argv)


async def main_async(argv):
    args = _parse_args(argv)
    tool_name, tool_args = None, None
    if args.call:
        tool_name, raw_args = args.call
        tool_args = json.loads(raw_args)

    result = await run(server_name=args.server, tool_name=tool_name, tool_args=tool_args)
    print(json.dumps(result, indent=2))


def main():
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main_async(sys.argv[1:]))


if __name__ == "__main__":
    main()
