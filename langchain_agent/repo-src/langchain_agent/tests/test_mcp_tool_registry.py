"""
Unit tests for MCP tool registry and execution.
"""
import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from datetime import datetime, timedelta
import json

from mcp.tool_registry import ToolInfo, ToolRegistry, MCPToolExecutor, MCPClientManager
from mcp.connection import MCPConnectionPool, MCPConnection
from models.mcp import MCPServerConfig, AuthRequirements, AuthRequirementType, MCPToolCall
from models.auth import AccessToken, AuthorizationCode


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
    from datetime import timezone
    return AccessToken(
        token="test-token-123",
        token_type="Bearer",
        expires_in=3600,
        scope="read write",
        issued_at=datetime.now(timezone.utc)
    )


@pytest.fixture
def sample_auth_code():
    """Sample authorization code for testing"""
    from datetime import timezone
    return AuthorizationCode(
        code="auth-code-123",
        state="state-456",
        session_id="session-789",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10)
    )


class TestToolInfo:
    """Test cases for ToolInfo class"""
    
    def test_tool_info_creation(self):
        """Test ToolInfo creation and validation"""
        tool_info = ToolInfo(
            name="test_tool",
            server_name="test_server",
            description="A test tool",
            parameters={"param1": "string"}
        )
        
        assert tool_info.name == "test_tool"
        assert tool_info.server_name == "test_server"
        assert tool_info.description == "A test tool"
        assert tool_info.full_name == "test_server.test_tool"
    
    def test_tool_info_validation(self):
        """Test ToolInfo validation"""
        with pytest.raises(ValueError, match="name must be a non-empty string"):
            ToolInfo(name="", server_name="test_server")
        
        with pytest.raises(ValueError, match="server_name must be a non-empty string"):
            ToolInfo(name="test_tool", server_name="")


class TestToolRegistry:
    """Test cases for ToolRegistry class"""
    
    @pytest.mark.asyncio
    async def test_registry_initialization(self):
        """Test tool registry initialization"""
        registry = ToolRegistry()
        
        tools = await registry.get_all_tools()
        assert len(tools) == 0
        
        stats = await registry.get_registry_stats()
        assert stats["total_tools"] == 0
        assert stats["total_servers"] == 0
    
    @pytest.mark.asyncio
    async def test_register_server_tools(self):
        """Test registering tools for a server"""
        registry = ToolRegistry()
        
        tools = ["tool1", "tool2", "tool3"]
        descriptions = {
            "tool1": "First tool",
            "tool2": "Second tool"
        }
        
        await registry.register_server_tools("server1", tools, descriptions)
        
        all_tools = await registry.get_all_tools()
        assert len(all_tools) == 3
        
        assert "server1.tool1" in all_tools
        assert "server1.tool2" in all_tools
        assert "server1.tool3" in all_tools
        
        tool1_info = all_tools["server1.tool1"]
        assert tool1_info.name == "tool1"
        assert tool1_info.server_name == "server1"
        assert tool1_info.description == "First tool"
        
        tool3_info = all_tools["server1.tool3"]
        assert tool3_info.description is None
    
    @pytest.mark.asyncio
    async def test_register_multiple_servers(self):
        """Test registering tools for multiple servers"""
        registry = ToolRegistry()
        
        await registry.register_server_tools("server1", ["tool1", "tool2"])
        await registry.register_server_tools("server2", ["tool3", "tool4"])
        
        all_tools = await registry.get_all_tools()
        assert len(all_tools) == 4
        
        server1_tools = await registry.get_server_tools("server1")
        assert len(server1_tools) == 2
        assert all(tool.server_name == "server1" for tool in server1_tools)
        
        server2_tools = await registry.get_server_tools("server2")
        assert len(server2_tools) == 2
        assert all(tool.server_name == "server2" for tool in server2_tools)
    
    @pytest.mark.asyncio
    async def test_reregister_server_tools(self):
        """Test re-registering tools for a server (should replace existing)"""
        registry = ToolRegistry()
        
        # Initial registration
        await registry.register_server_tools("server1", ["tool1", "tool2"])
        assert len(await registry.get_all_tools()) == 2
        
        # Re-register with different tools
        await registry.register_server_tools("server1", ["tool3", "tool4", "tool5"])
        
        all_tools = await registry.get_all_tools()
        assert len(all_tools) == 3
        
        # Old tools should be gone
        assert "server1.tool1" not in all_tools
        assert "server1.tool2" not in all_tools
        
        # New tools should be present
        assert "server1.tool3" in all_tools
        assert "server1.tool4" in all_tools
        assert "server1.tool5" in all_tools
    
    @pytest.mark.asyncio
    async def test_unregister_server(self):
        """Test unregistering a server"""
        registry = ToolRegistry()
        
        await registry.register_server_tools("server1", ["tool1", "tool2"])
        await registry.register_server_tools("server2", ["tool3", "tool4"])
        
        assert len(await registry.get_all_tools()) == 4
        
        await registry.unregister_server("server1")
        
        all_tools = await registry.get_all_tools()
        assert len(all_tools) == 2
        assert "server1.tool1" not in all_tools
        assert "server1.tool2" not in all_tools
        assert "server2.tool3" in all_tools
        assert "server2.tool4" in all_tools
    
    @pytest.mark.asyncio
    async def test_get_tool_info(self):
        """Test getting specific tool information"""
        registry = ToolRegistry()
        
        await registry.register_server_tools("server1", ["tool1"], {"tool1": "Test tool"})
        
        tool_info = await registry.get_tool_info("server1.tool1")
        assert tool_info is not None
        assert tool_info.name == "tool1"
        assert tool_info.server_name == "server1"
        assert tool_info.description == "Test tool"
        
        # Non-existent tool
        tool_info = await registry.get_tool_info("server1.nonexistent")
        assert tool_info is None
    
    @pytest.mark.asyncio
    async def test_find_tools(self):
        """Test finding tools by pattern"""
        registry = ToolRegistry()
        
        await registry.register_server_tools("server1", ["search_tool", "data_tool"], {
            "search_tool": "Tool for searching data",
            "data_tool": "Tool for data processing"
        })
        await registry.register_server_tools("server2", ["file_search", "network_tool"])
        
        # Find by tool name
        results = await registry.find_tools("search")
        assert len(results) == 2
        tool_names = [tool.full_name for tool in results]
        assert "server1.search_tool" in tool_names
        assert "server2.file_search" in tool_names
        
        # Find by description
        results = await registry.find_tools("data")
        assert len(results) == 2  # search_tool (description) and data_tool (name)
        
        # Find by server name
        results = await registry.find_tools("server1")
        assert len(results) == 2
        assert all(tool.server_name == "server1" for tool in results)
    
    @pytest.mark.asyncio
    async def test_registry_stats(self):
        """Test getting registry statistics"""
        registry = ToolRegistry()
        
        await registry.register_server_tools("server1", ["tool1", "tool2"])
        await registry.register_server_tools("server2", ["tool3"])
        
        stats = await registry.get_registry_stats()
        
        assert stats["total_tools"] == 3
        assert stats["total_servers"] == 2
        assert "server1" in stats["servers"]
        assert "server2" in stats["servers"]
        assert stats["servers"]["server1"]["tool_count"] == 2
        assert stats["servers"]["server2"]["tool_count"] == 1


class TestMCPToolExecutor:
    """Test cases for MCPToolExecutor class"""
    
    @pytest.fixture
    def mock_connection_pool(self):
        """Mock connection pool for testing"""
        return AsyncMock(spec=MCPConnectionPool)
    
    @pytest.fixture
    def mock_tool_registry(self):
        """Mock tool registry for testing"""
        registry = AsyncMock(spec=ToolRegistry)
        
        # Mock tool info
        tool_info = ToolInfo(
            name="test_tool",
            server_name="test_server",
            description="A test tool"
        )
        registry.get_tool_info.return_value = tool_info
        
        return registry
    
    @pytest.fixture
    def tool_executor(self, mock_connection_pool, mock_tool_registry):
        """Tool executor with mocked dependencies"""
        auth_requirements = AuthRequirements(
            type=AuthRequirementType.AGENT_TOKEN,
            scopes=["read", "write"]
        )
        server_names = ["test_server", "server1", "server2", "server3"]
        server_configs = {
            name: MCPServerConfig(
                name=name,
                endpoint="ws://localhost:8080/mcp",
                capabilities=["tool_execution"],
                auth_requirements=auth_requirements
            )
            for name in server_names
        }
        return MCPToolExecutor(
            mock_connection_pool,
            mock_tool_registry,
            server_configs=server_configs
        )
    
    @pytest.mark.asyncio
    async def test_execute_tool_success(self, tool_executor, mock_connection_pool, 
                                      sample_access_token):
        """Test successful tool execution"""
        # Mock connection
        mock_connection = AsyncMock()
        mock_connection.call_tool.return_value = {"result": "success"}
        mock_connection_pool.get_connection.return_value = mock_connection
        
        result = await tool_executor.execute_tool(
            server_name="test_server",
            tool_name="test_tool",
            parameters={"param1": "value1"},
            agent_token=sample_access_token,
            session_id="session123"
        )
        
        assert result == {"result": "success"}
        mock_connection.call_tool.assert_called_once()
        
        # Verify the tool call was created correctly
        call_args = mock_connection.call_tool.call_args[0][0]
        assert isinstance(call_args, MCPToolCall)
        assert call_args.tool_name == "test_tool"
        assert call_args.parameters == {"param1": "value1"}
        assert call_args.session_id == "session123"
    
    @pytest.mark.asyncio
    async def test_execute_tool_validation_errors(self, tool_executor, sample_access_token):
        """Test tool execution validation errors"""
        
        # Test empty server name
        with pytest.raises(ValueError, match="server_name must be a non-empty string"):
            await tool_executor.execute_tool("", "tool", {}, sample_access_token, "session")
        
        # Test empty tool name
        with pytest.raises(ValueError, match="tool_name must be a non-empty string"):
            await tool_executor.execute_tool("server", "", {}, sample_access_token, "session")
        
        # Test invalid parameters
        with pytest.raises(ValueError, match="parameters must be a dictionary"):
            await tool_executor.execute_tool("server", "tool", "invalid", sample_access_token, "session")
        
        # Test empty session ID
        with pytest.raises(ValueError, match="session_id must be a non-empty string"):
            await tool_executor.execute_tool("server", "tool", {}, sample_access_token, "")
    
    @pytest.mark.asyncio
    async def test_execute_tool_expired_token(self, tool_executor):
        """Test tool execution with expired token"""
        from datetime import timezone
        expired_token = AccessToken(
            token="expired-token",
            token_type="Bearer",
            expires_in=3600,
            scope="read write",
            issued_at=datetime.now(timezone.utc) - timedelta(hours=2)  # Expired
        )
        
        with pytest.raises(ValueError, match="Agent token is expired"):
            await tool_executor.execute_tool(
                "server", "tool", {}, expired_token, "session"
            )
    
    @pytest.mark.asyncio
    async def test_execute_tool_by_full_name(self, tool_executor, mock_connection_pool, 
                                           sample_access_token):
        """Test executing tool by full name"""
        # Mock connection
        mock_connection = AsyncMock()
        mock_connection.call_tool.return_value = {"result": "success"}
        mock_connection_pool.get_connection.return_value = mock_connection
        
        result = await tool_executor.execute_tool_by_full_name(
            full_tool_name="test_server.test_tool",
            parameters={"param1": "value1"},
            agent_token=sample_access_token,
            session_id="session123"
        )
        
        assert result == {"result": "success"}
    
    @pytest.mark.asyncio
    async def test_execute_tool_invalid_full_name(self, tool_executor, sample_access_token):
        """Test executing tool with invalid full name"""
        with pytest.raises(ValueError, match="full_tool_name must be in format 'server.tool'"):
            await tool_executor.execute_tool_by_full_name(
                "invalid_name", {}, sample_access_token, "session"
            )
    
    @pytest.mark.asyncio
    async def test_batch_execute_tools(self, tool_executor, mock_connection_pool, 
                                     sample_access_token):
        """Test batch tool execution"""
        # Mock connection
        mock_connection = AsyncMock()
        mock_connection.call_tool.side_effect = [
            {"result": "result1"},
            {"result": "result2"},
            {"result": "result3"}
        ]
        mock_connection_pool.get_connection.return_value = mock_connection
        
        tool_calls = [
            {"server_name": "server1", "tool_name": "tool1", "parameters": {"p1": "v1"}},
            {"server_name": "server2", "tool_name": "tool2", "parameters": {"p2": "v2"}},
            {"server_name": "server3", "tool_name": "tool3", "parameters": {"p3": "v3"}}
        ]
        
        results = await tool_executor.batch_execute_tools(
            tool_calls, sample_access_token, "session123"
        )
        
        assert len(results) == 3
        assert results[0] == {"result": "result1"}
        assert results[1] == {"result": "result2"}
        assert results[2] == {"result": "result3"}
        
        # Verify all tools were called
        assert mock_connection.call_tool.call_count == 3
    
    @pytest.mark.asyncio
    async def test_batch_execute_tools_with_errors(self, tool_executor, mock_connection_pool, 
                                                  sample_access_token):
        """Test batch tool execution with some failures"""
        # Mock connection with one failure
        mock_connection = AsyncMock()
        mock_connection.call_tool.side_effect = [
            {"result": "result1"},
            Exception("Tool execution failed"),
            {"result": "result3"}
        ]
        mock_connection_pool.get_connection.return_value = mock_connection
        
        tool_calls = [
            {"server_name": "server1", "tool_name": "tool1", "parameters": {}},
            {"server_name": "server2", "tool_name": "tool2", "parameters": {}},
            {"server_name": "server3", "tool_name": "tool3", "parameters": {}}
        ]
        
        results = await tool_executor.batch_execute_tools(
            tool_calls, sample_access_token, "session123"
        )
        
        assert len(results) == 3
        assert results[0] == {"result": "result1"}
        assert "error" in results[1]
        assert "Tool execution failed" in results[1]["error"]
        assert results[2] == {"result": "result3"}


class TestMCPClientManager:
    """Test cases for MCPClientManager class"""
    
    @pytest.mark.asyncio
    async def test_manager_initialization(self):
        """Test MCP client manager initialization"""
        manager = MCPClientManager()
        
        assert manager.connection_pool is not None
        assert manager.tool_registry is not None
        assert manager.tool_executor is not None
        assert len(manager._server_configs) == 0
    
    @pytest.mark.asyncio
    async def test_register_server(self, sample_server_config):
        """Test registering an MCP server"""
        manager = MCPClientManager()
        
        # Mock connection and tools
        mock_connection = AsyncMock()
        mock_connection.list_tools.return_value = ["tool1", "tool2"]
        
        with patch.object(manager.connection_pool, 'get_connection', return_value=mock_connection):
            await manager.register_server(sample_server_config)
        
        # Verify server was registered
        assert sample_server_config.name in manager._server_configs
        
        # Verify tools were registered
        tools = await manager.get_available_tools()
        assert sample_server_config.name in tools
        assert len(tools[sample_server_config.name]) == 2
    
    @pytest.mark.asyncio
    async def test_unregister_server(self, sample_server_config):
        """Test unregistering an MCP server"""
        manager = MCPClientManager()
        
        # First register a server
        mock_connection = AsyncMock()
        mock_connection.list_tools.return_value = ["tool1"]
        
        with patch.object(manager.connection_pool, 'get_connection', return_value=mock_connection):
            await manager.register_server(sample_server_config)
        
        # Verify it's registered
        assert sample_server_config.name in manager._server_configs
        
        # Unregister
        await manager.unregister_server(sample_server_config.name)
        
        # Verify it's gone
        assert sample_server_config.name not in manager._server_configs
        
        tools = await manager.get_available_tools()
        assert sample_server_config.name not in tools
    
    @pytest.mark.asyncio
    async def test_execute_tool(self, sample_server_config, sample_access_token):
        """Test executing a tool through the manager"""
        manager = MCPClientManager()
        
        # Register server first
        mock_connection = AsyncMock()
        mock_connection.list_tools.return_value = ["test_tool"]
        mock_connection.call_tool.return_value = {"result": "success"}
        
        with patch.object(manager.connection_pool, 'get_connection', return_value=mock_connection):
            await manager.register_server(sample_server_config)
            
            result = await manager.execute_tool(
                server_name=sample_server_config.name,
                tool_name="test_tool",
                parameters={"param1": "value1"},
                agent_token=sample_access_token,
                session_id="session123"
            )

        assert result == {"result": "success"}

    @pytest.mark.asyncio
    async def test_execute_tool_requires_session_id(self, sample_server_config, sample_access_token):
        """Test that execute_tool raises when no session_id is provided"""
        manager = MCPClientManager()

        with pytest.raises(ValueError, match="session_id is required"):
            await manager.execute_tool(
                server_name=sample_server_config.name,
                tool_name="test_tool",
                parameters={"param1": "value1"},
                agent_token=sample_access_token
            )

    @pytest.mark.asyncio
    async def test_find_and_execute_tool(self, sample_server_config, sample_access_token):
        """Test finding and executing a tool by pattern"""
        manager = MCPClientManager()
        
        # Register server first
        mock_connection = AsyncMock()
        mock_connection.list_tools.return_value = ["search_tool"]
        mock_connection.call_tool.return_value = {"result": "found"}
        
        with patch.object(manager.connection_pool, 'get_connection', return_value=mock_connection):
            await manager.register_server(sample_server_config)
            
            result = await manager.find_and_execute_tool(
                tool_pattern="search",
                parameters={"query": "test"},
                agent_token=sample_access_token,
                session_id="session123"
            )

        assert result == {"result": "found"}

    @pytest.mark.asyncio
    async def test_find_and_execute_tool_requires_session_id(self, sample_server_config, sample_access_token):
        """Test that find_and_execute_tool raises when no session_id is provided"""
        manager = MCPClientManager()

        mock_connection = AsyncMock()
        mock_connection.list_tools.return_value = ["search_tool"]

        with patch.object(manager.connection_pool, 'get_connection', return_value=mock_connection):
            await manager.register_server(sample_server_config)

            with pytest.raises(ValueError, match="session_id is required"):
                await manager.find_and_execute_tool(
                    tool_pattern="search",
                    parameters={"query": "test"},
                    agent_token=sample_access_token
                )

    @pytest.mark.asyncio
    async def test_find_and_execute_tool_no_match(self, sample_server_config, sample_access_token):
        """Test finding tool with no matches"""
        manager = MCPClientManager()
        
        # Register server first
        mock_connection = AsyncMock()
        mock_connection.list_tools.return_value = ["other_tool"]
        
        with patch.object(manager.connection_pool, 'get_connection', return_value=mock_connection):
            await manager.register_server(sample_server_config)
            
            with pytest.raises(ValueError, match="No tools found matching pattern"):
                await manager.find_and_execute_tool(
                    "nonexistent", {}, sample_access_token
                )
    
    @pytest.mark.asyncio
    async def test_get_manager_status(self, sample_server_config):
        """Test getting manager status"""
        manager = MCPClientManager()
        
        # Register a server
        mock_connection = AsyncMock()
        mock_connection.list_tools.return_value = ["tool1", "tool2"]
        
        with patch.object(manager.connection_pool, 'get_connection', return_value=mock_connection):
            await manager.register_server(sample_server_config)
            
            status = await manager.get_manager_status()
        
        assert status["registered_servers"] == 1
        assert sample_server_config.name in status["server_configs"]
        assert "tool_registry" in status
        assert "connection_pool" in status
    
    @pytest.mark.asyncio
    async def test_shutdown(self):
        """Test manager shutdown"""
        manager = MCPClientManager()
        
        with patch.object(manager.connection_pool, 'close_all_connections') as mock_close:
            await manager.shutdown()
            mock_close.assert_called_once()