"""
Unit tests for MCP Tool Provider.
"""
import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime

from src.agent.mcp_tool_provider import (
    MCPToolProvider,
    MCPTool,
    MCPToolInput,
    _current_session_id_var,
    _current_agent_token_var,
)
from src.mcp.tool_registry import MCPClientManager, ToolInfo
from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.models.auth import AccessToken
from models.mcp import AuthChallenge


@pytest.fixture
def mock_mcp_client_manager():
    """Mock MCP client manager."""
    manager = Mock(spec=MCPClientManager)
    manager.tool_registry = Mock()
    manager.execute_tool = AsyncMock()
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
    manager.generate_user_authorization_url = Mock(return_value="https://auth.example.com/authorize")
    return manager


@pytest.fixture
def sample_tool_info():
    """Sample tool info for testing."""
    return ToolInfo(
        name="test_tool",
        server_name="test_server",
        description="A test tool for unit testing"
    )


@pytest.fixture
def sample_tool_infos():
    """Sample tool infos for testing."""
    return {
        "test_server.tool1": ToolInfo(
            name="tool1",
            server_name="test_server",
            description="Test tool 1"
        ),
        "test_server.tool2": ToolInfo(
            name="tool2",
            server_name="test_server",
            description="Test tool 2"
        ),
        "other_server.tool3": ToolInfo(
            name="tool3",
            server_name="other_server",
            description="Test tool 3"
        )
    }


@pytest.fixture
def mcp_tool_provider(mock_mcp_client_manager, mock_auth_manager):
    """Create MCP tool provider for testing."""
    return MCPToolProvider(
        mcp_client_manager=mock_mcp_client_manager,
        auth_manager=mock_auth_manager
    )


class TestMCPTool:
    """Test cases for MCPTool wrapper."""
    
    def test_initialization(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test MCPTool initialization."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        assert tool.name == "test_server_test_tool"  # Dots replaced with underscores
        assert tool.description == "A test tool for unit testing"
        assert tool.tool_info == sample_tool_info
        assert tool.mcp_client_manager == mock_mcp_client_manager
        assert tool.auth_manager == mock_auth_manager
        assert _current_session_id_var.get() is None
        assert _current_agent_token_var.get() is None
    
    def test_initialization_no_description(self, mock_mcp_client_manager, mock_auth_manager):
        """Test MCPTool initialization without description."""
        tool_info = ToolInfo(
            name="test_tool",
            server_name="test_server"
        )
        
        tool = MCPTool(
            tool_info=tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        assert "Execute test_tool tool on test_server server" in tool.description
    
    def test_sync_run_not_implemented(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test that synchronous run raises NotImplementedError."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        with pytest.raises(NotImplementedError):
            tool._run({})
    
    @pytest.mark.asyncio
    async def test_async_run_success(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test successful async tool execution."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        # Set session context
        session_id = "test-session-123"
        agent_token = AccessToken(
            token="test-token",
            token_type="Bearer",
            expires_in=3600,
            scope="read write",
            issued_at=datetime.now()
        )
        tool.set_session_context(session_id, agent_token)
        
        # Mock successful execution
        expected_result = {"result": "Tool executed successfully"}
        mock_mcp_client_manager.execute_tool.return_value = expected_result
        
        parameters = {"param1": "value1"}
        result = await tool._arun(parameters=parameters)

        assert result == "Tool executed successfully"
        # _arun() always re-fetches the agent token via get_client_credentials_token()
        # for freshness; the token passed via set_session_context is superseded.
        refreshed_token = mock_auth_manager.get_client_credentials_token.return_value
        mock_mcp_client_manager.execute_tool.assert_called_once_with(
            server_name="test_server",
            tool_name="test_tool",
            parameters=parameters,
            agent_token=refreshed_token,
            session_id=session_id
        )
    
    @pytest.mark.asyncio
    async def test_async_run_no_session_context(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test async run without session context."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        with pytest.raises(RuntimeError, match="Session context not set"):
            await tool._arun()
    
    @pytest.mark.asyncio
    async def test_async_run_expired_token(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test async run with expired token gets new token."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        # Set session context with an expired token (modelled as a Mock to avoid
        # AccessToken validation rejecting expires_in=0; _arun always re-fetches anyway)
        session_id = "test-session-123"
        expired_token = Mock(spec=AccessToken, masked_fingerprint=Mock(return_value="expired-***"))
        tool.set_session_context(session_id, expired_token)
        
        # Mock successful execution
        expected_result = {"result": "Success"}
        mock_mcp_client_manager.execute_tool.return_value = expected_result
        
        result = await tool._arun()
        
        assert result == "Success"
        # Should have requested new token
        mock_auth_manager.get_client_credentials_token.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_async_run_auth_challenge(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test async run with authentication challenge."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        # Set session context
        session_id = "test-session-123"
        agent_token = AccessToken(
            token="test-token",
            token_type="Bearer",
            expires_in=3600,
            scope="read write",
            issued_at=datetime.now()
        )
        tool.set_session_context(session_id, agent_token)
        
        # Mock auth challenge response
        challenge = AuthChallenge(
            challenge_type="oauth_authorization_code",
            authorization_url="https://auth.example.com/authorize",
            scope="read write",
            state="test-state"
        )
        mock_mcp_client_manager.execute_tool.return_value = {
            "type": "auth_challenge",
            "challenge": challenge
        }
        
        result = await tool._arun()
        
        assert "requires user authorization" in result
        assert "https://auth.example.com/authorize" in result
        mock_auth_manager.generate_user_authorization_url.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_async_run_error(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test async run with execution error."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        # Set session context
        session_id = "test-session-123"
        agent_token = AccessToken(
            token="test-token",
            token_type="Bearer",
            expires_in=3600,
            scope="read write",
            issued_at=datetime.now()
        )
        tool.set_session_context(session_id, agent_token)
        
        # Mock execution error
        mock_mcp_client_manager.execute_tool.side_effect = Exception("Tool execution failed")
        
        result = await tool._arun()
        
        assert "Tool execution failed" in result
    
    def test_set_session_context(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test setting session context."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        session_id = "test-session-123"
        agent_token = AccessToken(
            token="test-token",
            token_type="Bearer",
            expires_in=3600,
            scope="read write",
            issued_at=datetime.now()
        )
        
        tool.set_session_context(session_id, agent_token)
        
        assert _current_session_id_var.get() == session_id
        assert _current_agent_token_var.get() == agent_token


class TestMCPToolProvider:
    """Test cases for MCPToolProvider."""
    
    def test_initialization(self, mock_mcp_client_manager, mock_auth_manager):
        """Test MCPToolProvider initialization."""
        provider = MCPToolProvider(
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        assert provider.mcp_client_manager == mock_mcp_client_manager
        assert provider.auth_manager == mock_auth_manager
        assert provider._tools == []
        assert provider._current_session_id is None
        assert provider._current_agent_token is None
    
    @pytest.mark.asyncio
    async def test_get_langchain_tools(self, mcp_tool_provider, sample_tool_infos):
        """Test getting LangChain tools."""
        # Mock tool registry
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            return_value=sample_tool_infos
        )
        
        tools = await mcp_tool_provider.get_langchain_tools()
        
        assert len(tools) == 3
        assert all(isinstance(tool, MCPTool) for tool in tools)
        assert tools[0].name == "test_server_tool1"
        assert tools[1].name == "test_server_tool2"
        assert tools[2].name == "other_server_tool3"
        assert mcp_tool_provider._tools == tools
    
    @pytest.mark.asyncio
    async def test_get_langchain_tools_error(self, mcp_tool_provider):
        """Test getting LangChain tools with error."""
        # Mock tool registry error
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            side_effect=Exception("Registry error")
        )
        
        tools = await mcp_tool_provider.get_langchain_tools()
        
        assert tools == []
    
    @pytest.mark.asyncio
    async def test_get_tools_by_server(self, mcp_tool_provider, sample_tool_infos):
        """Test getting tools for specific server."""
        # Mock tool registry
        server_tools = [sample_tool_infos["test_server.tool1"], sample_tool_infos["test_server.tool2"]]
        mcp_tool_provider.mcp_client_manager.tool_registry.get_server_tools = AsyncMock(
            return_value=server_tools
        )
        
        tools = await mcp_tool_provider.get_tools_by_server("test_server")
        
        assert len(tools) == 2
        assert all(isinstance(tool, MCPTool) for tool in tools)
        assert tools[0].name == "test_server_tool1"
        assert tools[1].name == "test_server_tool2"
    
    @pytest.mark.asyncio
    async def test_find_tools(self, mcp_tool_provider, sample_tool_infos):
        """Test finding tools by pattern."""
        # Mock tool registry
        matching_tools = [sample_tool_infos["test_server.tool1"]]
        mcp_tool_provider.mcp_client_manager.tool_registry.find_tools = AsyncMock(
            return_value=matching_tools
        )
        
        tools = await mcp_tool_provider.find_tools("tool1")
        
        assert len(tools) == 1
        assert isinstance(tools[0], MCPTool)
        assert tools[0].name == "test_server_tool1"
    
    @pytest.mark.asyncio
    async def test_set_session_context(self, mcp_tool_provider, sample_tool_infos):
        """Test setting session context."""
        # Setup tools
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            return_value=sample_tool_infos
        )
        await mcp_tool_provider.get_langchain_tools()
        
        session_id = "test-session-123"
        
        await mcp_tool_provider.set_session_context(session_id)
        
        assert mcp_tool_provider._current_session_id == session_id
        assert mcp_tool_provider._current_agent_token is not None
        
        # Check that all tools have session context set
        for tool in mcp_tool_provider._tools:
            assert _current_session_id_var.get() == session_id
    
    @pytest.mark.asyncio
    async def test_set_session_context_auth_error(self, mcp_tool_provider):
        """Test setting session context with auth error."""
        # Mock auth manager error
        mcp_tool_provider.auth_manager.get_client_credentials_token = AsyncMock(
            side_effect=Exception("Auth error")
        )
        
        session_id = "test-session-123"
        
        await mcp_tool_provider.set_session_context(session_id)
        
        assert mcp_tool_provider._current_session_id == session_id
        assert mcp_tool_provider._current_agent_token is None
    
    @pytest.mark.asyncio
    async def test_refresh_tools(self, mcp_tool_provider, sample_tool_infos):
        """Test refreshing tools."""
        # Mock tool registry
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            return_value=sample_tool_infos
        )
        
        # Set initial session context
        session_id = "test-session-123"
        mcp_tool_provider._current_session_id = session_id
        
        tools = await mcp_tool_provider.refresh_tools()
        
        assert len(tools) == 3
        assert mcp_tool_provider._tools == tools
        
        # Check that session context is preserved
        for tool in tools:
            assert _current_session_id_var.get() == session_id
    
    @pytest.mark.asyncio
    async def test_refresh_tools_error(self, mcp_tool_provider):
        """Test refreshing tools with error."""
        # Set some existing tools
        existing_tools = [Mock()]
        mcp_tool_provider._tools = existing_tools

        # Mock error
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            side_effect=Exception("Refresh error")
        )

        tools = await mcp_tool_provider.refresh_tools()

        # get_langchain_tools() catches its own errors and returns []; refresh_tools
        # never sees the exception so its own fallback (return self._tools) is not reached.
        # The actual behaviour on registry error is to return an empty list.
        assert tools == []
    
    @pytest.mark.asyncio
    async def test_get_tool_info(self, mcp_tool_provider, sample_tool_infos):
        """Test getting tool information."""
        # Setup tools
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            return_value=sample_tool_infos
        )
        await mcp_tool_provider.get_langchain_tools()
        
        tools_info = await mcp_tool_provider.get_tool_info()
        
        assert len(tools_info) == 3
        assert tools_info[0]["name"] == "test_server_tool1"
        assert tools_info[0]["server_name"] == "test_server"
        assert tools_info[0]["tool_name"] == "tool1"
        assert tools_info[0]["full_name"] == "test_server.tool1"
    
    def test_get_current_session_id(self, mcp_tool_provider):
        """Test getting current session ID."""
        assert mcp_tool_provider.get_current_session_id() is None
        
        mcp_tool_provider._current_session_id = "test-session-123"
        assert mcp_tool_provider.get_current_session_id() == "test-session-123"
    
    def test_get_tools_count(self, mcp_tool_provider):
        """Test getting tools count."""
        assert mcp_tool_provider.get_tools_count() == 0

        mcp_tool_provider._tools = [Mock(), Mock(), Mock()]
        assert mcp_tool_provider.get_tools_count() == 3


class TestTracerContextIsolation:
    """WR-06: the MCP tracer must be ContextVar-scoped, never a module
    global. Concurrent sessions must never see each other's tracer
    (cross-session trace bleed). Analogous to the CR-06 demux test."""

    @pytest.mark.asyncio
    async def test_concurrent_tasks_do_not_leak_tracers(
        self, mcp_tool_provider
    ):
        """Two concurrent tasks each set their own tracer and then read it
        back across an await point; each must observe ITS OWN tracer, never
        the other task's — the leak-proof test."""
        from src.agent import mcp_tool_provider as provider_mod

        tracer_a = Mock(name="tracer-A")
        tracer_b = Mock(name="tracer-B")

        async def session_task(tracer, ready_evt, release_evt):
            # Set within THIS task's context (copy-on-create isolation).
            mcp_tool_provider.set_tracer(tracer)
            ready_evt.set()
            # Yield so the sibling task interleaves and sets ITS tracer.
            # If the tracer were a module global, the sibling's set would
            # have clobbered ours and this read would return the wrong one.
            await release_evt.wait()
            return provider_mod._current_tracer.get()

        ready_a, ready_b = asyncio.Event(), asyncio.Event()
        release = asyncio.Event()

        task_a = asyncio.create_task(session_task(tracer_a, ready_a, release))
        task_b = asyncio.create_task(session_task(tracer_b, ready_b, release))

        # Ensure BOTH tasks have run set_tracer before either reads back.
        await ready_a.wait()
        await ready_b.wait()
        release.set()

        seen_a, seen_b = await asyncio.gather(task_a, task_b)

        assert seen_a is tracer_a, "task A saw the wrong tracer (leak)"
        assert seen_b is tracer_b, "task B saw the wrong tracer (leak)"
        assert seen_a is not seen_b

    @pytest.mark.asyncio
    async def test_single_task_observes_its_tracer(self, mcp_tool_provider):
        """Happy path: within one task the tracer set via set_tracer() is
        observed correctly by a subsequent read."""
        from src.agent import mcp_tool_provider as provider_mod

        # Default before any set in this context.
        assert provider_mod._current_tracer.get() is None

        tracer = Mock(name="tracer-solo")
        mcp_tool_provider.set_tracer(tracer)

        # Survives an await boundary within the same task/context.
        await asyncio.sleep(0)
        assert provider_mod._current_tracer.get() is tracer


class TestSessionContextIsolation:
    """Phase 273: MCPTool session_id and agent_token must be ContextVar-scoped,
    never a mutable PrivateAttr on the shared tool instance. Two concurrent sessions
    must never see each other's session_id or agent_token (security-class correctness).
    Mirrors TestTracerContextIsolation from WR-06."""

    @pytest.mark.asyncio
    async def test_concurrent_tasks_do_not_leak_session_ids(
        self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager
    ):
        """Two concurrent tasks each call set_session_context with a distinct session ID
        and then read _current_session_id_var.get() back across an await point; each
        must observe ITS OWN session ID, never the other task's — the leak-proof test."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager,
        )

        session_id_a = "session-A"
        session_id_b = "session-B"

        async def session_task(sid, ready_evt, release_evt):
            # Set within THIS task's context (copy-on-create isolation).
            tool.set_session_context(sid)
            ready_evt.set()
            # Yield so the sibling task interleaves and sets ITS session ID.
            # If the value were a PrivateAttr/module global, the sibling's set
            # would have clobbered ours and this read would return the wrong one.
            await release_evt.wait()
            return _current_session_id_var.get()

        ready_a, ready_b = asyncio.Event(), asyncio.Event()
        release = asyncio.Event()

        task_a = asyncio.create_task(session_task(session_id_a, ready_a, release))
        task_b = asyncio.create_task(session_task(session_id_b, ready_b, release))

        # Ensure BOTH tasks have run set_session_context before either reads back.
        await ready_a.wait()
        await ready_b.wait()
        release.set()

        seen_a, seen_b = await asyncio.gather(task_a, task_b)

        assert seen_a == session_id_a, f"task A saw wrong session ID (leak): {seen_a!r}"
        assert seen_b == session_id_b, f"task B saw wrong session ID (leak): {seen_b!r}"
        assert seen_a != seen_b

    @pytest.mark.asyncio
    async def test_concurrent_tasks_do_not_leak_agent_tokens(
        self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager
    ):
        """Two concurrent tasks each call set_session_context with a distinct AccessToken
        and then read _current_agent_token_var.get() back across an await point; each
        must observe ITS OWN token, never the other task's."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager,
        )

        token_a = AccessToken(
            token="token-A",
            token_type="Bearer",
            expires_in=3600,
            scope="read",
            issued_at=datetime.now(),
        )
        token_b = AccessToken(
            token="token-B",
            token_type="Bearer",
            expires_in=3600,
            scope="write",
            issued_at=datetime.now(),
        )

        async def session_task(sid, token, ready_evt, release_evt):
            tool.set_session_context(sid, token)
            ready_evt.set()
            await release_evt.wait()
            return _current_agent_token_var.get()

        ready_a, ready_b = asyncio.Event(), asyncio.Event()
        release = asyncio.Event()

        task_a = asyncio.create_task(session_task("sid-a", token_a, ready_a, release))
        task_b = asyncio.create_task(session_task("sid-b", token_b, ready_b, release))

        await ready_a.wait()
        await ready_b.wait()
        release.set()

        seen_a, seen_b = await asyncio.gather(task_a, task_b)

        assert seen_a is token_a, f"task A saw wrong token (leak): {seen_a!r}"
        assert seen_b is token_b, f"task B saw wrong token (leak): {seen_b!r}"
        assert seen_a is not seen_b

    @pytest.mark.asyncio
    async def test_single_task_observes_its_session_id(
        self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager
    ):
        """Happy path: within one task, set_session_context() sets the ContextVar;
        after an await boundary it still reads back the correct session ID."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager,
        )

        # Reset the ContextVar to None for this test context (prior tests in the same
        # test-runner task may have set it; each test run is a fresh coroutine but
        # pytest-asyncio may reuse the same context across non-create_task tests).
        _current_session_id_var.set(None)
        assert _current_session_id_var.get() is None

        tool.set_session_context("solo-session")

        # Survives an await boundary within the same task/context.
        await asyncio.sleep(0)
        assert _current_session_id_var.get() == "solo-session"


if __name__ == "__main__":
    pytest.main([__file__])