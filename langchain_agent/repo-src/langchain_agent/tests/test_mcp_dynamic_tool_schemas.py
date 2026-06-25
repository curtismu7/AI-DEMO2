"""Regression tests for metadata-first MCP dynamic tool schemas."""

import pytest

from src.agent.mcp_tool_provider import MCPToolInput, create_tool_input_schema
from src.mcp.tool_registry import ToolInfo, ToolRegistry


def _field_names(schema_cls):
    """Support both Pydantic v1 (__fields__) and v2 (model_fields)."""
    if hasattr(schema_cls, "model_fields"):
        return set(schema_cls.model_fields.keys())
    return set(schema_cls.__fields__.keys())


def _is_required(schema_cls, field_name: str) -> bool:
    if hasattr(schema_cls, "model_fields"):
        return schema_cls.model_fields[field_name].is_required()
    return schema_cls.__fields__[field_name].required


def test_provider_uses_server_metadata_schema_for_read_tool():
    tool_info = ToolInfo(
        name="get_account_balance",
        server_name="banking",
        parameters={
            "type": "object",
            "properties": {
                "account_id": {"type": "string", "description": "Account identifier"}
            },
            "required": ["account_id"],
        },
    )

    schema_cls = create_tool_input_schema(tool_info)

    assert schema_cls is not MCPToolInput
    assert "account_id" in _field_names(schema_cls)
    assert _is_required(schema_cls, "account_id") is True


def test_provider_uses_server_metadata_schema_for_write_tool():
    tool_info = ToolInfo(
        name="create_transfer",
        server_name="banking",
        parameters={
            "type": "object",
            "properties": {
                "from_account_id": {"type": "string"},
                "to_account_id": {"type": "string"},
                "amount": {"type": "number"},
                "description": {"type": "string"},
            },
            "required": ["from_account_id", "to_account_id", "amount"],
        },
    )

    schema_cls = create_tool_input_schema(tool_info)
    fields = _field_names(schema_cls)

    assert schema_cls is not MCPToolInput
    assert {"from_account_id", "to_account_id", "amount", "description"}.issubset(fields)
    assert _is_required(schema_cls, "from_account_id") is True
    assert _is_required(schema_cls, "to_account_id") is True
    assert _is_required(schema_cls, "amount") is True
    assert _is_required(schema_cls, "description") is False


@pytest.mark.asyncio
async def test_registry_metadata_plumbing_and_generic_fallback():
    registry = ToolRegistry()

    tool_schemas = {
        "list_accounts": {
            "description": "List available bank accounts",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "include_closed": {"type": "boolean"}
                },
                "required": [],
            },
        },
        # Bare JSON schema should also be accepted by the registry.
        "raw_schema_tool": {
            "type": "object",
            "properties": {
                "query": {"type": "string"}
            },
            "required": ["query"],
        },
    }

    await registry.register_server_tools(
        "banking",
        ["list_accounts", "raw_schema_tool", "unknown_tool"],
        tool_schemas=tool_schemas,
    )

    list_accounts = await registry.get_tool_info("banking.list_accounts")
    raw_schema_tool = await registry.get_tool_info("banking.raw_schema_tool")
    unknown_tool = await registry.get_tool_info("banking.unknown_tool")

    assert list_accounts is not None
    assert raw_schema_tool is not None
    assert unknown_tool is not None

    assert "include_closed" in list_accounts.parameters["properties"]
    assert "query" in raw_schema_tool.parameters["properties"]

    # No metadata for unknown tool should trigger generic provider fallback.
    unknown_schema = create_tool_input_schema(unknown_tool)
    assert unknown_schema is MCPToolInput
