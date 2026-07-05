"""
Unit tests for LangChain MCP Agent — updated for LangGraph migration (Phase 275).

Philosophy (user request: "no mock tests if we can"):
  - ConversationMemory: fully real — no mocks
  - Pure string helpers (_looks_like_email, _detect_authorization_code, etc.): real
  - _build_system_message: real (reads only ConversationMemory, no LLM)
  - BasicChatAgent (no-tools path): real — we verify ainvoke interface without LLM
  - Mocked ONLY where unavoidable:
      get_llm           — LLM service not available in CI
      create_react_agent — langgraph not installed in test venv
      MemorySaver        — same reason
      graph.ainvoke      — LLM network call

Key LangGraph migration invariants:
  - graph.ainvoke returns {"messages": [AIMessage(content="...")]} not {"output": "..."}
  - config["configurable"]["thread_id"] == session_id is the routing key
  - self._graph (not self._agent_executor) is the compiled graph handle
"""
import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from datetime import datetime
from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from src.agent.langchain_mcp_agent import LangChainMCPAgent
from src.agent.mcp_tool_provider import MCPToolProvider
from src.agent.conversation_memory import ConversationMemory
from src.mcp.tool_registry import MCPClientManager
from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.models.auth import AccessToken
from src.models.chat import ChatMessage
from src.config.settings import AppConfig, ChatConfig, LangChainConfig


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_config():
    """Mock configuration for testing."""
    langchain_config = LangChainConfig(
        model_name="llama3",
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


async def _fake_astream_events_ok(*args, **kwargs):
    """Async generator that yields a synthetic on_chain_end event with a mock AIMessage."""
    yield {
        "event": "on_chain_end",
        "data": {"output": {"messages": [AIMessage(content="mock response")]}},
    }


def _make_mock_graph():
    """Build a mock CompiledStateGraph compatible with both ainvoke() and astream_events() interfaces.

    - ainvoke: used by process_message (non-tracing path)
    - astream_events: used by process_message_with_tracing (Phase 276+)
    """
    mock_graph = AsyncMock()
    mock_graph.ainvoke = AsyncMock(return_value={
        "messages": [AIMessage(content="mock response")]
    })
    mock_graph.astream_events = _fake_astream_events_ok
    mock_graph.get_state = Mock(return_value=SimpleNamespace(values={"messages": []}))
    return mock_graph


@pytest.fixture
def mock_llm():
    """Mock LLM returned by get_llm factory."""
    llm = Mock()
    llm.model_name = "llama3"
    return llm


@pytest.fixture
def mock_tools():
    """Mock LangChain tools."""
    tool1 = Mock()
    tool1.name = "test_server_tool1"
    tool1.description = "Test tool 1"
    tool1.args_schema = None

    tool2 = Mock()
    tool2.name = "test_server_tool2"
    tool2.description = "Test tool 2"
    tool2.args_schema = None

    return [tool1, tool2]


@pytest.fixture
def agent(mock_config, mock_mcp_client_manager, mock_auth_manager, mock_llm):
    """Create LangChain MCP Agent for testing with get_llm patched."""
    with patch('src.agent.langchain_mcp_agent.get_llm', return_value=mock_llm):
        a = LangChainMCPAgent(
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager,
            config=mock_config
        )
        return a


# ---------------------------------------------------------------------------
# Real ConversationMemory tests — no mocks
# ---------------------------------------------------------------------------

class TestConversationMemoryReal:
    """
    Real ConversationMemory tests: no mocks, exercises actual state management.
    Verifies behaviour the agent relies on (session creation, user identification,
    message storage, clear_session) using the real implementation.
    """

    @pytest.mark.asyncio
    async def test_get_or_create_session_creates_new(self):
        """get_or_create_session creates a new session with correct identifiers."""
        mem = ConversationMemory()
        session = await mem.get_or_create_session("sid-1", "uid-1")
        assert session.session_id == "sid-1"
        assert session.user_id == "uid-1"
        assert "sid-1" in mem._sessions

    @pytest.mark.asyncio
    async def test_get_or_create_session_returns_existing(self):
        """get_or_create_session returns the same object for a known session."""
        mem = ConversationMemory()
        s1 = await mem.get_or_create_session("sid-2")
        s2 = await mem.get_or_create_session("sid-2")
        assert s1 is s2

    @pytest.mark.asyncio
    async def test_add_and_get_raw_messages(self):
        """add_message stores messages; get_raw_messages retrieves them."""
        mem = ConversationMemory()
        msg = ChatMessage(
            id="m1",
            session_id="sid-3",
            content="hello",
            role="user",
            timestamp=datetime.now(),
            metadata={},
        )
        await mem.add_message("sid-3", msg)
        raw = await mem.get_raw_messages("sid-3")
        assert len(raw) == 1
        assert raw[0].content == "hello"

    @pytest.mark.asyncio
    async def test_clear_session_removes_all_state(self):
        """clear_session removes both session record and messages."""
        mem = ConversationMemory()
        msg = ChatMessage(
            id="m2",
            session_id="sid-4",
            content="data",
            role="user",
            timestamp=datetime.now(),
            metadata={},
        )
        await mem.add_message("sid-4", msg)
        assert "sid-4" in mem._sessions
        assert "sid-4" in mem._messages

        await mem.clear_session("sid-4")

        assert "sid-4" not in mem._sessions
        assert "sid-4" not in mem._messages

    @pytest.mark.asyncio
    async def test_set_and_get_user_identified(self):
        """set_user_identified records user; is_user_identified returns True."""
        mem = ConversationMemory()
        await mem.set_user_identified("sid-5", "alice@example.com", "uid-99")
        assert await mem.is_user_identified("sid-5") is True
        info = await mem.get_identified_user("sid-5")
        assert info is not None
        assert info["user_email"] == "alice@example.com"
        assert info["user_id"] == "uid-99"

    @pytest.mark.asyncio
    async def test_not_identified_by_default(self):
        """is_user_identified returns False for a fresh/unknown session."""
        mem = ConversationMemory()
        assert await mem.is_user_identified("unknown-session") is False

    @pytest.mark.asyncio
    async def test_get_raw_messages_returns_empty_for_unknown_session(self):
        """get_raw_messages returns [] for a session with no history."""
        mem = ConversationMemory()
        result = await mem.get_raw_messages("any-sid")
        assert result == []


# ---------------------------------------------------------------------------
# _build_system_message — real, no LLM
# ---------------------------------------------------------------------------

class TestBuildSystemMessage:
    """
    _build_system_message reads only ConversationMemory and self._tools.
    No LLM involved — test with real ConversationMemory objects.
    """

    @pytest.mark.asyncio
    async def test_system_message_no_tools(self, agent):
        """When no tools are loaded, tools_info shows 'None currently available'."""
        agent._tools = []
        text = await agent._build_system_message("sid-no-tools")
        assert "None currently available" in text

    @pytest.mark.asyncio
    async def test_system_message_with_tools(self, agent, mock_tools):
        """When tools are loaded, their names appear in the system message."""
        agent._tools = mock_tools
        text = await agent._build_system_message("sid-with-tools")
        assert "test_server_tool1" in text
        assert "test_server_tool2" in text

    @pytest.mark.asyncio
    async def test_system_message_identified_user(self, agent):
        """When the user is identified, system message shows USER IDENTIFIED status."""
        sid = "sid-identified"
        await agent.conversation_memory.set_user_identified(sid, "bob@bank.com", "uid-007")
        agent._tools = []
        text = await agent._build_system_message(sid)
        assert "USER IDENTIFIED" in text
        assert "bob@bank.com" in text

    @pytest.mark.asyncio
    async def test_system_message_unidentified_user(self, agent):
        """When the user is NOT identified, system message shows USER NOT IDENTIFIED."""
        agent._tools = []
        text = await agent._build_system_message("sid-fresh")
        assert "USER NOT IDENTIFIED" in text


# ---------------------------------------------------------------------------
# Pure string-helper tests — real, no mocks
# ---------------------------------------------------------------------------

class TestPureHelpers:
    """
    Tests for pure deterministic helpers.
    The agent fixture patches only get_llm (LLM service) — all helper logic
    runs against the real method bodies with no additional mocks.
    """

    def test_looks_like_email_valid(self, agent):
        assert agent._looks_like_email("user@example.com") is True

    def test_looks_like_email_invalid_no_at(self, agent):
        assert agent._looks_like_email("notanemail") is False

    def test_looks_like_email_invalid_has_spaces(self, agent):
        assert agent._looks_like_email("hello there") is False

    def test_looks_like_email_invalid_no_dot(self, agent):
        assert agent._looks_like_email("user@nodot") is False

    def test_is_authorization_complete_session_success(self, agent):
        assert agent._is_authorization_complete_message("SESSION_SUCCESS:abc123") is True

    def test_is_authorization_complete_natural_language_ignored(self, agent):
        # F9: only the structured SESSION_SUCCESS: sentinel counts. Loose
        # natural-language phrases must NOT hijack control flow into the
        # pending-tool retry path.
        assert agent._is_authorization_complete_message("authorization completed") is False
        assert agent._is_authorization_complete_message("signed in successfully") is False

    def test_is_authorization_complete_false(self, agent):
        assert agent._is_authorization_complete_message("what are my accounts?") is False

    def test_detect_authorization_code_prefixed(self, agent):
        assert agent._detect_authorization_code("code=abc123") == "abc123"

    def test_detect_authorization_code_auth_prefix(self, agent):
        assert agent._detect_authorization_code("auth=xyz789") == "xyz789"

    def test_detect_authorization_code_session_success(self, agent):
        result = agent._detect_authorization_code("SESSION_SUCCESS:abc123")
        assert result == "SESSION_SUCCESS:abc123"

    def test_detect_authorization_code_none(self, agent):
        assert agent._detect_authorization_code("show me my balance") is None

    def test_looks_like_registration_confirmation_yes(self, agent):
        assert agent._looks_like_registration_confirmation("yes") is True

    def test_looks_like_registration_confirmation_register(self, agent):
        assert agent._looks_like_registration_confirmation("register") is True

    def test_looks_like_registration_confirmation_no(self, agent):
        assert agent._looks_like_registration_confirmation("show me my accounts") is False


# ---------------------------------------------------------------------------
# Core initialisation
# ---------------------------------------------------------------------------

class TestLangChainMCPAgentInit:
    """Tests for agent construction — LangGraph era."""

    def test_initialization(self, mock_config, mock_mcp_client_manager, mock_auth_manager, mock_llm):
        """Agent initialises with _graph=None, no _agent_executor attribute."""
        with patch('src.agent.langchain_mcp_agent.get_llm', return_value=mock_llm):
            a = LangChainMCPAgent(
                mcp_client_manager=mock_mcp_client_manager,
                auth_manager=mock_auth_manager,
                config=mock_config
            )

        assert a.config == mock_config
        assert a.mcp_client_manager == mock_mcp_client_manager
        assert a.auth_manager == mock_auth_manager
        assert a.llm == mock_llm
        assert isinstance(a.mcp_tool_provider, MCPToolProvider)
        # ConversationMemory is real (not mocked)
        assert isinstance(a.conversation_memory, ConversationMemory)
        # LangGraph era: _graph not _agent_executor
        assert a._graph is None
        assert not hasattr(a, '_agent_executor'), \
            "_agent_executor must not exist — use _graph"

    def test_no_langgraph_executor_attribute(self, agent):
        """Regression: _agent_executor must not appear after migration."""
        assert not hasattr(agent, '_agent_executor')

    def test_conversation_memory_is_real(self, agent):
        """conversation_memory must be a real ConversationMemory instance."""
        assert isinstance(agent.conversation_memory, ConversationMemory)
        assert not hasattr(agent.conversation_memory, '_langchain_memories'), \
            "_langchain_memories must be absent — ConversationMemory was slimmed in 275-02"


# ---------------------------------------------------------------------------
# initialize_tools — graph construction
# ---------------------------------------------------------------------------

class TestInitializeTools:
    """Tests for initialize_tools() LangGraph graph construction."""

    @pytest.mark.asyncio
    async def test_initialize_tools_builds_graph(self, agent, mock_tools):
        """initialize_tools() builds a compiled graph via create_react_agent."""
        agent.mcp_tool_provider.get_langchain_tools = AsyncMock(return_value=mock_tools)
        mock_graph = _make_mock_graph()

        with patch('src.agent.langchain_mcp_agent.create_react_agent', return_value=mock_graph) as mock_cra:

            await agent.initialize_tools()

            assert agent._graph is mock_graph
            assert agent._graph is not None
            mock_cra.assert_called_once()
            # The agent-lifetime checkpointer (created once in __init__) must
            # be the one passed to create_react_agent — never a fresh one.
            assert mock_cra.call_args.kwargs["checkpointer"] is agent._checkpointer
            # The trimming hook must be wired so model input stays bounded.
            assert mock_cra.call_args.kwargs["pre_model_hook"] == agent._pre_model_hook

    @pytest.mark.asyncio
    async def test_initialize_tools_skips_rebuild_when_graph_exists(self, agent, mock_tools):
        """A second non-forced call leaves the existing graph untouched."""
        agent.mcp_tool_provider.get_langchain_tools = AsyncMock(return_value=mock_tools)
        mock_graph = _make_mock_graph()

        with patch('src.agent.langchain_mcp_agent.create_react_agent', return_value=mock_graph) as mock_cra:
            await agent.initialize_tools()
            await agent.initialize_tools()  # no force — must be a no-op

            mock_cra.assert_called_once()

    @pytest.mark.asyncio
    async def test_concurrent_initialize_tools_builds_once(self, agent, mock_tools):
        """The init lock prevents two concurrent lazy-inits racing two builds."""
        agent.mcp_tool_provider.get_langchain_tools = AsyncMock(return_value=mock_tools)
        mock_graph = _make_mock_graph()

        with patch('src.agent.langchain_mcp_agent.create_react_agent', return_value=mock_graph) as mock_cra:
            await asyncio.gather(agent.initialize_tools(), agent.initialize_tools())

            mock_cra.assert_called_once()

    @pytest.mark.asyncio
    async def test_initialize_tools_no_tools_uses_basic_agent(self, agent):
        """When no MCP tools are available, a BasicChatAgent is assigned to _graph."""
        agent.mcp_tool_provider.get_langchain_tools = AsyncMock(return_value=[])

        await agent.initialize_tools()

        assert agent._tools == []
        # BasicChatAgent is assigned — it has ainvoke() compatible interface
        assert agent._graph is not None
        assert hasattr(agent._graph, 'ainvoke')

    @pytest.mark.asyncio
    async def test_initialize_tools_stores_tools(self, agent, mock_tools):
        """initialize_tools() stores tools in self._tools."""
        agent.mcp_tool_provider.get_langchain_tools = AsyncMock(return_value=mock_tools)
        mock_graph = _make_mock_graph()

        with patch('src.agent.langchain_mcp_agent.create_react_agent', return_value=mock_graph):
            await agent.initialize_tools()

        assert agent._tools == mock_tools


# ---------------------------------------------------------------------------
# Checkpointer lifecycle — shared MemorySaver + delete_thread on clear
# ---------------------------------------------------------------------------

class _FakeCheckpointer:
    """Minimal MemorySaver stand-in with real per-thread storage semantics.

    The rootdir conftest stubs the langgraph package, so the real MemorySaver
    is unavailable in tests. This fake faithfully models the two behaviors
    the agent relies on: per-thread storage and delete_thread(thread_id)
    (verified to exist on the installed langgraph 0.6.11 MemorySaver).
    """

    def __init__(self):
        self.threads = {}

    def delete_thread(self, thread_id):
        self.threads.pop(thread_id, None)


class TestCheckpointerLifecycle:
    """The agent-lifetime checkpointer must survive rebuilds and be cleaned
    per-session by clear_session_memory."""

    @pytest.mark.asyncio
    async def test_refresh_tools_reuses_checkpointer_and_keeps_history(self, agent, mock_tools):
        """refresh_tools() rebuilds the graph but reuses the SAME checkpointer
        instance, so checkpointed session history survives a tool refresh.
        (The old bug: each rebuild constructed a fresh MemorySaver, wiping
        every session's history.)"""
        agent.mcp_tool_provider.get_langchain_tools = AsyncMock(return_value=mock_tools)

        fake_saver = _FakeCheckpointer()
        agent._checkpointer = fake_saver
        fake_saver.threads["session-keep"] = ["turn-1", "turn-2"]

        captured_checkpointers = []

        def capturing_cra(*args, **kwargs):
            captured_checkpointers.append(kwargs.get("checkpointer"))
            return _make_mock_graph()

        with patch('src.agent.langchain_mcp_agent.create_react_agent', side_effect=capturing_cra):
            await agent.initialize_tools()
            await agent.refresh_tools()

        # Both builds received the one agent-lifetime checkpointer instance —
        # never a fresh saver — so stored thread history is intact.
        assert len(captured_checkpointers) == 2
        assert captured_checkpointers[0] is fake_saver
        assert captured_checkpointers[1] is fake_saver
        assert fake_saver.threads["session-keep"] == ["turn-1", "turn-2"]

    @pytest.mark.asyncio
    async def test_clear_session_memory_deletes_checkpointer_thread(self, agent):
        """clear_session_memory deletes the LangGraph checkpoint thread for
        the session (and only that session)."""
        fake_saver = _FakeCheckpointer()
        agent._checkpointer = fake_saver
        fake_saver.threads["session-to-clear"] = ["history"]
        fake_saver.threads["session-to-keep"] = ["history"]

        await agent.clear_session_memory("session-to-clear")

        assert "session-to-clear" not in fake_saver.threads, \
            "checkpointer thread must be deleted on clear_session_memory"
        assert "session-to-keep" in fake_saver.threads, \
            "other sessions' threads must be untouched"


# ---------------------------------------------------------------------------
# pre_model_hook — token-budget trimming of the actual model input
# ---------------------------------------------------------------------------

class TestPreModelHook:
    """_pre_model_hook bounds what the LLM reads without rewriting state."""

    def test_long_history_is_trimmed_to_budget(self, agent):
        """A long history is trimmed to <= max_context_tokens for the model."""
        from langchain_core.messages.utils import count_tokens_approximately

        messages = [SystemMessage(content="You are a banking assistant.")]
        for i in range(200):
            messages.append(HumanMessage(content=f"question {i} " * 60))
            messages.append(AIMessage(content=f"answer {i} " * 60))

        result = agent._pre_model_hook({"messages": messages})

        assert set(result.keys()) == {"llm_input_messages"}, \
            "hook must override model input only — never rewrite state"
        trimmed = result["llm_input_messages"]
        assert len(trimmed) < len(messages), "long history must be trimmed"
        assert count_tokens_approximately(trimmed) <= agent._max_context_tokens
        # include_system + start_on='human' invariants
        assert isinstance(trimmed[0], SystemMessage)
        assert isinstance(trimmed[1], HumanMessage)

    def test_short_history_passes_through(self, agent):
        """A history under the budget is passed to the model unchanged."""
        messages = [
            SystemMessage(content="sys"),
            HumanMessage(content="hi"),
            AIMessage(content="hello"),
            HumanMessage(content="balance please"),
        ]

        result = agent._pre_model_hook({"messages": messages})

        assert result["llm_input_messages"] == messages

    def test_uses_configured_max_context_tokens(self, mock_config, mock_mcp_client_manager, mock_auth_manager, mock_llm):
        """The hook budget comes from config.chat.max_context_tokens."""
        mock_config.chat = ChatConfig(max_context_tokens=123)
        with patch('src.agent.langchain_mcp_agent.get_llm', return_value=mock_llm):
            a = LangChainMCPAgent(
                mcp_client_manager=mock_mcp_client_manager,
                auth_manager=mock_auth_manager,
                config=mock_config
            )
        assert a._max_context_tokens == 123
        assert a.conversation_memory.max_context_tokens == 123


# ---------------------------------------------------------------------------
# _content_to_text — str / content-block flattening
# ---------------------------------------------------------------------------

class TestContentToText:
    """Flattening of provider content (str or Anthropic-style blocks)."""

    def test_plain_string_passes_through(self):
        from src.agent.langchain_mcp_agent import _content_to_text
        assert _content_to_text("hello") == "hello"

    def test_text_blocks_are_joined(self):
        from src.agent.langchain_mcp_agent import _content_to_text
        blocks = [
            {"type": "text", "text": "Hello "},
            {"type": "tool_use", "id": "t1", "name": "x", "input": {}},
            {"type": "text", "text": "world"},
        ]
        assert _content_to_text(blocks) == "Hello world"

    def test_mixed_str_and_dict_blocks(self):
        from src.agent.langchain_mcp_agent import _content_to_text
        assert _content_to_text(["a", {"type": "text", "text": "b"}]) == "ab"

    def test_non_text_content_returns_empty(self):
        from src.agent.langchain_mcp_agent import _content_to_text
        assert _content_to_text(None) == ""
        assert _content_to_text([{"type": "tool_use", "id": "t1"}]) == ""


# ---------------------------------------------------------------------------
# process_message_with_tracing — LangGraph invocation assertions
# ---------------------------------------------------------------------------

class TestProcessMessageWithTracing:
    """Tests for process_message_with_tracing() using LangGraph astream_events v2."""

    @pytest.mark.asyncio
    async def test_uses_astream_events_for_execution(self, agent, mock_tools):
        """process_message_with_tracing uses astream_events (not ainvoke) on the graph."""
        session_id = "test-session-abc"
        user_message = "What are my accounts?"

        captured_inputs = []

        async def capturing_stream(*args, **kwargs):
            captured_inputs.append((args, kwargs))
            yield {
                "event": "on_chain_end",
                "data": {"output": {"messages": [AIMessage(content="mock response")]}},
            }

        mock_graph = _make_mock_graph()
        mock_graph.astream_events = capturing_stream
        agent._graph = mock_graph
        agent._tools = mock_tools

        agent.mcp_tool_provider.set_session_context = AsyncMock()
        agent.mcp_tool_provider.set_tracer = Mock()
        agent.mcp_tool_provider.mcp_client_manager._session_challenges = {}

        # Use real ConversationMemory to set up user identification
        await agent.conversation_memory.set_user_identified(session_id, "user@test.com", "user-1")

        response = await agent.process_message_with_tracing(user_message, session_id)

        # astream_events was called (not ainvoke)
        assert len(captured_inputs) == 1, "astream_events must be called exactly once"
        mock_graph.ainvoke.assert_not_called()
        assert response == "mock response"

    @pytest.mark.asyncio
    async def test_extracts_response_from_on_chain_end(self, agent, mock_tools):
        """Response is extracted from on_chain_end output.messages[-1].content."""
        session_id = "test-session-xyz"
        user_message = "Show my balance"

        async def balance_stream(*args, **kwargs):
            yield {
                "event": "on_chain_end",
                "data": {
                    "output": {
                        "messages": [
                            HumanMessage(content=user_message),
                            AIMessage(content="Your balance is $1,234.56"),
                        ]
                    }
                },
            }

        mock_graph = _make_mock_graph()
        mock_graph.astream_events = balance_stream
        agent._graph = mock_graph
        agent._tools = mock_tools

        agent.mcp_tool_provider.set_session_context = AsyncMock()
        agent.mcp_tool_provider.set_tracer = Mock()
        agent.mcp_tool_provider.mcp_client_manager._session_challenges = {}

        await agent.conversation_memory.set_user_identified(session_id, "user@test.com", "user-1")

        response = await agent.process_message_with_tracing(user_message, session_id)

        assert response == "Your balance is $1,234.56"

    @pytest.mark.asyncio
    async def test_extracts_response_from_content_blocks(self, agent, mock_tools):
        """Anthropic-style list-of-blocks AIMessage content is flattened and captured."""
        session_id = "test-session-blocks"
        user_message = "Show my balance"

        async def block_stream(*args, **kwargs):
            yield {
                "event": "on_chain_end",
                "data": {
                    "output": {
                        "messages": [
                            AIMessage(content=[
                                {"type": "text", "text": "Your balance is "},
                                {"type": "text", "text": "$42.00"},
                            ]),
                        ]
                    }
                },
            }

        mock_graph = _make_mock_graph()
        mock_graph.astream_events = block_stream
        agent._graph = mock_graph
        agent._tools = mock_tools

        agent.mcp_tool_provider.set_session_context = AsyncMock()
        agent.mcp_tool_provider.set_tracer = Mock()
        agent.mcp_tool_provider.mcp_client_manager._session_challenges = {}

        await agent.conversation_memory.set_user_identified(session_id, "user@test.com", "user-1")

        response = await agent.process_message_with_tracing(user_message, session_id)

        assert response == "Your balance is $42.00"

    @pytest.mark.asyncio
    async def test_system_message_injected_on_first_turn(self, agent, mock_tools):
        """SystemMessage is injected as first message when graph has no prior history."""
        session_id = "fresh-session-001"
        user_message = "Hello"

        captured_inputs = []

        async def capturing_stream(*args, **kwargs):
            captured_inputs.append(args[0] if args else kwargs.get("input", {}))
            yield {
                "event": "on_chain_end",
                "data": {"output": {"messages": [AIMessage(content="mock response")]}},
            }

        mock_graph = _make_mock_graph()
        # Simulate empty checkpoint (first turn)
        mock_graph.get_state = Mock(return_value=SimpleNamespace(values={"messages": []}))
        mock_graph.astream_events = capturing_stream
        agent._graph = mock_graph
        agent._tools = mock_tools

        agent.mcp_tool_provider.set_session_context = AsyncMock()
        agent.mcp_tool_provider.set_tracer = Mock()
        agent.mcp_tool_provider.mcp_client_manager._session_challenges = {}

        await agent.conversation_memory.set_user_identified(session_id, "user@test.com", "user-1")

        await agent.process_message_with_tracing(user_message, session_id)

        assert len(captured_inputs) == 1
        messages_arg = captured_inputs[0]["messages"]
        assert isinstance(messages_arg[0], SystemMessage), \
            "First message must be SystemMessage on first turn"
        assert isinstance(messages_arg[-1], HumanMessage)

    @pytest.mark.asyncio
    async def test_system_message_omitted_on_subsequent_turns(self, agent, mock_tools):
        """SystemMessage is NOT injected when graph already has history (subsequent turns)."""
        session_id = "existing-session-002"
        user_message = "What about transfers?"

        captured_inputs = []

        async def capturing_stream(*args, **kwargs):
            captured_inputs.append(args[0] if args else kwargs.get("input", {}))
            yield {
                "event": "on_chain_end",
                "data": {"output": {"messages": [AIMessage(content="mock response")]}},
            }

        mock_graph = _make_mock_graph()
        # Simulate non-empty checkpoint (subsequent turn)
        mock_graph.get_state = Mock(return_value=SimpleNamespace(values={
            "messages": [HumanMessage(content="prior message")]
        }))
        mock_graph.astream_events = capturing_stream
        agent._graph = mock_graph
        agent._tools = mock_tools

        agent.mcp_tool_provider.set_session_context = AsyncMock()
        agent.mcp_tool_provider.set_tracer = Mock()
        agent.mcp_tool_provider.mcp_client_manager._session_challenges = {}

        await agent.conversation_memory.set_user_identified(session_id, "user@test.com", "user-1")

        await agent.process_message_with_tracing(user_message, session_id)

        assert len(captured_inputs) == 1
        messages_arg = captured_inputs[0]["messages"]
        assert not isinstance(messages_arg[0], SystemMessage), \
            "SystemMessage must NOT be injected on subsequent turns"
        assert isinstance(messages_arg[0], HumanMessage)

    @pytest.mark.asyncio
    async def test_not_initialized_triggers_initialize_tools(self, agent):
        """When _graph is None, process_message_with_tracing calls initialize_tools."""
        agent._graph = None
        agent.initialize_tools = AsyncMock()

        # initialize_tools won't set _graph (mock), so should get fallback response
        response = await agent.process_message_with_tracing("hello", "session-x")

        agent.initialize_tools.assert_called_once()
        assert "not properly configured" in response


# ---------------------------------------------------------------------------
# process_message — non-tracing path
# ---------------------------------------------------------------------------

class TestProcessMessage:
    """Tests for process_message() — now a thin delegate to
    process_message_with_tracing (the single pipeline implementation)."""

    @pytest.mark.asyncio
    async def test_process_message_delegates_to_tracing_pipeline(self, agent):
        """process_message forwards args to process_message_with_tracing and
        returns its response unchanged (same public contract)."""
        agent.process_message_with_tracing = AsyncMock(return_value="delegated response")

        response = await agent.process_message("hello", "pm-delegate-1")

        agent.process_message_with_tracing.assert_awaited_once_with("hello", "pm-delegate-1")
        assert response == "delegated response"

    @pytest.mark.asyncio
    async def test_process_message_runs_graph_via_unified_pipeline(self, agent, mock_tools):
        """End-to-end: process_message executes the graph (astream_events,
        not the old duplicated ainvoke path) and returns the response."""
        session_id = "pm-session-001"
        user_message = "List my accounts"

        mock_graph = _make_mock_graph()
        agent._graph = mock_graph
        agent._tools = mock_tools

        agent.mcp_tool_provider.set_session_context = AsyncMock()
        agent.mcp_tool_provider.set_tracer = Mock()
        agent.mcp_tool_provider.mcp_client_manager._session_challenges = {}

        await agent.conversation_memory.set_user_identified(session_id, "user@test.com", "user-1")

        response = await agent.process_message(user_message, session_id)

        mock_graph.ainvoke.assert_not_called()
        assert response == "mock response"

    @pytest.mark.asyncio
    async def test_process_message_not_initialized(self, agent):
        """When _graph is None, process_message calls initialize_tools."""
        agent._graph = None
        agent.initialize_tools = AsyncMock()

        response = await agent.process_message("hello", "session-y")

        agent.initialize_tools.assert_called_once()
        assert "not properly configured" in response

    @pytest.mark.asyncio
    async def test_process_message_auth_error(self, agent, mock_tools):
        """Authentication errors in graph execution yield the auth-error message."""
        session_id = "pm-session-err"

        async def failing_stream(*args, **kwargs):
            raise Exception("Authentication failed")
            yield  # pragma: no cover — makes this an async generator

        mock_graph = _make_mock_graph()
        mock_graph.astream_events = failing_stream
        agent._graph = mock_graph
        agent._tools = mock_tools

        agent.mcp_tool_provider.set_session_context = AsyncMock()
        agent.mcp_tool_provider.set_tracer = Mock()

        await agent.conversation_memory.set_user_identified(session_id, "user@test.com", "user-1")

        response = await agent.process_message("hello", session_id)

        assert "authentication issue" in response.lower()


# ---------------------------------------------------------------------------
# _handle_user_identification — result-type normalization (str/dict/blocks)
# ---------------------------------------------------------------------------

class TestHandleUserIdentification:
    """The lookup-tool result may be a str, dict, or content-block list."""

    def _wire_lookup_tool(self, agent, result):
        tool = Mock()
        tool.name = "banking_query_user_by_email"
        tool.arun = AsyncMock(return_value=result)
        agent._tools = [tool]
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        return tool

    @pytest.mark.asyncio
    async def test_dict_result_identifies_user(self, agent):
        """An already-decoded dict result no longer raises TypeError."""
        self._wire_lookup_tool(agent, {"exists": True, "user": {"id": "u-9", "firstName": "Pat"}})

        response = await agent._handle_user_identification("pat@test.com", "sid-id-1")

        assert "Welcome back, Pat" in response
        assert await agent.conversation_memory.is_user_identified("sid-id-1")

    @pytest.mark.asyncio
    async def test_string_result_with_surrounding_prose_is_parsed(self, agent):
        raw = 'Lookup complete: {"exists": true, "user": {"id": "u-1", "firstName": "Sam"}} (cached)'
        self._wire_lookup_tool(agent, raw)

        response = await agent._handle_user_identification("sam@test.com", "sid-id-2")

        assert "Welcome back, Sam" in response

    @pytest.mark.asyncio
    async def test_content_block_result_is_parsed(self, agent):
        blocks = [{"type": "text", "text": '{"exists": true, "user": {"id": "u-2", "firstName": "Lee"}}'}]
        self._wire_lookup_tool(agent, blocks)

        response = await agent._handle_user_identification("lee@test.com", "sid-id-3")

        assert "Welcome back, Lee" in response

    @pytest.mark.asyncio
    async def test_nonexistent_user_offers_registration(self, agent):
        self._wire_lookup_tool(agent, {"exists": False})

        response = await agent._handle_user_identification("new@test.com", "sid-id-4")

        assert "couldn't find an account" in response
        assert not await agent.conversation_memory.is_user_identified("sid-id-4")

    @pytest.mark.asyncio
    async def test_unparseable_result_logs_cause_and_falls_back(self, agent, caplog):
        """Parse failures surface the real cause in the log (not swallowed)."""
        import logging as _logging
        self._wire_lookup_tool(agent, "totally not json")

        with caplog.at_level(_logging.ERROR, logger="src.agent.langchain_mcp_agent"):
            response = await agent._handle_user_identification("x@test.com", "sid-id-5")

        assert "having trouble" in response
        assert any("no JSON object" in rec.getMessage() for rec in caplog.records), \
            "the actual parse failure must be logged distinctly"

    @pytest.mark.asyncio
    async def test_malformed_json_logs_decode_error(self, agent, caplog):
        import logging as _logging
        self._wire_lookup_tool(agent, '{"exists": true, "user": }')  # invalid JSON

        with caplog.at_level(_logging.ERROR, logger="src.agent.langchain_mcp_agent"):
            response = await agent._handle_user_identification("y@test.com", "sid-id-6")

        assert "having trouble" in response
        assert any("JSON parse failed" in rec.getMessage() for rec in caplog.records)


# ---------------------------------------------------------------------------
# get_agent_status
# ---------------------------------------------------------------------------

class TestGetAgentStatus:
    """Tests for get_agent_status() using _graph."""

    @pytest.mark.asyncio
    async def test_initialized_true_when_graph_set(self, agent, mock_tools):
        """initialized is True when self._graph is not None."""
        agent._graph = _make_mock_graph()
        agent._tools = mock_tools
        agent.conversation_memory.get_active_sessions_count = AsyncMock(return_value=3)

        status = await agent.get_agent_status()

        assert status["initialized"] is True
        assert status["tools_count"] == 2
        assert status["tools"] == ["test_server_tool1", "test_server_tool2"]
        assert status["memory_sessions"] == 3
        assert "mcp_manager_status" in status

    @pytest.mark.asyncio
    async def test_initialized_false_when_graph_none(self, agent):
        """initialized is False when self._graph is None."""
        agent._graph = None
        agent._tools = []
        agent.conversation_memory.get_active_sessions_count = AsyncMock(return_value=0)

        status = await agent.get_agent_status()

        assert status["initialized"] is False


# ---------------------------------------------------------------------------
# Public interface — preserved from pre-migration, with real ConversationMemory
# ---------------------------------------------------------------------------

class TestPublicInterface:
    """Tests for public methods that remain unchanged after migration.

    clear_session_memory uses REAL ConversationMemory to verify actual state
    change, not just that a mock was called.
    """

    @pytest.mark.asyncio
    async def test_execute_tool_success(self, agent, mock_tools):
        """Direct tool execution via execute_tool() still works."""
        session_id = "test-session-123"
        tool_name = "test_server_tool1"
        parameters = {"param1": "value1"}
        expected_result = "Tool executed successfully"

        agent._tools = mock_tools
        mock_tools[0].arun = AsyncMock(return_value=expected_result)
        agent.mcp_tool_provider.set_session_context = AsyncMock()

        result = await agent.execute_tool(tool_name, parameters, session_id)

        assert result["result"] == expected_result
        assert result["tool_name"] == tool_name
        assert result["parameters"] == parameters
        agent.mcp_tool_provider.set_session_context.assert_called_once_with(session_id)
        mock_tools[0].arun.assert_called_once_with(parameters)

    @pytest.mark.asyncio
    async def test_execute_tool_not_found(self, agent, mock_tools):
        """Raises ValueError for unknown tool name."""
        agent._tools = mock_tools

        with pytest.raises(ValueError, match="Tool 'nonexistent_tool' not found"):
            await agent.execute_tool("nonexistent_tool", {}, "session-x")

    @pytest.mark.asyncio
    async def test_get_available_tools(self, agent, mock_tools):
        """get_available_tools returns structured list."""
        agent._tools = mock_tools

        tools_info = await agent.get_available_tools()

        assert len(tools_info) == 2
        assert tools_info[0]["name"] == "test_server_tool1"
        assert tools_info[0]["description"] == "Test tool 1"

    @pytest.mark.asyncio
    async def test_get_available_tools_not_initialized(self, agent):
        """get_available_tools calls initialize_tools when no tools loaded."""
        agent.initialize_tools = AsyncMock()
        agent._tools = []

        await agent.get_available_tools()

        agent.initialize_tools.assert_called_once()

    @pytest.mark.asyncio
    async def test_refresh_tools(self, agent, mock_tools):
        """refresh_tools re-invokes initialize_tools."""
        agent.initialize_tools = AsyncMock()
        agent._tools = mock_tools

        await agent.refresh_tools()

        agent.initialize_tools.assert_called_once()

    @pytest.mark.asyncio
    async def test_clear_session_memory_real(self, agent):
        """clear_session_memory removes session data from real ConversationMemory."""
        session_id = "real-session-clear"
        # Use real ConversationMemory — add a message so the session exists
        msg = ChatMessage(
            id="csm-1",
            session_id=session_id,
            content="test content",
            role="user",
            timestamp=datetime.now(),
            metadata={},
        )
        await agent.conversation_memory.add_message(session_id, msg)

        # Verify session was actually created
        assert session_id in agent.conversation_memory._sessions
        assert session_id in agent.conversation_memory._messages

        # clear_session_memory should delegate to real clear_session
        await agent.clear_session_memory(session_id)

        # Verify actual state change — not just a mock call
        assert session_id not in agent.conversation_memory._sessions
        assert session_id not in agent.conversation_memory._messages

    @pytest.mark.asyncio
    async def test_shutdown(self, agent):
        """shutdown cleans up conversation memory and mcp client manager."""
        agent.conversation_memory.cleanup = AsyncMock()

        await agent.shutdown()

        agent.conversation_memory.cleanup.assert_called_once()
        agent.mcp_client_manager.shutdown.assert_called_once()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
