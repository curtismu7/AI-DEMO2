"""
Integration test for LangChain MCP Agent core functionality.
"""
import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timezone

from src.agent.langchain_mcp_agent import LangChainMCPAgent
from src.agent.mcp_tool_provider import MCPToolProvider
from src.agent.conversation_memory import ConversationMemory
from src.mcp.tool_registry import MCPClientManager, ToolInfo
from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.models.auth import AccessToken
from src.config.settings import AppConfig, ChatConfig, LangChainConfig


@pytest.mark.asyncio
async def test_langchain_agent_integration():
    """Integration test for LangChain MCP Agent core functionality."""
    
    # Setup configuration
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

    # Setup mock dependencies
    mock_mcp_client_manager = Mock(spec=MCPClientManager)
    mock_mcp_client_manager.get_manager_status = AsyncMock(return_value={
        "registered_servers": 1,
        "server_configs": ["test_server"],
        "tool_registry": {"total_tools": 1},
        "connection_pool": {"status": "active"}
    })
    mock_mcp_client_manager.shutdown = AsyncMock()
    
    mock_auth_manager = Mock(spec=OAuthAuthenticationManager)
    mock_auth_manager.get_client_credentials_token = AsyncMock(return_value=AccessToken(
        token="test-token",
        token_type="Bearer",
        expires_in=3600,
        scope="read write",
        issued_at=datetime.now(timezone.utc)
    ))
    
    # Create agent (LLM comes from the get_llm factory since the LangGraph migration)
    with patch('src.agent.langchain_mcp_agent.get_llm') as mock_get_llm:
        mock_llm = Mock()
        mock_llm.model_name = "gpt-3.5-turbo"
        mock_get_llm.return_value = mock_llm

        agent = LangChainMCPAgent(
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager,
            config=config
        )
        
        # Verify agent initialization
        assert agent.config == config
        assert agent.mcp_client_manager == mock_mcp_client_manager
        assert agent.auth_manager == mock_auth_manager
        assert isinstance(agent.mcp_tool_provider, MCPToolProvider)
        assert isinstance(agent.conversation_memory, ConversationMemory)
        
        # Test conversation memory
        session_id = "test-session-123"
        
        # Create a session
        session = await agent.conversation_memory.get_or_create_session(session_id)
        assert session.session_id == session_id
        
        # Add context
        await agent.conversation_memory.update_session_context(session_id, {"test_key": "test_value"})
        context = await agent.conversation_memory.get_session_context(session_id)
        assert context["test_key"] == "test_value"
        
        # Test tool provider
        tool_info = ToolInfo(
            name="test_tool",
            server_name="test_server",
            description="A test tool"
        )
        
        # Mock tool registry
        agent.mcp_tool_provider.mcp_client_manager.tool_registry = Mock()
        agent.mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            return_value={"test_server.test_tool": tool_info}
        )
        
        # Get tools
        tools = await agent.mcp_tool_provider.get_langchain_tools()
        assert len(tools) == 1
        assert tools[0].name == "test_server_test_tool"
        
        # Set session context
        await agent.mcp_tool_provider.set_session_context(session_id)
        assert agent.mcp_tool_provider.get_current_session_id() == session_id
        
        # Test agent status
        status = await agent.get_agent_status()
        assert "initialized" in status
        assert "tools_count" in status
        assert "memory_sessions" in status
        
        # Test message processing (without full LangChain setup).
        # The user is unidentified, so the unified pipeline (process_message
        # now delegates to process_message_with_tracing) asks for an email.
        response = await agent.process_message("Hello", session_id)
        assert "email address" in response.lower()
        
        # Cleanup
        await agent.shutdown()
        
        print("✅ LangChain MCP Agent integration test passed!")


if __name__ == "__main__":
    asyncio.run(test_langchain_agent_integration())