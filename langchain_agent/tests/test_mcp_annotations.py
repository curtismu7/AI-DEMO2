"""
Tests for MCP tool annotations pipeline:
connection.py -> ToolInfo -> MCPTool.metadata
"""
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from mcp.tool_registry import ToolInfo, ToolRegistry


def test_toolinfo_carries_annotations():
    """ToolInfo dataclass should store and expose annotations."""
    annotations = {"userFacing": {"destructive": True, "idempotent": False, "readable": False}}
    tool_info = ToolInfo(
        name="create_withdrawal",
        server_name="banking",
        description="Make a withdrawal",
        parameters={"type": "object", "properties": {}},
        annotations=annotations
    )
    assert tool_info.annotations is not None
    assert tool_info.annotations["userFacing"]["destructive"] is True
    assert tool_info.annotations["userFacing"]["idempotent"] is False


def test_mcptool_metadata_populated():
    """MCPTool.metadata should be populated from tool_info.annotations."""
    from agent.mcp_tool_provider import MCPTool

    annotations = {"userFacing": {"destructive": True, "idempotent": False, "readable": False}}
    tool_info = ToolInfo(
        name="create_withdrawal",
        server_name="banking",
        description="Make a withdrawal",
        parameters={"type": "object", "properties": {}},
        annotations=annotations
    )

    mock_manager = MagicMock()
    mock_auth = MagicMock()

    tool = MCPTool(
        tool_info=tool_info,
        mcp_client_manager=mock_manager,
        auth_manager=mock_auth
    )

    assert tool.metadata["destructive"] is True
    assert tool.metadata["idempotent"] is False


async def test_destructive_tools_flagged():
    """register_server_tools should capture annotations so ToolInfo.annotations is populated."""
    registry = ToolRegistry()

    tool_schemas = {
        "create_withdrawal": {
            "name": "create_withdrawal",
            "description": "Make a withdrawal",
            "inputSchema": {"type": "object", "properties": {}},
            "annotations": {"userFacing": {"destructive": True, "idempotent": False, "readable": False}}
        },
        "get_my_accounts": {
            "name": "get_my_accounts",
            "description": "List accounts",
            "inputSchema": {"type": "object", "properties": {}},
            "annotations": {"userFacing": {"destructive": False, "idempotent": True, "readable": True}}
        }
    }

    # Run on the pytest-asyncio loop (asyncio_mode=auto) — the old
    # asyncio.get_event_loop().run_until_complete() broke when this file ran
    # after suites that closed the default event loop.
    await registry.register_server_tools(
        server_name="banking",
        tools=["create_withdrawal", "get_my_accounts"],
        tool_schemas=tool_schemas
    )

    tools = await registry.get_all_tools()

    withdrawal_info = tools["banking.create_withdrawal"]
    accounts_info = tools["banking.get_my_accounts"]

    assert withdrawal_info.annotations is not None
    assert withdrawal_info.annotations["userFacing"]["destructive"] is True

    assert accounts_info.annotations is not None
    assert accounts_info.annotations["userFacing"]["destructive"] is False


def test_annotations_default_to_safe():
    """MCPTool built from ToolInfo with no annotations should have destructive=False."""
    from agent.mcp_tool_provider import MCPTool

    tool_info = ToolInfo(
        name="get_my_accounts",
        server_name="banking",
        description="List accounts",
        parameters={"type": "object", "properties": {}}
        # annotations not provided — should default to None
    )

    mock_manager = MagicMock()
    mock_auth = MagicMock()

    tool = MCPTool(
        tool_info=tool_info,
        mcp_client_manager=mock_manager,
        auth_manager=mock_auth
    )

    assert tool.metadata["destructive"] is False
    assert tool.metadata["idempotent"] is True
    assert tool.metadata["readable"] is True
