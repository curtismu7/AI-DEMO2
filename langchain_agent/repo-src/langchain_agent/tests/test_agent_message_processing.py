"""
Unit tests for agent message processing workflows.

Updated for the LangGraph migration + the process_message consolidation:
process_message is now a thin delegate to process_message_with_tracing, so
these tests exercise the unified pipeline (graph.astream_events) through the
public process_message contract (str in, str out).

The previous version of this file targeted the pre-LangGraph API
(ChatOpenAI / AgentExecutor / get_conversation_history) and errored at
fixture setup on every test.
"""
import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime
from types import SimpleNamespace

from langchain_core.messages import AIMessage

from src.agent.langchain_mcp_agent import LangChainMCPAgent
from src.mcp.tool_registry import MCPClientManager
from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.models.auth import AccessToken
from src.config.settings import AppConfig, ChatConfig, LangChainConfig


@pytest.fixture
def mock_config():
    """Mock configuration for testing."""
    langchain_config = LangChainConfig(
        model_name="gpt-3.5-turbo",
        temperature=0.7,
        max_tokens=1000,
        openai_api_key="test-key",
        verbose=False,
        max_iterations=10,
        max_execution_time=60
    )

    config = Mock(spec=AppConfig)
    config.langchain = langchain_config
    config.chat = ChatConfig()
    return config


@pytest.fixture
def mock_mcp_client_manager():
    """Mock MCP client manager."""
    manager = Mock(spec=MCPClientManager)
    manager.get_manager_status = AsyncMock(return_value={
        "registered_servers": 1,
        "server_configs": ["test_server"],
        "tool_registry": {"total_tools": 2},
        "connection_pool": {"status": "active"}
    })
    manager.shutdown = AsyncMock()
    manager._session_challenges = {}
    return manager


@pytest.fixture
def mock_auth_manager():
    """Mock OAuth authentication manager."""
    manager = Mock(spec=OAuthAuthenticationManager)
    manager.get_client_credentials_token = AsyncMock(return_value=AccessToken(
        token="test-token",
        token_type="Bearer",
        expires_in=3600,
        scope="read write",
        issued_at=datetime.now()
    ))
    return manager


@pytest.fixture
def mock_tools():
    """Mock LangChain tools."""
    tool1 = Mock()
    tool1.name = "test_server_tool1"
    tool1.description = "Test tool 1"
    tool1.arun = AsyncMock(return_value="Tool 1 executed successfully")

    tool2 = Mock()
    tool2.name = "test_server_tool2"
    tool2.description = "Test tool 2"
    tool2.arun = AsyncMock(return_value="Tool 2 executed successfully")

    return [tool1, tool2]


def _make_mock_graph(response_text="mock response"):
    """Mock CompiledStateGraph driving the astream_events pipeline."""

    async def fake_astream_events(*args, **kwargs):
        yield {
            "event": "on_chain_end",
            "data": {"output": {"messages": [AIMessage(content=response_text)]}},
        }

    mock_graph = AsyncMock()
    mock_graph.astream_events = fake_astream_events
    mock_graph.get_state = Mock(return_value=SimpleNamespace(values={"messages": []}))
    return mock_graph


@pytest.fixture
def agent_with_tools(mock_config, mock_mcp_client_manager, mock_auth_manager, mock_tools):
    """Create agent with an initialized (mock) graph and tools."""
    with patch('src.agent.langchain_mcp_agent.get_llm') as mock_get_llm:
        mock_llm = Mock()
        mock_llm.model_name = "gpt-3.5-turbo"
        mock_get_llm.return_value = mock_llm

        agent = LangChainMCPAgent(
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager,
            config=mock_config
        )

    mock_graph = _make_mock_graph()
    agent._graph = mock_graph
    agent._tools = mock_tools

    agent.mcp_tool_provider.get_langchain_tools = AsyncMock(return_value=mock_tools)
    agent.mcp_tool_provider.set_session_context = AsyncMock()
    agent.mcp_tool_provider.set_tracer = Mock()

    return agent, mock_graph


async def _identify(agent, session_id):
    """Mark the session's user as identified so the pipeline reaches the graph."""
    await agent.conversation_memory.set_user_identified(
        session_id, "user@test.com", "user-1"
    )


class TestAgentMessageProcessing:
    """Test cases for agent message processing workflows."""

    @pytest.mark.asyncio
    async def test_successful_message_processing(self, agent_with_tools):
        """process_message runs the unified pipeline and returns the graph response."""
        agent, _ = agent_with_tools

        session_id = "test-session-123"
        await _identify(agent, session_id)

        response = await agent.process_message("Can you help me with a task?", session_id)

        assert response == "mock response"
        agent.mcp_tool_provider.set_session_context.assert_called_with(session_id)
        # User + assistant turns recorded in conversation memory.
        messages = await agent.conversation_memory.get_raw_messages(session_id)
        roles = [m.role for m in messages]
        assert "user" in roles and "assistant" in roles

    @pytest.mark.asyncio
    async def test_thread_id_config_carries_session(self, agent_with_tools):
        """The graph is invoked with thread_id == session_id (checkpointed history)."""
        agent, _ = agent_with_tools

        session_id = "test-session-threading"
        await _identify(agent, session_id)

        captured_configs = []

        async def capturing_stream(*args, **kwargs):
            captured_configs.append(kwargs.get("config"))
            yield {
                "event": "on_chain_end",
                "data": {"output": {"messages": [AIMessage(content="ok")]}},
            }

        agent._graph.astream_events = capturing_stream

        await agent.process_message("What about the previous task?", session_id)

        assert len(captured_configs) == 1
        assert captured_configs[0]["configurable"]["thread_id"] == session_id

    @pytest.mark.asyncio
    async def test_message_processing_authentication_error(self, agent_with_tools):
        """Authentication errors map to the auth-error response."""
        agent, mock_graph = agent_with_tools

        session_id = "test-session-123"
        await _identify(agent, session_id)

        async def failing_stream(*args, **kwargs):
            raise Exception("Authentication failed")
            yield  # pragma: no cover — makes this an async generator

        mock_graph.astream_events = failing_stream

        response = await agent.process_message("Do something that requires auth", session_id)

        assert "authentication issue" in response.lower()
        assert "authorization" in response.lower()

    @pytest.mark.asyncio
    async def test_message_processing_timeout_error(self, agent_with_tools):
        """Timeout errors map to the took-too-long response."""
        agent, mock_graph = agent_with_tools

        session_id = "test-session-123"
        await _identify(agent, session_id)

        async def failing_stream(*args, **kwargs):
            raise Exception("Request timeout")
            yield  # pragma: no cover

        mock_graph.astream_events = failing_stream

        response = await agent.process_message("Do something that takes too long", session_id)

        assert "took too long" in response.lower()
        assert "try again" in response.lower()

    @pytest.mark.asyncio
    async def test_message_processing_generic_error(self, agent_with_tools):
        """Generic errors map to the generic error response."""
        agent, mock_graph = agent_with_tools

        session_id = "test-session-123"
        await _identify(agent, session_id)

        async def failing_stream(*args, **kwargs):
            raise Exception("Something went wrong")
            yield  # pragma: no cover

        mock_graph.astream_events = failing_stream

        response = await agent.process_message("Do something that fails", session_id)

        assert "encountered an error" in response.lower()
        assert "try again" in response.lower()

    @pytest.mark.asyncio
    async def test_direct_tool_execution_success(self, agent_with_tools):
        """Test direct tool execution workflow."""
        agent, _ = agent_with_tools

        session_id = "test-session-123"
        tool_name = "test_server_tool1"
        parameters = {"param1": "value1", "param2": "value2"}

        result = await agent.execute_tool(tool_name, parameters, session_id)

        assert result["result"] == "Tool 1 executed successfully"
        assert result["tool_name"] == tool_name
        assert result["parameters"] == parameters

        agent.mcp_tool_provider.set_session_context.assert_called_once_with(session_id)
        agent._tools[0].arun.assert_called_once_with(parameters)

    @pytest.mark.asyncio
    async def test_direct_tool_execution_tool_not_found(self, agent_with_tools):
        """Test direct tool execution with non-existent tool."""
        agent, _ = agent_with_tools

        with pytest.raises(ValueError, match="Tool 'nonexistent_tool' not found"):
            await agent.execute_tool("nonexistent_tool", {}, "test-session-123")

    @pytest.mark.asyncio
    async def test_direct_tool_execution_error(self, agent_with_tools):
        """Test direct tool execution with tool error."""
        agent, _ = agent_with_tools

        agent._tools[0].arun = AsyncMock(side_effect=Exception("Tool execution failed"))

        with pytest.raises(Exception, match="Tool execution failed"):
            await agent.execute_tool("test_server_tool1", {"param1": "value1"}, "test-session-123")

    @pytest.mark.asyncio
    async def test_error_handling_preserves_conversation_state(self, agent_with_tools):
        """Errors don't corrupt conversation state — the session stays usable."""
        agent, mock_graph = agent_with_tools

        session_id = "test-session-123"
        await _identify(agent, session_id)

        async def failing_stream(*args, **kwargs):
            raise Exception("Processing failed")
            yield  # pragma: no cover

        mock_graph.astream_events = failing_stream

        response = await agent.process_message("This will fail", session_id)

        assert "error" in response.lower()
        # User identity survives the error.
        assert await agent.conversation_memory.is_user_identified(session_id)

        # And a subsequent successful turn works.
        mock_graph.astream_events = _make_mock_graph("recovered").astream_events
        response = await agent.process_message("Try again", session_id)
        assert response == "recovered"

    @pytest.mark.asyncio
    async def test_concurrent_message_processing(self, agent_with_tools):
        """Concurrent turns in DIFFERENT sessions all complete with responses."""
        agent, mock_graph = agent_with_tools

        session_ids = [f"session-{i}" for i in range(1, 4)]
        for sid in session_ids:
            await _identify(agent, sid)

        tasks = [
            agent.process_message(f"Message {i}", sid)
            for i, sid in enumerate(session_ids, start=1)
        ]

        results = await asyncio.gather(*tasks)

        assert len(results) == 3
        assert all(r == "mock response" for r in results)
        # Every session had its tool context set.
        called_sessions = {
            c.args[0] for c in agent.mcp_tool_provider.set_session_context.call_args_list
        }
        assert set(session_ids) <= called_sessions


if __name__ == "__main__":
    pytest.main([__file__])
