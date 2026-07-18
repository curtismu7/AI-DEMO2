"""
Unit tests for MessageProcessor.
"""
import asyncio
import pytest
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timezone

from src.api.message_processor import MessageProcessor
from src.models.chat import ChatMessage, ChatSession, MessageRole
from src.models.auth import AuthorizationCode
from src.config.settings import SecurityConfig, ChatConfig, AppConfig

from tests.conftest import TEST_SECURITY_KWARGS


@pytest.fixture
def mock_config():
    """Create a mock configuration."""
    security_config = SecurityConfig(
        **{**TEST_SECURITY_KWARGS, "session_timeout_minutes": 30}
    )
    
    chat_config = ChatConfig(
        websocket_port=8080,
        max_message_length=1000,
        conversation_history_limit=50,
        session_cleanup_interval_minutes=5
    )
    
    config = Mock(spec=AppConfig)
    config.security = security_config
    config.chat = chat_config
    return config


@pytest.fixture
def mock_agent():
    """Create a mock LangChain agent."""
    agent = AsyncMock()
    agent.process_message_with_tracing = AsyncMock(return_value="Test response from agent")
    return agent


@pytest.fixture
def mock_session_manager():
    """Create a mock session manager."""
    session_manager = AsyncMock()
    session_manager.is_session_active = AsyncMock(return_value=True)
    session_manager.add_message_to_session = AsyncMock(return_value=True)
    session_manager.add_session_context = AsyncMock(return_value=True)
    session_manager.get_session_context = AsyncMock(return_value=None)
    return session_manager


@pytest.fixture
def mock_websocket_handler():
    """Create a mock WebSocket handler."""
    handler = AsyncMock()
    handler.send_message_to_session = AsyncMock(return_value=True)
    handler.send_chat_response = AsyncMock(return_value=True)
    handler.send_auth_request = AsyncMock(return_value=True)
    return handler


@pytest.fixture
def message_processor(mock_config, mock_agent, mock_session_manager, mock_websocket_handler):
    """Create a MessageProcessor for testing."""
    return MessageProcessor(
        agent=mock_agent,
        session_manager=mock_session_manager,
        websocket_handler=mock_websocket_handler,
        config=mock_config
    )


@pytest.mark.asyncio
class TestMessageProcessor:
    """Test cases for MessageProcessor."""
    
    async def test_initialization(self, message_processor):
        """Test MessageProcessor initialization."""
        assert message_processor._pending_auth_requests == {}
        assert message_processor._processing_task is None
        assert isinstance(message_processor._message_queue, asyncio.Queue)
    
    async def test_start_stop(self, message_processor):
        """Test starting and stopping the message processor."""
        # Start the processor
        await message_processor.start()
        assert message_processor._processing_task is not None
        assert not message_processor._processing_task.done()
        
        # Stop the processor
        await message_processor.stop()
        assert message_processor._processing_task.done()
    
    async def test_process_chat_message_success(self, message_processor, mock_session_manager):
        """Test successful chat message processing."""
        session_id = "test-session-1"
        chat_message = ChatMessage.create_user_message(session_id, "Hello, world!")
        
        # Mock session as active
        mock_session_manager.is_session_active.return_value = True
        
        await message_processor.process_chat_message(chat_message)
        
        # Should check session is active
        mock_session_manager.is_session_active.assert_called_once_with(session_id)
        
        # Should add message to session
        mock_session_manager.add_message_to_session.assert_called_once_with(session_id, chat_message)
        
        # Should queue message for processing
        assert message_processor._message_queue.qsize() == 1
    
    async def test_process_chat_message_inactive_session(self, message_processor, mock_session_manager, mock_websocket_handler):
        """Test chat message processing with inactive session."""
        session_id = "test-session-1"
        chat_message = ChatMessage.create_user_message(session_id, "Hello, world!")
        
        # Mock session as inactive
        mock_session_manager.is_session_active.return_value = False
        
        await message_processor.process_chat_message(chat_message)
        
        # Should send error response
        mock_websocket_handler.send_message_to_session.assert_called_once()
        call_args = mock_websocket_handler.send_message_to_session.call_args
        assert call_args[0][0] == session_id
        assert call_args[0][1]["type"] == "error_response"
        
        # Should not queue message
        assert message_processor._message_queue.qsize() == 0
    
    async def test_process_auth_response_success(self, message_processor):
        """Test successful authorization response processing."""
        session_id = "test-session-1"
        state = "test-state"
        auth_code = "test-auth-code"
        
        # Set up pending request (tuple form: (session_id, created_at))
        message_processor._pending_auth_requests[state] = (
            session_id, datetime.now(timezone.utc)
        )

        await message_processor.process_auth_response(session_id, auth_code, state)
        
        # Should remove pending request
        assert state not in message_processor._pending_auth_requests
        
        # Should queue auth response for processing
        assert message_processor._message_queue.qsize() == 1
    
    async def test_process_auth_response_unknown_state(self, message_processor, mock_websocket_handler):
        """Test authorization response with unknown state."""
        session_id = "test-session-1"
        state = "unknown-state"
        auth_code = "test-auth-code"
        
        await message_processor.process_auth_response(session_id, auth_code, state)
        
        # Should send error response
        mock_websocket_handler.send_message_to_session.assert_called_once()
        call_args = mock_websocket_handler.send_message_to_session.call_args
        assert call_args[0][0] == session_id
        assert call_args[0][1]["type"] == "error_response"
        
        # Should not queue message
        assert message_processor._message_queue.qsize() == 0
    
    async def test_process_auth_response_session_mismatch(self, message_processor, mock_websocket_handler):
        """Test authorization response with session mismatch."""
        session_id = "test-session-1"
        different_session_id = "different-session"
        state = "test-state"
        auth_code = "test-auth-code"
        
        # Set up pending request for different session
        message_processor._pending_auth_requests[state] = (
            different_session_id, datetime.now(timezone.utc)
        )
        
        await message_processor.process_auth_response(session_id, auth_code, state)
        
        # Should send error response
        mock_websocket_handler.send_message_to_session.assert_called_once()
        call_args = mock_websocket_handler.send_message_to_session.call_args
        assert call_args[0][0] == session_id
        assert call_args[0][1]["type"] == "error_response"
        
        # Should not remove pending request
        assert state in message_processor._pending_auth_requests
    
    async def test_request_user_authorization(self, message_processor, mock_websocket_handler):
        """Test requesting user authorization."""
        session_id = "test-session-1"
        auth_url = "https://auth.example.com/authorize"
        scope = "read write"
        
        state = await message_processor.request_user_authorization(session_id, auth_url, scope)
        
        # Should return a state parameter
        assert state is not None
        assert isinstance(state, str)
        
        # Should store pending request (tuple form: (session_id, created_at))
        assert state in message_processor._pending_auth_requests
        assert message_processor._pending_auth_requests[state][0] == session_id
        
        # Should send auth request to user
        mock_websocket_handler.send_auth_request.assert_called_once_with(session_id, auth_url, state)
    
    async def test_request_user_authorization_send_failure(self, message_processor, mock_websocket_handler):
        """Test authorization request when sending fails."""
        session_id = "test-session-1"
        auth_url = "https://auth.example.com/authorize"
        scope = "read write"
        
        # Mock send failure
        mock_websocket_handler.send_auth_request.return_value = False
        
        with pytest.raises(RuntimeError, match="Failed to send authorization request"):
            await message_processor.request_user_authorization(session_id, auth_url, scope)
        
        # Should not have pending requests
        assert len(message_processor._pending_auth_requests) == 0
    
    async def test_handle_chat_message(self, message_processor, mock_agent, mock_session_manager, mock_websocket_handler):
        """Test handling a chat message."""
        session_id = "test-session-1"
        chat_message = ChatMessage.create_user_message(session_id, "Hello, world!")
        
        await message_processor._handle_chat_message(chat_message)

        # Should send typing indicators
        assert mock_websocket_handler.send_message_to_session.call_count >= 2

        # Should process with agent (tracing path with WS streaming context)
        mock_agent.process_message_with_tracing.assert_called_once_with(
            chat_message.content,
            session_id,
            stream_context={"websocket_handler": mock_websocket_handler},
        )
        
        # Should add assistant message to session
        assert mock_session_manager.add_message_to_session.call_count == 1
        
        # Should send response to user
        mock_websocket_handler.send_chat_response.assert_called_once()
    
    async def test_handle_chat_message_agent_error(self, message_processor, mock_agent, mock_websocket_handler):
        """Test handling chat message when agent raises error."""
        session_id = "test-session-1"
        chat_message = ChatMessage.create_user_message(session_id, "Hello, world!")
        
        # Mock agent error
        mock_agent.process_message_with_tracing.side_effect = Exception("Agent error")
        
        await message_processor._handle_chat_message(chat_message)
        
        # Should send typing stop and error response
        assert mock_websocket_handler.send_message_to_session.call_count >= 2
        
        # Check that error response was sent
        calls = mock_websocket_handler.send_message_to_session.call_args_list
        error_call = None
        for call in calls:
            if call[0][1].get("type") == "error_response":
                error_call = call
                break
        
        assert error_call is not None
        assert error_call[0][0] == session_id
    
    async def test_handle_auth_response_stores_in_session_context(self, message_processor, mock_session_manager, mock_websocket_handler):
        """Auth responses are stored in session context and confirmed."""
        session_id = "test-session-1"
        auth_code = AuthorizationCode(
            code="test-code",
            state="test-state",
            session_id=session_id,
            expires_at=datetime.now(timezone.utc)
        )
        
        await message_processor._handle_auth_response(session_id, auth_code)
        
        # Should store in session context
        mock_session_manager.add_session_context.assert_called_once()
        call_args = mock_session_manager.add_session_context.call_args
        assert call_args[0][0] == session_id
        assert call_args[0][1] == "pending_auth_code"
        
        # Should send confirmation
        mock_websocket_handler.send_message_to_session.assert_called_once()
    
    async def test_get_processor_stats(self, message_processor):
        """Test getting processor statistics."""
        # Add some test data
        message_processor._pending_auth_requests["state1"] = (
            "session1", datetime.now(timezone.utc)
        )

        # Add message to queue
        await message_processor._message_queue.put({"type": "test"})

        stats = await message_processor.get_processor_stats()

        assert stats["queue_size"] == 1
        assert stats["pending_auth_requests"] == 1
        assert stats["processing_task_running"] is False

    async def test_clear_session_data(self, message_processor):
        """Test clearing session data."""
        session_id = "test-session-1"

        # Set up test data (tuple form: (session_id, created_at))
        now = datetime.now(timezone.utc)
        message_processor._pending_auth_requests["state1"] = (session_id, now)
        message_processor._pending_auth_requests["state2"] = ("other-session", now)

        await message_processor.clear_session_data(session_id)

        # Should remove pending auth requests for this session
        assert "state1" not in message_processor._pending_auth_requests
        assert "state2" in message_processor._pending_auth_requests  # Other session should remain
    
    async def test_message_queue_processing(self, message_processor, mock_agent, mock_websocket_handler):
        """Test that message queue processing works end-to-end."""
        session_id = "test-session-1"
        chat_message = ChatMessage.create_user_message(session_id, "Hello, world!")
        
        # Start processor
        await message_processor.start()
        
        # Process a chat message
        await message_processor.process_chat_message(chat_message)
        
        # Wait for processing (dispatcher -> per-session worker -> agent)
        for _ in range(100):
            if mock_agent.process_message_with_tracing.called:
                break
            await asyncio.sleep(0.02)

        # Should have processed the message
        mock_agent.process_message_with_tracing.assert_called_once()

        # Stop processor
        await message_processor.stop()
    
    async def test_shutdown(self, message_processor):
        """Test complete shutdown of message processor."""
        # Set up some test data
        message_processor._pending_auth_requests["state1"] = (
            "session1", datetime.now(timezone.utc)
        )
        await message_processor._message_queue.put({"type": "test"})

        await message_processor.start()

        await message_processor.shutdown()

        # Should clear all data
        assert len(message_processor._pending_auth_requests) == 0
        assert message_processor._message_queue.empty()
        
        # Processing task should be stopped
        assert message_processor._processing_task.done()

from unittest.mock import Mock
from guardrails.validator_base import FailResult


@pytest.fixture
def mock_agent_agui():
    """Agent double for the AG-UI (process_agui_message) MCP-graph path."""
    agent = Mock()
    agent.initialize_session_with_token = AsyncMock(return_value=None)
    agent.llm = Mock()
    agent.config = Mock()
    agent.config.langchain = Mock(max_iterations=25)
    agent._pre_model_hook = Mock()
    agent._checkpointer = Mock()
    agent.mcp_tool_provider = Mock()
    agent.mcp_tool_provider.set_session_context = AsyncMock(return_value=None)
    agent._build_system_message = AsyncMock(return_value="System prompt")

    graph = Mock()
    graph.get_state = Mock(return_value=Mock(values={}))

    async def fake_astream_events(agent_input, config=None, version="v2"):
        yield {
            "event": "on_tool_start",
            "name": "request_fee_waiver",
            "run_id": "call_1",
            "data": {"input": {"account_id": "acc_1"}},
        }
        yield {
            "event": "on_tool_end",
            "run_id": "call_1",
            "data": {"output": '{"requestId": "fwr-123", "status": "logged_for_review"}'},
        }

        class _Chunk:
            content = "I've waived your fee!"

        yield {"event": "on_chat_model_stream", "data": {"chunk": _Chunk()}}
        yield {
            "event": "on_chat_model_end",
            "data": {"output": Mock(usage_metadata=None, tool_calls=[]), "input": {"messages": []}},
            "metadata": {},
        }

    graph.astream_events = fake_astream_events
    agent._graph = graph
    return agent


@pytest.fixture
def mock_agui_emitter():
    emitter = AsyncMock()
    return emitter


@pytest.mark.asyncio
async def test_process_agui_message_emits_grounding_correction_on_overclaim(
    mock_config, mock_agent_agui, mock_session_manager, mock_websocket_handler, mock_agui_emitter,
):
    processor = MessageProcessor(
        agent=mock_agent_agui,
        session_manager=mock_session_manager,
        websocket_handler=mock_websocket_handler,
        config=mock_config,
    )
    with patch(
        "agent.grounding_guardrail.CommitmentGroundingValidator.async_validate",
        new=AsyncMock(
            return_value=FailResult(
                error_message="overclaim",
                fix_value="I've submitted a fee waiver request (ID: fwr-123) for human review.",
            )
        ),
    ):
        await processor.process_agui_message(
            session_id="s1",
            message="Can you waive the fee?",
            auth_token="tok",
            emitter=mock_agui_emitter,
            bff_tool_url="",
            tool_schemas=None,
            messages_list=None,
        )
    mock_agui_emitter.on_grounding_correction.assert_awaited_once()
    _, kwargs = mock_agui_emitter.on_grounding_correction.call_args
    assert kwargs["original"] == "I've waived your fee!"
    assert "fwr-123" in kwargs["corrected"]


@pytest.mark.asyncio
async def test_process_agui_message_no_correction_on_grounded_reply(
    mock_config, mock_session_manager, mock_websocket_handler, mock_agui_emitter,
):
    agent = Mock()
    agent.initialize_session_with_token = AsyncMock(return_value=None)
    agent.llm = Mock()
    agent.config = Mock()
    agent.config.langchain = Mock(max_iterations=25)
    agent._pre_model_hook = Mock()
    agent._checkpointer = Mock()
    agent.mcp_tool_provider = Mock()
    agent.mcp_tool_provider.set_session_context = AsyncMock(return_value=None)
    agent._build_system_message = AsyncMock(return_value="System prompt")
    graph = Mock()
    graph.get_state = Mock(return_value=Mock(values={}))

    async def fake_astream_events(agent_input, config=None, version="v2"):
        class _Chunk:
            content = "Your checking balance is $1,204.55."

        yield {"event": "on_chat_model_stream", "data": {"chunk": _Chunk()}}
        yield {
            "event": "on_chat_model_end",
            "data": {"output": Mock(usage_metadata=None, tool_calls=[]), "input": {"messages": []}},
            "metadata": {},
        }

    graph.astream_events = fake_astream_events
    agent._graph = graph

    processor = MessageProcessor(
        agent=agent,
        session_manager=mock_session_manager,
        websocket_handler=mock_websocket_handler,
        config=mock_config,
    )
    await processor.process_agui_message(
        session_id="s1",
        message="What's my balance?",
        auth_token="tok",
        emitter=mock_agui_emitter,
        bff_tool_url="",
        tool_schemas=None,
        messages_list=None,
    )
    mock_agui_emitter.on_grounding_correction.assert_not_awaited()


@pytest.mark.asyncio
async def test_process_agui_message_signals_error_on_empty_output(
    mock_config, mock_session_manager, mock_websocket_handler, mock_agui_emitter,
):
    """Groq (and others) can intermittently return empty content and call no
    tool on an ambiguous prompt. Without a signal the user sees a blank chat
    with no error and no explanation. The run must instead emit on_error and
    skip the (pointless, on empty text) grounding check."""
    agent = Mock()
    agent.initialize_session_with_token = AsyncMock(return_value=None)
    agent.llm = Mock()
    agent.config = Mock()
    agent.config.langchain = Mock(max_iterations=25)
    agent._pre_model_hook = Mock()
    agent._checkpointer = Mock()
    agent.mcp_tool_provider = Mock()
    agent.mcp_tool_provider.set_session_context = AsyncMock(return_value=None)
    agent._build_system_message = AsyncMock(return_value="System prompt")
    graph = Mock()
    graph.get_state = Mock(return_value=Mock(values={}))

    async def fake_astream_events(agent_input, config=None, version="v2"):
        # No on_chat_model_stream chunk, no tool calls -- only an
        # on_chat_model_end with empty content, which is the shape seen
        # from Groq on an ambiguous prompt.
        yield {
            "event": "on_chat_model_end",
            "data": {"output": Mock(content="", usage_metadata=None, tool_calls=[]), "input": {"messages": []}},
            "metadata": {},
        }

    graph.astream_events = fake_astream_events
    agent._graph = graph

    processor = MessageProcessor(
        agent=agent,
        session_manager=mock_session_manager,
        websocket_handler=mock_websocket_handler,
        config=mock_config,
    )
    await processor.process_agui_message(
        session_id="s1",
        message="asdf",
        auth_token="tok",
        emitter=mock_agui_emitter,
        bff_tool_url="",
        tool_schemas=None,
        messages_list=None,
    )
    mock_agui_emitter.on_error.assert_awaited_once()
    mock_agui_emitter.on_grounding_correction.assert_not_awaited()
