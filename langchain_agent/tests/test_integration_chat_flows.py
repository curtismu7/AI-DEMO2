"""
Integration tests for end-to-end chat flows.

These tests verify complete user chat sessions including:
- Complete user chat sessions from WebSocket to agent response
- Authorization flow integration within chat context
- Performance tests for concurrent user sessions

Current contracts these tests exercise (post-remediation):
- handle_connection(websocket) takes only the socket (no path argument).
- session_init REQUIRES an auth token (Path A): the handler validates it via
  authentication.token_validator BEFORE creating/binding any session, and the
  processor binds identity via agent.initialize_session_with_token.
- The processor drives the agent through process_message_with_tracing(...).
"""
import pytest
import asyncio
import json
from datetime import datetime, timezone, timedelta
from unittest.mock import Mock, AsyncMock, MagicMock, patch
from typing import Dict, Any, List
from websockets.exceptions import ConnectionClosed

from src.api.websocket_handler import ChatWebSocketHandler
from src.api.message_processor import MessageProcessor
from src.api.session_manager import SessionManager
from src.agent.langchain_mcp_agent import LangChainMCPAgent
from src.agent.mcp_tool_provider import MCPToolProvider
from src.agent.conversation_memory import ConversationMemory
from src.mcp.tool_registry import MCPClientManager
# Import models via the same path the production code uses (`models.*`, see
# pythonpath in pytest.ini) so isinstance checks see the same class objects.
from models.chat import ChatMessage, ChatSession, MessageRole
from models.auth import AccessToken, AuthorizationCode
from src.config.settings import AppConfig, PingOneConfig, SecurityConfig, ChatConfig, LangChainConfig

from tests.conftest import TEST_SECURITY_KWARGS


TEST_USER_TOKEN = "test-user-token"


@pytest.fixture(autouse=True)
def stub_token_validator():
    """Stub the Path A token validator so session_init accepts TEST_USER_TOKEN
    without real PingOne JWKS validation (tests stay hermetic)."""
    mock_validator = Mock()
    mock_validator.validate.return_value = Mock(sub="integration-user-sub")
    with patch(
        "authentication.token_validator.get_token_validator",
        return_value=mock_validator,
    ):
        yield mock_validator


@pytest.fixture
def integration_config():
    """Create configuration for chat integration testing."""
    return AppConfig(
        environment="integration",
        debug=True,
        log_level="DEBUG",
        pingone=PingOneConfig(
            base_url="https://integration-tenant.forgeblocks.com",
            client_registration_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/register",
            token_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token",
            authorization_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize",
            default_scope="openid profile mcp:access",
            redirect_uri="https://localhost:8080/oauth/callback",
            realm="alpha"
        ),
        security=SecurityConfig(**TEST_SECURITY_KWARGS),
        chat=ChatConfig(
            max_message_length=4000,
            session_cleanup_interval_minutes=30,
        ),
        langchain=LangChainConfig(
            model_name="gpt-3.5-turbo",
            temperature=0.7,
            max_tokens=1000,
            openai_api_key="test-openai-key",
            verbose=True,
            max_iterations=5,
            max_execution_time=30
        ),
        mcp=MagicMock()
    )


@pytest.fixture
def mock_agent_token():
    """Create a mock agent access token."""
    return AccessToken(
        token="chat-integration-agent-token",
        token_type="Bearer",
        expires_in=3600,
        scope="openid profile mcp:access",
        issued_at=datetime.now(timezone.utc)
    )


@pytest.fixture
async def chat_system_components(integration_config, mock_agent_token):
    """Create and initialize all chat system components."""
    # Create OAuth manager
    oauth_manager = MagicMock()
    oauth_manager.get_client_credentials_token = AsyncMock(return_value=mock_agent_token)
    oauth_manager.generate_user_authorization_url = MagicMock(
        return_value="https://github.com/login/oauth/authorize?client_id=test&scope=repo&state=test-state"
    )
    oauth_manager.handle_user_authorization_callback = MagicMock(
        return_value={
            "authorization_code": "test-auth-code",
            "state": "test-state",
            "session_id": "test-session",
            "mcp_server_id": "github-mcp"
        }
    )

    # Create MCP client manager
    mcp_manager = MCPClientManager()

    # Create agent components
    conversation_memory = ConversationMemory()
    mcp_tool_provider = MCPToolProvider(mcp_manager, oauth_manager)

    # Mock LangChain agent. The processor drives the agent through
    # process_message_with_tracing(content, session_id, stream_context=...) and
    # binds Path A identity through initialize_session_with_token(...).
    agent = MagicMock(spec=LangChainMCPAgent)
    agent.process_message_with_tracing = AsyncMock()
    agent.initialize_session_with_token = AsyncMock()
    agent.get_available_tools = AsyncMock(return_value=[
        {"name": "list_repositories", "description": "List GitHub repositories"},
        {"name": "create_issue", "description": "Create a GitHub issue"}
    ])

    # Create session manager
    session_manager = SessionManager(integration_config)

    # Create WebSocket handler
    websocket_handler = ChatWebSocketHandler(integration_config)

    # Create message processor
    message_processor = MessageProcessor(
        agent=agent,
        session_manager=session_manager,
        websocket_handler=websocket_handler,
        config=integration_config
    )

    # Wire components together
    websocket_handler.set_message_processor(message_processor)
    websocket_handler.set_session_manager(session_manager)

    # Start message processor
    await message_processor.start()

    components = {
        "oauth_manager": oauth_manager,
        "mcp_manager": mcp_manager,
        "agent": agent,
        "session_manager": session_manager,
        "websocket_handler": websocket_handler,
        "message_processor": message_processor,
        "conversation_memory": conversation_memory
    }

    yield components

    # Cleanup
    await message_processor.stop()
    await session_manager.shutdown()
    await websocket_handler.shutdown()


class MockWebSocket:
    """Mock WebSocket for testing.

    Queue-backed: the iterator BLOCKS while waiting for messages (like a real
    socket) instead of ending the connection when the inbox is momentarily
    empty, so tests can feed messages after the handler has started.
    """

    def __init__(self):
        self.sent_messages = []
        self._incoming: asyncio.Queue = asyncio.Queue()
        self.closed = False
        self.close_code = None

    async def send(self, message: str):
        """Mock send method."""
        if self.closed:
            raise ConnectionClosed(None, None)
        self.sent_messages.append(json.loads(message))

    def add_received_message(self, message: Dict[str, Any]):
        """Add a message to be received."""
        self._incoming.put_nowait(json.dumps(message))

    async def close(self, code=1000, reason=""):
        """Mock close method."""
        self.closed = True
        self.close_code = code
        # Sentinel unblocks a pending __anext__ so the handler loop ends.
        self._incoming.put_nowait(None)

    def __aiter__(self):
        """Async iterator for messages."""
        return self

    async def __anext__(self):
        """Get next message (waits until one arrives or the socket closes)."""
        if self.closed and self._incoming.empty():
            raise StopAsyncIteration
        item = await self._incoming.get()
        if item is None:
            raise StopAsyncIteration
        return item


def session_init_message(user_id: str = None, session_id: str = None) -> Dict[str, Any]:
    """Build a Path A session_init message (auth token is REQUIRED)."""
    msg: Dict[str, Any] = {"type": "session_init", "auth_token": TEST_USER_TOKEN}
    if user_id is not None:
        msg["user_id"] = user_id
    if session_id is not None:
        msg["session_id"] = session_id
    return msg


async def start_initialized_session(websocket_handler, mock_websocket,
                                    user_id: str = None, session_id: str = None,
                                    settle: float = 0.1):
    """Start handle_connection and complete session_init; returns (task, session_id)."""
    mock_websocket.add_received_message(
        session_init_message(user_id=user_id, session_id=session_id)
    )

    handler_task = asyncio.create_task(
        websocket_handler.handle_connection(mock_websocket)
    )

    await asyncio.sleep(settle)

    session_init_msg = next(
        msg for msg in mock_websocket.sent_messages
        if msg.get("type") == "session_initialized"
    )
    return handler_task, session_init_msg["session_id"]


async def finish_handler(mock_websocket, handler_task):
    """Close the socket and wait for the connection handler to finish."""
    if not mock_websocket.closed:
        await mock_websocket.close()
    try:
        await asyncio.wait_for(handler_task, timeout=1.0)
    except asyncio.TimeoutError:
        handler_task.cancel()


class TestCompleteUserChatSessions:
    """Integration tests for complete user chat sessions."""

    @pytest.mark.asyncio
    async def test_simple_chat_session_flow(self, chat_system_components):
        """Test a simple chat session from connection to response."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]

        # Mock agent response
        agent.process_message_with_tracing.return_value = (
            "Hello! I can help you with GitHub repositories. What would you like to do?"
        )

        mock_websocket = MockWebSocket()
        handler_task, session_id = await start_initialized_session(
            websocket_handler, mock_websocket, user_id="test-user-123"
        )

        # Send a chat message on the authenticated session
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "Hello, can you help me list my repositories?",
            "session_id": session_id
        })

        # Wait for message processing
        await asyncio.sleep(0.3)

        # Verify agent was called
        agent.process_message_with_tracing.assert_called_once()
        call_args = agent.process_message_with_tracing.call_args
        assert "repositories" in call_args[0][0].lower()
        assert call_args[0][1] == session_id

        # Check for chat response
        chat_response = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "chat_response":
                chat_response = msg
                break

        assert chat_response is not None
        assert "Hello!" in chat_response["content"]
        assert chat_response["session_id"] == session_id

        await finish_handler(mock_websocket, handler_task)

    @pytest.mark.asyncio
    async def test_chat_session_with_tool_execution(self, chat_system_components):
        """Test chat session that involves tool execution."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]

        # Mock agent response that indicates tool usage
        agent.process_message_with_tracing.return_value = (
            "I found 3 repositories in your GitHub account: repo1, repo2, and repo3."
        )

        mock_websocket = MockWebSocket()
        handler_task, session_id = await start_initialized_session(
            websocket_handler, mock_websocket, user_id="test-user-456"
        )

        # Send chat message requesting tool usage
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "Please list all my GitHub repositories",
            "session_id": session_id
        })

        # Wait for processing
        await asyncio.sleep(0.3)

        # Verify typing indicators were sent
        typing_messages = [
            msg for msg in mock_websocket.sent_messages
            if msg.get("type") in ["typing_start", "typing_stop"]
        ]
        assert len(typing_messages) >= 2  # Should have start and stop

        # Verify agent was called with correct message
        agent.process_message_with_tracing.assert_called_once()
        call_args = agent.process_message_with_tracing.call_args
        assert "repositories" in call_args[0][0].lower()

        # Verify response was sent
        chat_response = next(
            msg for msg in mock_websocket.sent_messages
            if msg.get("type") == "chat_response"
        )
        assert "repositories" in chat_response["content"].lower()
        assert "repo1" in chat_response["content"]

        await finish_handler(mock_websocket, handler_task)

    @pytest.mark.asyncio
    async def test_chat_session_error_handling(self, chat_system_components):
        """Test error handling in chat sessions."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]

        # Mock agent to raise an exception
        agent.process_message_with_tracing.side_effect = Exception("Simulated agent error")

        mock_websocket = MockWebSocket()
        handler_task, session_id = await start_initialized_session(
            websocket_handler, mock_websocket
        )

        # Send message that will cause error
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "This will cause an error",
            "session_id": session_id
        })

        # Wait for processing
        await asyncio.sleep(0.3)

        # Verify error response was sent
        error_response = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "error_response":
                error_response = msg
                break

        assert error_response is not None
        assert "error" in error_response["message"].lower()

        await finish_handler(mock_websocket, handler_task)

    @pytest.mark.asyncio
    async def test_session_timeout_handling(self, chat_system_components):
        """Test handling of session timeouts."""
        components = chat_system_components
        session_manager = components["session_manager"]
        websocket_handler = components["websocket_handler"]

        # Create a session and bind a connection to it
        session = await session_manager.create_session(user_id="test-user")

        mock_websocket = MockWebSocket()
        handler_task, session_id = await start_initialized_session(
            websocket_handler, mock_websocket, session_id=session.session_id
        )
        assert session_id == session.session_id

        # Expire the session AFTER binding (session_init refreshes activity
        # via get_session). Timeout is security.session_timeout_minutes = 60.
        session.last_activity = datetime.now(timezone.utc) - timedelta(minutes=65)

        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "This should fail due to timeout",
            "session_id": session_id
        })

        await asyncio.sleep(0.3)

        # Verify error response for expired session
        error_response = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "error_response":
                error_response = msg
                break

        assert error_response is not None
        assert "expired" in error_response["message"].lower()

        await finish_handler(mock_websocket, handler_task)


class TestAuthorizationFlowIntegration:
    """Integration tests for authorization flow within chat context."""

    @pytest.mark.asyncio
    async def test_auth_challenge_in_chat_flow(self, chat_system_components):
        """Test handling of authentication challenges during chat."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        message_processor = components["message_processor"]
        agent = components["agent"]

        # Mock agent to simulate auth challenge
        async def mock_process_message(message, session_id, **kwargs):
            # Simulate requesting user authorization
            auth_url = "https://github.com/login/oauth/authorize?client_id=test&scope=repo&state=test-state"
            await message_processor.request_user_authorization(session_id, auth_url, "repo")
            return "I need authorization to access your GitHub repositories. Please authorize the application."

        agent.process_message_with_tracing.side_effect = mock_process_message

        mock_websocket = MockWebSocket()
        handler_task, session_id = await start_initialized_session(
            websocket_handler, mock_websocket, user_id="auth-test-user"
        )

        # Send message that triggers auth challenge
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "Create an issue in my repository",
            "session_id": session_id
        })

        # Wait for processing
        await asyncio.sleep(0.3)

        # Verify auth request was sent
        auth_request = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "auth_request":
                auth_request = msg
                break

        assert auth_request is not None
        assert "github.com" in auth_request["auth_url"]
        assert auth_request["session_id"] == session_id

        # Simulate user completing authorization
        state = auth_request["state"]
        mock_websocket.add_received_message({
            "type": "auth_response",
            "session_id": session_id,
            "auth_code": "user-auth-code-123",
            "state": state
        })

        # Wait for auth processing
        await asyncio.sleep(0.2)

        # Verify auth confirmation was sent
        auth_confirmed = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "auth_confirmed":
                auth_confirmed = msg
                break

        assert auth_confirmed is not None

        await finish_handler(mock_websocket, handler_task)

    @pytest.mark.asyncio
    async def test_auth_flow_with_invalid_state(self, chat_system_components):
        """Test handling of invalid state in authorization flow."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]

        mock_websocket = MockWebSocket()
        handler_task, session_id = await start_initialized_session(
            websocket_handler, mock_websocket
        )

        # Send auth response with invalid state
        mock_websocket.add_received_message({
            "type": "auth_response",
            "session_id": session_id,
            "auth_code": "auth-code-123",
            "state": "invalid-state-parameter"
        })

        # Wait for processing
        await asyncio.sleep(0.2)

        # Verify error response was sent
        error_response = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "error_response":
                error_response = msg
                break

        assert error_response is not None
        assert "invalid" in error_response["message"].lower()

        await finish_handler(mock_websocket, handler_task)

    @pytest.mark.asyncio
    async def test_multiple_auth_requests_same_session(self, chat_system_components):
        """Test handling multiple authorization requests in the same session."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        message_processor = components["message_processor"]

        mock_websocket = MockWebSocket()
        handler_task, session_id = await start_initialized_session(
            websocket_handler, mock_websocket
        )

        # Request multiple authorizations
        auth_url1 = "https://github.com/login/oauth/authorize?client_id=test&scope=repo"
        auth_url2 = "https://slack.com/oauth/authorize?client_id=test&scope=channels:read"

        state1 = await message_processor.request_user_authorization(session_id, auth_url1, "repo")
        state2 = await message_processor.request_user_authorization(session_id, auth_url2, "channels:read")

        # Wait for processing
        await asyncio.sleep(0.2)

        # Verify both auth requests were sent
        auth_requests = [
            msg for msg in mock_websocket.sent_messages
            if msg.get("type") == "auth_request"
        ]
        assert len(auth_requests) == 2

        # Verify states are different
        states = [req["state"] for req in auth_requests]
        assert len(set(states)) == 2  # All states should be unique
        assert state1 in states
        assert state2 in states

        await finish_handler(mock_websocket, handler_task)


class TestConcurrentUserSessions:
    """Performance tests for concurrent user sessions."""

    @pytest.mark.asyncio
    async def test_multiple_concurrent_sessions(self, chat_system_components):
        """Test handling multiple concurrent chat sessions."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]

        # Mock agent responses
        agent.process_message_with_tracing.return_value = "Response from agent"

        # Create multiple mock WebSockets
        num_sessions = 5
        mock_websockets = []
        handler_tasks = []
        session_ids = []

        for i in range(num_sessions):
            mock_websocket = MockWebSocket()
            mock_websockets.append(mock_websocket)

            task, session_id = await start_initialized_session(
                websocket_handler, mock_websocket,
                user_id=f"concurrent-user-{i}", settle=0.05
            )
            handler_tasks.append(task)
            session_ids.append(session_id)

        # Send messages to all sessions concurrently
        for i, (mock_websocket, session_id) in enumerate(zip(mock_websockets, session_ids)):
            mock_websocket.add_received_message({
                "type": "chat_message",
                "content": f"Message from user {i}",
                "session_id": session_id
            })

        # Wait for all messages to be processed
        await asyncio.sleep(0.5)

        # Verify all sessions received responses
        for mock_websocket in mock_websockets:
            chat_response = None
            for msg in mock_websocket.sent_messages:
                if msg.get("type") == "chat_response":
                    chat_response = msg
                    break
            assert chat_response is not None
            assert "Response from agent" in chat_response["content"]

        # Verify agent was called for each session
        assert agent.process_message_with_tracing.call_count == num_sessions

        # Cleanup
        for mock_websocket, task in zip(mock_websockets, handler_tasks):
            await finish_handler(mock_websocket, task)

    @pytest.mark.asyncio
    async def test_session_isolation(self, chat_system_components):
        """Test that sessions are properly isolated from each other."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]

        # Mock agent to return session-specific responses
        async def mock_process_message(message, session_id, **kwargs):
            return f"Response for session {session_id}: {message}"

        agent.process_message_with_tracing.side_effect = mock_process_message

        # Create two sessions
        mock_websocket1 = MockWebSocket()
        mock_websocket2 = MockWebSocket()

        task1, session_id1 = await start_initialized_session(
            websocket_handler, mock_websocket1, user_id="isolation-user-1"
        )
        task2, session_id2 = await start_initialized_session(
            websocket_handler, mock_websocket2, user_id="isolation-user-2"
        )

        # Verify sessions are different
        assert session_id1 != session_id2

        # Send different messages to each session
        mock_websocket1.add_received_message({
            "type": "chat_message",
            "content": "Message from session 1",
            "session_id": session_id1
        })
        mock_websocket2.add_received_message({
            "type": "chat_message",
            "content": "Message from session 2",
            "session_id": session_id2
        })

        await asyncio.sleep(0.3)

        # Verify each session got its own response
        response1 = next(
            msg for msg in mock_websocket1.sent_messages
            if msg.get("type") == "chat_response"
        )
        response2 = next(
            msg for msg in mock_websocket2.sent_messages
            if msg.get("type") == "chat_response"
        )

        assert session_id1 in response1["content"]
        assert "session 1" in response1["content"]
        assert session_id2 in response2["content"]
        assert "session 2" in response2["content"]

        # Verify sessions are tracked separately
        active_sessions = websocket_handler.get_active_sessions()
        assert session_id1 in active_sessions
        assert session_id2 in active_sessions
        assert len(active_sessions) >= 2

        # Cleanup
        await finish_handler(mock_websocket1, task1)
        await finish_handler(mock_websocket2, task2)

    @pytest.mark.asyncio
    async def test_session_cleanup_on_disconnect(self, chat_system_components):
        """Test that sessions are properly cleaned up when clients disconnect."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]

        mock_websocket = MockWebSocket()
        handler_task, session_id = await start_initialized_session(
            websocket_handler, mock_websocket, user_id="cleanup-test-user"
        )

        # Verify session is active
        active_sessions = websocket_handler.get_active_sessions()
        assert session_id in active_sessions

        # Close WebSocket to simulate disconnect
        await mock_websocket.close()

        # Wait for cleanup
        await asyncio.sleep(0.2)

        # Verify session was cleaned up
        active_sessions = websocket_handler.get_active_sessions()
        assert session_id not in active_sessions

        await finish_handler(mock_websocket, handler_task)

    @pytest.mark.asyncio
    async def test_performance_under_load(self, chat_system_components):
        """Test system performance under high message load."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]

        # Mock fast agent response
        agent.process_message_with_tracing.return_value = "Quick response"

        mock_websocket = MockWebSocket()
        handler_task, session_id = await start_initialized_session(
            websocket_handler, mock_websocket, user_id="load-test-user"
        )

        # Send many messages rapidly
        num_messages = 10
        start_time = datetime.now()

        for i in range(num_messages):
            mock_websocket.add_received_message({
                "type": "chat_message",
                "content": f"Load test message {i}",
                "session_id": session_id
            })

        # Wait for all messages to be processed
        await asyncio.sleep(1.0)

        end_time = datetime.now()
        processing_time = (end_time - start_time).total_seconds()

        # Verify all messages were processed
        chat_responses = [
            msg for msg in mock_websocket.sent_messages
            if msg.get("type") == "chat_response"
        ]

        assert len(chat_responses) == num_messages

        # Verify reasonable performance (should process messages quickly)
        assert processing_time < 2.0  # Should complete within 2 seconds

        # Verify agent was called for each message
        assert agent.process_message_with_tracing.call_count == num_messages

        await finish_handler(mock_websocket, handler_task)


class TestChatSystemResilience:
    """Tests for chat system resilience and error recovery."""

    @pytest.mark.asyncio
    async def test_recovery_from_agent_failure(self, chat_system_components):
        """Test system recovery when agent fails."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]

        # Mock agent to fail initially, then recover
        call_count = 0

        async def mock_process_message(message, session_id, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Agent temporarily unavailable")
            return "Agent recovered and processed your message"

        agent.process_message_with_tracing.side_effect = mock_process_message

        mock_websocket = MockWebSocket()
        handler_task, session_id = await start_initialized_session(
            websocket_handler, mock_websocket
        )

        # Send message that will fail
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "This will fail initially",
            "session_id": session_id
        })

        await asyncio.sleep(0.3)

        # Verify error response was sent
        error_response = next(
            msg for msg in mock_websocket.sent_messages
            if msg.get("type") == "error_response"
        )
        assert "error" in error_response["message"].lower()

        # Send another message that should succeed
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "This should work now",
            "session_id": session_id
        })

        await asyncio.sleep(0.3)

        # Verify successful response
        chat_response = None
        for msg in reversed(mock_websocket.sent_messages):
            if msg.get("type") == "chat_response":
                chat_response = msg
                break

        assert chat_response is not None
        assert "recovered" in chat_response["content"]

        await finish_handler(mock_websocket, handler_task)

    @pytest.mark.asyncio
    async def test_graceful_shutdown(self, chat_system_components):
        """Test graceful shutdown of chat system components."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        message_processor = components["message_processor"]
        session_manager = components["session_manager"]

        # Create active sessions
        mock_websockets = []
        handler_tasks = []

        for i in range(3):
            mock_websocket = MockWebSocket()
            mock_websockets.append(mock_websocket)

            task, _ = await start_initialized_session(
                websocket_handler, mock_websocket,
                user_id=f"shutdown-user-{i}", settle=0.05
            )
            handler_tasks.append(task)

        await asyncio.sleep(0.1)

        # Verify sessions are active
        active_sessions = websocket_handler.get_active_sessions()
        assert len(active_sessions) >= 3

        # Initiate graceful shutdown
        await message_processor.stop()
        await websocket_handler.shutdown()
        await session_manager.shutdown()

        # Verify all connections were closed
        for mock_websocket in mock_websockets:
            assert mock_websocket.closed

        # Verify no active sessions remain
        active_sessions = websocket_handler.get_active_sessions()
        assert len(active_sessions) == 0

        # Wait for handler tasks to finish
        for mock_websocket, task in zip(mock_websockets, handler_tasks):
            await finish_handler(mock_websocket, task)
