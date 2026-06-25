"""
Unit tests for SessionManager.
"""
import asyncio
import pytest
from unittest.mock import Mock, patch
from datetime import datetime, timezone, timedelta

from src.api.session_manager import SessionManager
from src.models.chat import ChatSession, ChatMessage, MessageRole
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
def session_manager(mock_config):
    """Create a SessionManager for testing."""
    return SessionManager(config=mock_config)


@pytest.mark.asyncio
class TestSessionManager:
    """Test cases for SessionManager."""
    
    async def test_initialization(self, session_manager):
        """Test SessionManager initialization."""
        assert session_manager._sessions == {}
        assert session_manager._session_messages == {}
        assert session_manager._user_sessions == {}
        assert session_manager._cleanup_task is None
    
    async def test_create_session_without_user(self, session_manager):
        """Test creating a session without user ID."""
        session = await session_manager.create_session()
        
        assert session.session_id is not None
        assert session.user_id is None
        assert session.context == {}
        assert session.session_id in session_manager._sessions
        assert session.session_id in session_manager._session_messages
        assert session_manager._session_messages[session.session_id] == []
    
    async def test_create_session_with_user(self, session_manager):
        """Test creating a session with user ID."""
        user_id = "test-user-1"
        context = {"key": "value"}
        
        session = await session_manager.create_session(user_id=user_id, context=context)
        
        assert session.user_id == user_id
        assert session.context == context
        assert session.session_id in session_manager._sessions
        assert user_id in session_manager._user_sessions
        assert session.session_id in session_manager._user_sessions[user_id]
    
    async def test_get_session_exists(self, session_manager):
        """Test getting an existing session."""
        session = await session_manager.create_session()
        original_activity = session.last_activity
        
        # Wait a bit to ensure timestamp difference
        await asyncio.sleep(0.01)
        
        retrieved_session = await session_manager.get_session(session.session_id)
        
        assert retrieved_session is not None
        assert retrieved_session.session_id == session.session_id
        # Activity should be updated
        assert retrieved_session.last_activity > original_activity
    
    async def test_get_session_not_exists(self, session_manager):
        """Test getting a non-existent session."""
        result = await session_manager.get_session("non-existent-id")
        assert result is None
    
    async def test_update_session_activity(self, session_manager):
        """Test updating session activity."""
        session = await session_manager.create_session()
        original_activity = session.last_activity
        
        # Wait a bit to ensure timestamp difference
        await asyncio.sleep(0.01)
        
        result = await session_manager.update_session_activity(session.session_id)
        
        assert result is True
        assert session.last_activity > original_activity
    
    async def test_update_session_activity_not_exists(self, session_manager):
        """Test updating activity for non-existent session."""
        result = await session_manager.update_session_activity("non-existent-id")
        assert result is False
    
    async def test_add_session_context(self, session_manager):
        """Test adding context to a session."""
        session = await session_manager.create_session()
        
        result = await session_manager.add_session_context(session.session_id, "test_key", "test_value")
        
        assert result is True
        assert session.context["test_key"] == "test_value"
    
    async def test_add_session_context_not_exists(self, session_manager):
        """Test adding context to non-existent session."""
        result = await session_manager.add_session_context("non-existent-id", "key", "value")
        assert result is False
    
    async def test_get_session_context(self, session_manager):
        """Test getting context from a session."""
        session = await session_manager.create_session()
        session.context["test_key"] = "test_value"
        
        result = await session_manager.get_session_context(session.session_id, "test_key")
        assert result == "test_value"
        
        result = await session_manager.get_session_context(session.session_id, "missing_key", "default")
        assert result == "default"
    
    async def test_get_session_context_not_exists(self, session_manager):
        """Test getting context from non-existent session."""
        result = await session_manager.get_session_context("non-existent-id", "key", "default")
        assert result == "default"
    
    async def test_add_message_to_session(self, session_manager):
        """Test adding a message to a session."""
        session = await session_manager.create_session()
        message = ChatMessage.create_user_message(session.session_id, "Hello, world!")
        
        result = await session_manager.add_message_to_session(session.session_id, message)
        
        assert result is True
        assert len(session_manager._session_messages[session.session_id]) == 1
        assert session_manager._session_messages[session.session_id][0] == message
    
    async def test_add_message_to_session_not_exists(self, session_manager):
        """Test adding a message to non-existent session."""
        message = ChatMessage.create_user_message("non-existent-session", "Hello")
        
        result = await session_manager.add_message_to_session("non-existent-session", message)
        
        assert result is False
    
    async def test_add_message_wrong_session_id(self, session_manager):
        """Test adding a message with wrong session ID."""
        session = await session_manager.create_session()
        message = ChatMessage.create_user_message("different-session-id", "Hello")
        
        result = await session_manager.add_message_to_session(session.session_id, message)
        
        assert result is False
    
    async def test_add_message_history_limit(self, session_manager):
        """Test message history limit enforcement."""
        session = await session_manager.create_session()
        limit = session_manager.config.chat.conversation_history_limit
        
        # Add more messages than the limit
        for i in range(limit + 10):
            message = ChatMessage.create_user_message(session.session_id, f"Message {i}")
            await session_manager.add_message_to_session(session.session_id, message)
        
        messages = session_manager._session_messages[session.session_id]
        assert len(messages) == limit
        # Should keep the most recent messages
        assert messages[-1].content == f"Message {limit + 9}"
    
    async def test_get_session_messages(self, session_manager):
        """Test getting session messages."""
        session = await session_manager.create_session()
        
        # Add some messages
        messages = []
        for i in range(5):
            message = ChatMessage.create_user_message(session.session_id, f"Message {i}")
            messages.append(message)
            await session_manager.add_message_to_session(session.session_id, message)
        
        # Get all messages
        retrieved_messages = await session_manager.get_session_messages(session.session_id)
        assert len(retrieved_messages) == 5
        assert retrieved_messages == messages
        
        # Get limited messages
        limited_messages = await session_manager.get_session_messages(session.session_id, limit=3)
        assert len(limited_messages) == 3
        assert limited_messages == messages[-3:]  # Most recent 3
    
    async def test_get_session_messages_not_exists(self, session_manager):
        """Test getting messages from non-existent session."""
        messages = await session_manager.get_session_messages("non-existent-id")
        assert messages == []
    
    async def test_get_user_sessions(self, session_manager):
        """Test getting sessions for a user."""
        user_id = "test-user-1"
        
        # Create multiple sessions for the user
        session1 = await session_manager.create_session(user_id=user_id)
        await asyncio.sleep(0.01)  # Ensure different timestamps
        session2 = await session_manager.create_session(user_id=user_id)
        
        # Create session for different user
        await session_manager.create_session(user_id="other-user")
        
        user_sessions = await session_manager.get_user_sessions(user_id)
        
        assert len(user_sessions) == 2
        # Should be sorted by last activity (most recent first)
        assert user_sessions[0].session_id == session2.session_id
        assert user_sessions[1].session_id == session1.session_id
    
    async def test_get_user_sessions_not_exists(self, session_manager):
        """Test getting sessions for non-existent user."""
        sessions = await session_manager.get_user_sessions("non-existent-user")
        assert sessions == []
    
    async def test_close_session(self, session_manager):
        """Test closing a session."""
        user_id = "test-user-1"
        session = await session_manager.create_session(user_id=user_id)
        
        # Add a message
        message = ChatMessage.create_user_message(session.session_id, "Hello")
        await session_manager.add_message_to_session(session.session_id, message)
        
        result = await session_manager.close_session(session.session_id)
        
        assert result is True
        assert session.session_id not in session_manager._sessions
        assert session.session_id not in session_manager._session_messages
        assert session.session_id not in session_manager._user_sessions.get(user_id, set())
    
    async def test_close_session_not_exists(self, session_manager):
        """Test closing non-existent session."""
        result = await session_manager.close_session("non-existent-id")
        assert result is False
    
    async def test_close_user_sessions(self, session_manager):
        """Test closing all sessions for a user."""
        user_id = "test-user-1"
        
        # Create multiple sessions for the user
        session1 = await session_manager.create_session(user_id=user_id)
        session2 = await session_manager.create_session(user_id=user_id)
        
        # Create session for different user
        other_session = await session_manager.create_session(user_id="other-user")
        
        closed_count = await session_manager.close_user_sessions(user_id)
        
        assert closed_count == 2
        assert session1.session_id not in session_manager._sessions
        assert session2.session_id not in session_manager._sessions
        assert other_session.session_id in session_manager._sessions  # Should remain
        assert user_id not in session_manager._user_sessions
    
    async def test_cleanup_expired_sessions(self, session_manager):
        """Test cleaning up expired sessions."""
        # Create a session and manually set it as expired
        session = await session_manager.create_session()
        expired_time = datetime.now(timezone.utc) - timedelta(hours=2)
        session.last_activity = expired_time
        
        # Create a fresh session that should not be expired
        fresh_session = await session_manager.create_session()
        
        cleaned_count = await session_manager.cleanup_expired_sessions()
        
        assert cleaned_count == 1
        assert session.session_id not in session_manager._sessions
        assert fresh_session.session_id in session_manager._sessions
    
    async def test_get_session_stats(self, session_manager):
        """Test getting session statistics."""
        user_id = "test-user-1"
        
        # Create sessions and messages
        session1 = await session_manager.create_session(user_id=user_id)
        session2 = await session_manager.create_session()
        
        # Add messages
        for i in range(3):
            message = ChatMessage.create_user_message(session1.session_id, f"Message {i}")
            await session_manager.add_message_to_session(session1.session_id, message)
        
        stats = await session_manager.get_session_stats()
        
        assert stats["total_sessions"] == 2
        assert stats["active_sessions"] == 2
        assert stats["total_users"] == 1
        assert stats["total_messages"] == 3
        assert stats["average_session_duration_seconds"] >= 0
        assert stats["session_timeout_minutes"] == session_manager.config.security.session_timeout_minutes
    
    async def test_is_session_active(self, session_manager):
        """Test checking if session is active."""
        session = await session_manager.create_session()
        
        # Fresh session should be active
        assert await session_manager.is_session_active(session.session_id) is True
        
        # Expired session should not be active
        expired_time = datetime.now(timezone.utc) - timedelta(hours=2)
        session.last_activity = expired_time
        assert await session_manager.is_session_active(session.session_id) is False
        
        # Non-existent session should not be active
        assert await session_manager.is_session_active("non-existent-id") is False
    
    async def test_get_active_session_ids(self, session_manager):
        """Test getting active session IDs."""
        # Create active session
        active_session = await session_manager.create_session()
        
        # Create expired session
        expired_session = await session_manager.create_session()
        expired_time = datetime.now(timezone.utc) - timedelta(hours=2)
        expired_session.last_activity = expired_time
        
        active_ids = await session_manager.get_active_session_ids()
        
        assert len(active_ids) == 1
        assert active_session.session_id in active_ids
        assert expired_session.session_id not in active_ids
    
    async def test_start_stop(self, session_manager):
        """Test starting and stopping the session manager."""
        # Start the session manager
        await session_manager.start()
        assert session_manager._cleanup_task is not None
        assert not session_manager._cleanup_task.done()
        
        # Stop the session manager
        await session_manager.stop()
        assert session_manager._cleanup_task.done()
    
    async def test_cleanup_loop_runs(self, session_manager):
        """Test that cleanup loop runs periodically."""
        # Mock the cleanup method to track calls
        cleanup_calls = []
        original_cleanup = session_manager.cleanup_expired_sessions
        
        async def mock_cleanup():
            cleanup_calls.append(datetime.now())
            return await original_cleanup()
        
        session_manager.cleanup_expired_sessions = mock_cleanup
        
        # Start with very short cleanup interval for testing
        session_manager.config.chat.session_cleanup_interval_minutes = 0.01  # 0.6 seconds
        
        await session_manager.start()
        
        # Wait for a couple cleanup cycles
        await asyncio.sleep(1.5)
        
        await session_manager.stop()
        
        # Should have run cleanup at least once
        assert len(cleanup_calls) >= 1
    
    async def test_shutdown(self, session_manager):
        """Test complete shutdown of session manager."""
        # Create some sessions
        session1 = await session_manager.create_session()
        session2 = await session_manager.create_session()
        
        await session_manager.start()
        
        await session_manager.shutdown()
        
        # All sessions should be closed
        assert len(session_manager._sessions) == 0
        assert len(session_manager._session_messages) == 0
        assert len(session_manager._user_sessions) == 0
        
        # Cleanup task should be stopped
        assert session_manager._cleanup_task.done()