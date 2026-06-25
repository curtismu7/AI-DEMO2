"""
Unit tests for WebSocket handler.
"""
import asyncio
import json
import pytest
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timezone

from src.api.websocket_handler import ChatWebSocketHandler
from src.models.chat import ChatMessage, MessageRole
from src.config.settings import ChatConfig, AppConfig


class MockWebSocket:
    """Mock WebSocket for testing."""
    
    def __init__(self, messages=None):
        self.messages = messages or []
        self.sent_messages = []
        self.closed = False
        self.close_code = None
        self.message_index = 0

    async def send(self, message):
        """Mock send method."""
        if self.closed:
            raise ConnectionClosed("Connection closed")
        self.sent_messages.append(message)

    async def close(self, code=1000, reason=""):
        """Mock close method."""
        self.closed = True
        self.close_code = code
    
    def __aiter__(self):
        return self
    
    async def __anext__(self):
        if self.message_index >= len(self.messages):
            raise StopAsyncIteration
        message = self.messages[self.message_index]
        self.message_index += 1
        return message


class ConnectionClosed(Exception):
    """Mock ConnectionClosed exception."""
    pass


@pytest.fixture
def mock_config():
    """Create a mock configuration."""
    chat_config = ChatConfig(
        websocket_port=8080,
        max_message_length=1000,
        conversation_history_limit=100,
        session_cleanup_interval_minutes=15
    )
    
    config = Mock(spec=AppConfig)
    config.chat = chat_config
    return config


@pytest.fixture
def websocket_handler(mock_config):
    """Create a WebSocket handler for testing."""
    return ChatWebSocketHandler(config=mock_config)


def patch_token_validator(sub="token-sub-1", side_effect=None):
    """Patch the handler's lazy token-validator import.

    The session_init handler validates the token itself (before any session
    state is created or rebound) via authentication.token_validator. Tests
    stub it so no real PingOne JWKS validation happens.
    """
    mock_validator = Mock()
    if side_effect is not None:
        mock_validator.validate.side_effect = side_effect
    else:
        mock_validator.validate.return_value = Mock(sub=sub)
    return patch(
        "authentication.token_validator.get_token_validator",
        return_value=mock_validator,
    )


@pytest.mark.asyncio
class TestChatWebSocketHandler:
    """Test cases for ChatWebSocketHandler."""
    
    async def test_initialization(self, websocket_handler):
        """Test WebSocket handler initialization."""
        assert websocket_handler._connections == {}
        assert websocket_handler._session_connections == {}
        assert websocket_handler._connection_metadata == {}
        assert len(websocket_handler._message_handlers) == 5
    
    async def test_handle_connection_success(self, websocket_handler):
        """Test successful connection handling."""
        mock_websocket = MockWebSocket([])
        
        # Mock the connection handling to avoid infinite loop
        with patch.object(websocket_handler, '_process_message') as mock_process:
            # Simulate connection close after setup
            mock_websocket.messages = []
            
            # Start connection handling
            task = asyncio.create_task(
                websocket_handler.handle_connection(mock_websocket)
            )
            
            # Give it a moment to set up
            await asyncio.sleep(0.01)
            
            # Close the connection to end the loop
            mock_websocket.closed = True
            
            # Wait for completion
            await task
        
        # Check that connection acknowledgment was sent
        assert len(mock_websocket.sent_messages) == 1
        ack_message = json.loads(mock_websocket.sent_messages[0])
        assert ack_message["type"] == "connection_ack"
        assert "connection_id" in ack_message
        assert "timestamp" in ack_message
    
    async def test_process_message_invalid_json(self, websocket_handler):
        """Test processing invalid JSON message."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        await websocket_handler._process_message(connection_id, "invalid json")
        
        # Should send error message
        assert len(mock_websocket.sent_messages) == 1
        error_message = json.loads(mock_websocket.sent_messages[0])
        assert error_message["type"] == "error"
        assert error_message["error_code"] == "invalid_json"
    
    async def test_process_message_missing_type(self, websocket_handler):
        """Test processing message without type field."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        message = json.dumps({"content": "test message"})
        await websocket_handler._process_message(connection_id, message)
        
        # Should send error message
        assert len(mock_websocket.sent_messages) == 1
        error_message = json.loads(mock_websocket.sent_messages[0])
        assert error_message["type"] == "error"
        assert error_message["error_code"] == "invalid_message"
    
    async def test_process_message_unknown_type(self, websocket_handler):
        """Test processing message with unknown type."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        message = json.dumps({"type": "unknown_type", "content": "test"})
        await websocket_handler._process_message(connection_id, message)
        
        # Should send error message
        assert len(mock_websocket.sent_messages) == 1
        error_message = json.loads(mock_websocket.sent_messages[0])
        assert error_message["type"] == "error"
        assert error_message["error_code"] == "invalid_message"
    
    async def test_handle_chat_message_success(self, websocket_handler):
        """Test successful chat message handling."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        # WR-01: the authenticated session must already be bound to the
        # connection metadata (set during _handle_session_init). The chat
        # handler derives the session from here, never from the message body.
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": session_id,
            "user_id": None
        }

        # Mock the message processor notification
        with patch.object(websocket_handler, '_notify_message_processor') as mock_notify:
            message = {
                "type": "chat_message",
                "content": "Hello, world!",
                "session_id": session_id,
                "_connection_id": connection_id,
                "_timestamp": datetime.now(timezone.utc).isoformat()
            }

            await websocket_handler._handle_chat_message(message)

        # Should send acknowledgment
        assert len(mock_websocket.sent_messages) == 1
        ack_message = json.loads(mock_websocket.sent_messages[0])
        assert ack_message["type"] == "message_received"
        assert ack_message["session_id"] == session_id

        # Should notify message processor
        mock_notify.assert_called_once()

    async def test_handle_chat_message_rejects_body_session_mismatch(self, websocket_handler):
        """WR-01: reject when message body session_id differs from the
        connection-bound (authenticated) session, and do NOT mutate
        _session_connections / _connection_metadata to the forged id."""
        connection_id = "test-conn-1"
        bound_session = "real-session-A"
        forged_session = "attacker-session-B"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": bound_session,
            "user_id": None
        }

        with patch.object(websocket_handler, '_notify_message_processor') as mock_notify:
            message = {
                "type": "chat_message",
                "content": "Hello, world!",
                "session_id": forged_session,  # tampered
                "_connection_id": connection_id,
                "_timestamp": datetime.now(timezone.utc).isoformat()
            }
            await websocket_handler._handle_chat_message(message)

        # No processing, error sent instead.
        mock_notify.assert_not_called()
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "error"
        assert response["error_code"] == "session_id_mismatch"

        # The forged id must NOT have leaked into the routing maps.
        assert forged_session not in websocket_handler._session_connections
        assert websocket_handler._connection_metadata[connection_id]["session_id"] == bound_session

    async def test_handle_chat_message_rejects_before_session_init(self, websocket_handler):
        """WR-01: a chat_message before any session_init (no bound session on
        the connection) is rejected — chat before session_init is not valid."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        # NOTE: no _connection_metadata entry — connection never ran session_init.

        with patch.object(websocket_handler, '_notify_message_processor') as mock_notify:
            message = {
                "type": "chat_message",
                "content": "Hello, world!",
                "session_id": "some-session",
                "_connection_id": connection_id,
                "_timestamp": datetime.now(timezone.utc).isoformat()
            }
            await websocket_handler._handle_chat_message(message)

        mock_notify.assert_not_called()
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "error"
        assert response["error_code"] == "invalid_session"
        assert "some-session" not in websocket_handler._session_connections
    
    async def test_handle_chat_message_missing_content(self, websocket_handler):
        """Test chat message handling with missing content."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        message = {
            "type": "chat_message",
            "session_id": "test-session-1",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await websocket_handler._handle_chat_message(message)
        
        # Should send error message
        assert len(mock_websocket.sent_messages) == 1
        error_message = json.loads(mock_websocket.sent_messages[0])
        assert error_message["type"] == "error"
        assert error_message["error_code"] == "invalid_content"
    
    async def test_handle_chat_message_too_long(self, websocket_handler):
        """Test chat message handling with content too long."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        # WR-01: bind the authenticated session so the handler reaches the
        # WR-12 byte-length check (it now rejects unbound connections first).
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": session_id,
            "user_id": None
        }

        # Create message longer than max length
        long_content = "x" * (websocket_handler.config.chat.max_message_length + 1)
        
        message = {
            "type": "chat_message",
            "content": long_content,
            "session_id": "test-session-1",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await websocket_handler._handle_chat_message(message)
        
        # Should send error message
        assert len(mock_websocket.sent_messages) == 1
        error_message = json.loads(mock_websocket.sent_messages[0])
        assert error_message["type"] == "error"
        assert error_message["error_code"] == "message_too_long"
    
    async def test_handle_session_init_with_valid_token(self, websocket_handler):
        """Path A: a valid token (validated by the message processor) binds the
        session and the ack carries NO user identifier back to the browser."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()

        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": None,
            "user_id": None,
        }

        # Message processor is the token validator boundary; mock it succeeding.
        mock_processor = Mock()
        mock_processor.process_session_init_with_token = AsyncMock(return_value=None)
        websocket_handler.set_message_processor(mock_processor)

        message = {
            "type": "session_init",
            "session_id": session_id,
            "auth_token": "valid.bff.delivered.token",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        with patch_token_validator(sub="user-sub-1"):
            await websocket_handler._handle_session_init(message)

        # Token was handed to the validation boundary.
        mock_processor.process_session_init_with_token.assert_awaited_once_with(
            session_id, "valid.bff.delivered.token"
        )

        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "session_initialized"
        assert response["session_id"] == session_id
        # Identity is NOT echoed back to the browser (token custody / Path A).
        assert "user_id" not in response
        assert "userEmail" not in response
        assert websocket_handler._connection_metadata[connection_id]["session_id"] == session_id
        assert websocket_handler._session_connections[session_id] == connection_id

    async def test_handle_session_init_no_token_refused(self, websocket_handler):
        """Path A: session_init WITHOUT a token is refused (no identity source)."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()

        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": None,
            "user_id": None,
        }

        message = {
            "type": "session_init",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        await websocket_handler._handle_session_init(message)

        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "error"
        assert response["error_code"] == "auth_required"

    async def test_handle_session_init_spoofed_user_id_no_token_refused(
        self, websocket_handler
    ):
        """CR-02 regression: a client-supplied user_id with NO token cannot
        impersonate anyone — the session is refused, not bound."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()

        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": None,
            "user_id": None,
        }

        mock_processor = Mock()
        mock_processor.process_session_init_with_token = AsyncMock(return_value=None)
        websocket_handler.set_message_processor(mock_processor)

        message = {
            "type": "session_init",
            "session_id": "s1",
            "user_id": "victim-user-id",
            "userEmail": "victim@example.com",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        await websocket_handler._handle_session_init(message)

        # Identity binding was NEVER attempted from the claimed id/email.
        mock_processor.process_session_init_with_token.assert_not_awaited()
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "error"
        assert response["error_code"] == "auth_required"

    async def test_handle_session_init_invalid_token_refused(self, websocket_handler):
        """Path A: a token the validator rejects refuses the session."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()

        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": None,
            "user_id": None,
        }

        mock_processor = Mock()
        mock_processor.process_session_init_with_token = AsyncMock(return_value=None)
        websocket_handler.set_message_processor(mock_processor)

        message = {
            "type": "session_init",
            "session_id": "s1",
            "auth_token": "tampered.token",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        with patch_token_validator(
            side_effect=Exception("Token rejected: signature verification failed")
        ):
            await websocket_handler._handle_session_init(message)

        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "error"
        assert response["error_code"] == "auth_invalid"
        # Identity binding was never attempted with the rejected token.
        mock_processor.process_session_init_with_token.assert_not_awaited()

    async def test_session_init_invalid_token_creates_nothing_and_closes(
        self, websocket_handler
    ):
        """FIX 2 regression (i): session_init with an INVALID token never
        creates a session, never binds routing, and the socket is closed."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()

        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": None,
            "user_id": None,
        }

        mock_processor = Mock()
        mock_processor.process_session_init_with_token = AsyncMock(return_value=None)
        websocket_handler.set_message_processor(mock_processor)

        mock_session_manager = Mock()
        mock_session_manager.get_session = AsyncMock(return_value=None)
        mock_session_manager.create_session = AsyncMock()
        websocket_handler.set_session_manager(mock_session_manager)

        message = {
            "type": "session_init",
            "session_id": "s1",
            "auth_token": "tampered.token",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        with patch_token_validator(side_effect=Exception("Token rejected")):
            await websocket_handler._handle_session_init(message)

        # Refused with an error and the socket was closed (4401).
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "error"
        assert response["error_code"] == "auth_invalid"
        assert mock_websocket.closed
        assert mock_websocket.close_code == 4401

        # No session was created and no routing was bound.
        mock_session_manager.create_session.assert_not_awaited()
        mock_processor.process_session_init_with_token.assert_not_awaited()
        assert "s1" not in websocket_handler._session_connections
        assert "s1" not in websocket_handler._session_owners
        assert websocket_handler._connection_metadata[connection_id]["session_id"] is None

    async def test_session_init_missing_token_creates_nothing_and_closes(
        self, websocket_handler
    ):
        """FIX 2 regression (i): session_init with NO token never creates a
        session, never binds routing, and the socket is closed."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()

        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": None,
            "user_id": None,
        }

        mock_processor = Mock()
        mock_processor.process_session_init_with_token = AsyncMock(return_value=None)
        websocket_handler.set_message_processor(mock_processor)

        mock_session_manager = Mock()
        mock_session_manager.get_session = AsyncMock(return_value=None)
        mock_session_manager.create_session = AsyncMock()
        websocket_handler.set_session_manager(mock_session_manager)

        message = {
            "type": "session_init",
            "session_id": "s1",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        await websocket_handler._handle_session_init(message)

        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "error"
        assert response["error_code"] == "auth_required"
        assert mock_websocket.closed
        assert mock_websocket.close_code == 4401

        mock_session_manager.create_session.assert_not_awaited()
        mock_processor.process_session_init_with_token.assert_not_awaited()
        assert "s1" not in websocket_handler._session_connections
        assert websocket_handler._connection_metadata[connection_id]["session_id"] is None

    async def test_session_init_other_user_cannot_rebind_existing_session(
        self, websocket_handler
    ):
        """FIX 2 regression (ii): a second connection presenting a token for a
        DIFFERENT user cannot rebind an existing session — the existing
        session's routing and worker are untouched."""
        # Victim's session, already bound.
        victim_conn = "conn-victim"
        victim_ws = MockWebSocket()
        websocket_handler._connections[victim_conn] = victim_ws
        websocket_handler._connection_metadata[victim_conn] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": "s1",
            "user_id": None,
        }
        websocket_handler._session_connections["s1"] = victim_conn
        websocket_handler._session_owners["s1"] = "victim-sub"

        # Attacker's fresh connection.
        attacker_conn = "conn-attacker"
        attacker_ws = MockWebSocket()
        websocket_handler._connections[attacker_conn] = attacker_ws
        websocket_handler._connection_metadata[attacker_conn] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": None,
            "user_id": None,
        }

        mock_processor = Mock()
        mock_processor.process_session_init_with_token = AsyncMock(return_value=None)
        websocket_handler.set_message_processor(mock_processor)

        message = {
            "type": "session_init",
            "session_id": "s1",
            "auth_token": "attacker.valid.token",
            "_connection_id": attacker_conn,
            "_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        with patch.object(
            websocket_handler, "_teardown_session_worker"
        ) as mock_teardown, patch_token_validator(sub="attacker-sub"):
            await websocket_handler._handle_session_init(message)

        # Attacker got an error and their socket was closed.
        response = json.loads(attacker_ws.sent_messages[0])
        assert response["type"] == "error"
        assert response["error_code"] == "session_owner_mismatch"
        assert attacker_ws.closed
        assert attacker_ws.close_code == 4401

        # The victim's session was NOT rebound, its identity binding was
        # never overwritten, and its worker was NOT torn down.
        assert websocket_handler._session_connections["s1"] == victim_conn
        assert websocket_handler._session_owners["s1"] == "victim-sub"
        mock_processor.process_session_init_with_token.assert_not_awaited()
        mock_teardown.assert_not_called()
        assert not victim_ws.closed

    async def test_session_init_same_user_rebinds_existing_session(
        self, websocket_handler
    ):
        """A reconnect by the SAME token-derived user may rebind the session
        to the new connection (legitimate reconnect flow)."""
        old_conn = "conn-old"
        websocket_handler._session_connections["s1"] = old_conn
        websocket_handler._session_owners["s1"] = "user-sub-1"

        new_conn = "conn-new"
        new_ws = MockWebSocket()
        websocket_handler._connections[new_conn] = new_ws
        websocket_handler._connection_metadata[new_conn] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": None,
            "user_id": None,
        }

        mock_processor = Mock()
        mock_processor.process_session_init_with_token = AsyncMock(return_value=None)
        websocket_handler.set_message_processor(mock_processor)

        message = {
            "type": "session_init",
            "session_id": "s1",
            "auth_token": "same.user.fresh.token",
            "_connection_id": new_conn,
            "_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        with patch_token_validator(sub="user-sub-1"):
            await websocket_handler._handle_session_init(message)

        response = json.loads(new_ws.sent_messages[0])
        assert response["type"] == "session_initialized"
        assert response["session_id"] == "s1"
        assert websocket_handler._session_connections["s1"] == new_conn
        assert websocket_handler._session_owners["s1"] == "user-sub-1"

    async def test_cleanup_stale_connection_does_not_unbind_current(
        self, websocket_handler
    ):
        """FIX 3: cleaning up a stale/superseded connection must not remove
        the session's CURRENT routing entry or tear down its worker."""
        old_conn = "conn-old"
        new_conn = "conn-new"
        session_id = "s1"

        websocket_handler._connections[old_conn] = MockWebSocket()
        websocket_handler._connection_metadata[old_conn] = {
            "session_id": session_id,
            "user_id": None,
        }
        # The session has since been rebound to a newer connection.
        websocket_handler._session_connections[session_id] = new_conn

        with patch.object(
            websocket_handler, "_teardown_session_worker"
        ) as mock_teardown:
            await websocket_handler._cleanup_connection(old_conn)

        # Connection-local state is gone, session state is intact.
        assert old_conn not in websocket_handler._connections
        assert old_conn not in websocket_handler._connection_metadata
        assert websocket_handler._session_connections[session_id] == new_conn
        mock_teardown.assert_not_called()

    async def test_session_close_from_superseded_connection_does_not_teardown(
        self, websocket_handler
    ):
        """FIX 3: a session_close from a connection that no longer owns the
        session must not tear down the session's worker or routing."""
        old_conn = "conn-old"
        new_conn = "conn-new"
        session_id = "s1"
        old_ws = MockWebSocket()

        websocket_handler._connections[old_conn] = old_ws
        websocket_handler._connection_metadata[old_conn] = {
            "session_id": session_id,
            "user_id": None,
        }
        websocket_handler._session_connections[session_id] = new_conn

        message = {
            "type": "session_close",
            "_connection_id": old_conn,
            "_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        with patch.object(
            websocket_handler, "_teardown_session_worker"
        ) as mock_teardown:
            await websocket_handler._handle_session_close(message)

        assert websocket_handler._session_connections[session_id] == new_conn
        mock_teardown.assert_not_called()
        # The closing connection still gets its ack (message shape preserved).
        response = json.loads(old_ws.sent_messages[0])
        assert response["type"] == "session_closed"

    async def test_handle_session_close(self, websocket_handler):
        """Test session close handling."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": session_id,
            "user_id": None
        }
        websocket_handler._session_connections[session_id] = connection_id
        
        message = {
            "type": "session_close",
            "session_id": session_id,
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await websocket_handler._handle_session_close(message)
        
        # Should send session closed response
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "session_closed"
        assert response["session_id"] == session_id
        
        # Should remove session mapping
        assert session_id not in websocket_handler._session_connections
        assert websocket_handler._connection_metadata[connection_id]["session_id"] is None
    
    async def test_handle_ping(self, websocket_handler):
        """Test ping message handling."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        message = {
            "type": "ping",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await websocket_handler._handle_ping(message)
        
        # Should send pong response
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "pong"
        assert "timestamp" in response
    
    async def test_handle_auth_response(self, websocket_handler):
        """Test authorization response handling."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        # BL-04: bind session_id to the connection metadata first. _handle_auth_response
        # now reads the authenticated session from connection_metadata, not the body.
        websocket_handler._connection_metadata[connection_id] = {"session_id": session_id}

        # Mock the auth response notification
        with patch.object(websocket_handler, '_notify_auth_response') as mock_notify:
            message = {
                "type": "auth_response",
                "session_id": session_id,
                "auth_code": "test-auth-code",
                "state": "test-state",
                "_connection_id": connection_id,
                "_timestamp": datetime.now(timezone.utc).isoformat()
            }

            await websocket_handler._handle_auth_response(message)

        # Should send acknowledgment
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "auth_received"
        assert response["session_id"] == session_id

        # Should notify about auth response
        mock_notify.assert_called_once_with(session_id, "test-auth-code", "test-state")

    async def test_handle_auth_response_rejects_body_session_mismatch(self, websocket_handler):
        """BL-04: reject when message body session_id differs from connection-bound session."""
        connection_id = "test-conn-1"
        bound_session = "real-session-A"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {"session_id": bound_session}

        with patch.object(websocket_handler, '_notify_auth_response') as mock_notify:
            message = {
                "type": "auth_response",
                "session_id": "attacker-session-B",  # tampered
                "auth_code": "test-auth-code",
                "state": "test-state",
                "_connection_id": connection_id,
                "_timestamp": datetime.now(timezone.utc).isoformat()
            }
            await websocket_handler._handle_auth_response(message)

        # No notification, error sent instead.
        mock_notify.assert_not_called()
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "error"
        assert response["error_code"] == "session_id_mismatch"

    async def test_handle_auth_response_rejects_unbound_connection(self, websocket_handler):
        """BL-04: reject when connection has not been bound to a session via session_init."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        # NOTE: no _connection_metadata entry — connection never ran session_init.

        with patch.object(websocket_handler, '_notify_auth_response') as mock_notify:
            message = {
                "type": "auth_response",
                "session_id": "some-session",
                "auth_code": "test-auth-code",
                "state": "test-state",
                "_connection_id": connection_id,
                "_timestamp": datetime.now(timezone.utc).isoformat()
            }
            await websocket_handler._handle_auth_response(message)

        mock_notify.assert_not_called()
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "error"
        assert response["error_code"] == "invalid_session"
    
    async def test_send_message_to_session_success(self, websocket_handler):
        """Test sending message to session successfully."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._session_connections[session_id] = connection_id
        
        message = {"type": "test", "content": "test message"}
        result = await websocket_handler.send_message_to_session(session_id, message)
        
        assert result is True
        assert len(mock_websocket.sent_messages) == 1
        sent_message = json.loads(mock_websocket.sent_messages[0])
        assert sent_message == message
    
    async def test_send_message_to_session_no_connection(self, websocket_handler):
        """Test sending message to session with no active connection."""
        session_id = "test-session-1"
        message = {"type": "test", "content": "test message"}
        
        result = await websocket_handler.send_message_to_session(session_id, message)
        
        assert result is False
    
    async def test_send_chat_response(self, websocket_handler):
        """Test sending chat response to session."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._session_connections[session_id] = connection_id
        
        result = await websocket_handler.send_chat_response(
            session_id, "Hello, user!", {"tool": "test"}
        )
        
        assert result is True
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "chat_response"
        assert response["content"] == "Hello, user!"
        assert response["session_id"] == session_id
        assert response["metadata"]["tool"] == "test"
    
    async def test_send_auth_request(self, websocket_handler):
        """Test sending authorization request to session."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._session_connections[session_id] = connection_id
        
        result = await websocket_handler.send_auth_request(
            session_id, "https://auth.example.com", "test-state"
        )
        
        assert result is True
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "auth_request"
        assert response["auth_url"] == "https://auth.example.com"
        assert response["state"] == "test-state"
        assert response["session_id"] == session_id
    
    async def test_cleanup_connection(self, websocket_handler):
        """Test connection cleanup."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        # Set up connection data
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "session_id": session_id,
            "user_id": "test-user"
        }
        websocket_handler._session_connections[session_id] = connection_id
        
        await websocket_handler._cleanup_connection(connection_id)
        
        # Should remove all connection data
        assert connection_id not in websocket_handler._connections
        assert connection_id not in websocket_handler._connection_metadata
        assert session_id not in websocket_handler._session_connections
    
    async def test_get_active_connections(self, websocket_handler):
        """Test getting active connections."""
        connection_id = "test-conn-1"
        metadata = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": "test-session-1",
            "user_id": "test-user"
        }
        
        websocket_handler._connection_metadata[connection_id] = metadata
        
        active_connections = websocket_handler.get_active_connections()
        
        assert active_connections == {connection_id: metadata}
        # Should return a copy, not the original
        assert active_connections is not websocket_handler._connection_metadata
    
    async def test_get_active_sessions(self, websocket_handler):
        """Test getting active sessions."""
        session_id = "test-session-1"
        connection_id = "test-conn-1"
        
        websocket_handler._session_connections[session_id] = connection_id
        
        active_sessions = websocket_handler.get_active_sessions()
        
        assert active_sessions == {session_id: connection_id}
        # Should return a copy, not the original
        assert active_sessions is not websocket_handler._session_connections
    
    async def test_broadcast_to_all(self, websocket_handler):
        """Test broadcasting message to all connections."""
        # Set up multiple connections
        mock_websocket1 = MockWebSocket()
        mock_websocket2 = MockWebSocket()
        mock_websocket3 = MockWebSocket()
        
        websocket_handler._connections = {
            "conn-1": mock_websocket1,
            "conn-2": mock_websocket2,
            "conn-3": mock_websocket3
        }
        
        message = {"type": "broadcast", "content": "Hello everyone!"}
        sent_count = await websocket_handler.broadcast_to_all(message)
        
        assert sent_count == 3
        
        # Check all connections received the message
        for websocket in [mock_websocket1, mock_websocket2, mock_websocket3]:
            assert len(websocket.sent_messages) == 1
            sent_message = json.loads(websocket.sent_messages[0])
            assert sent_message == message
    
    async def test_shutdown(self, websocket_handler):
        """Test WebSocket handler shutdown."""
        # Set up connections and data
        mock_websocket1 = MockWebSocket()
        mock_websocket2 = MockWebSocket()
        
        websocket_handler._connections = {
            "conn-1": mock_websocket1,
            "conn-2": mock_websocket2
        }
        websocket_handler._session_connections = {"session-1": "conn-1"}
        websocket_handler._connection_metadata = {"conn-1": {"test": "data"}}
        
        await websocket_handler.shutdown()
        
        # Should close all connections
        assert mock_websocket1.closed
        assert mock_websocket2.closed
        
        # Should clear all data
        assert websocket_handler._connections == {}
        assert websocket_handler._session_connections == {}
        assert websocket_handler._connection_metadata == {}