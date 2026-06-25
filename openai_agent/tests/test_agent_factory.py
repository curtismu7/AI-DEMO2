import pytest
from unittest.mock import patch, MagicMock


TOOL_SCHEMAS = [
    {"name": "get_accounts", "description": "List accounts.", "inputSchema": {"type": "object", "properties": {}}}
]
RUN_CTX = {
    "bff_tool_url": "http://127.0.0.1:3001/internal/agent-tool",
    "bff_internal_secret": "secret",
    "session_id": "sess_abc",
}


def test_build_agent_returns_agent_with_tools():
    from src.agent_factory import build_agent
    agent = build_agent(
        tool_schemas=TOOL_SCHEMAS,
        run_ctx=RUN_CTX,
        model="gpt-4o",
        api_key="sk-test",
    )
    assert hasattr(agent, "tools")
    assert len(agent.tools) == 1


def test_build_agent_sets_system_prompt():
    from src.agent_factory import build_agent
    agent = build_agent(
        tool_schemas=TOOL_SCHEMAS,
        run_ctx=RUN_CTX,
        model="gpt-4o",
        api_key="sk-test",
        system_prompt="You are a banking assistant.",
    )
    assert "banking" in (agent.instructions or "").lower()


def test_build_agent_uses_default_prompt_when_none():
    from src.agent_factory import build_agent
    agent = build_agent(
        tool_schemas=TOOL_SCHEMAS,
        run_ctx=RUN_CTX,
        model="gpt-4o",
        api_key="sk-test",
    )
    assert agent.instructions is not None
    assert len(agent.instructions) > 0
