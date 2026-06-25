"""Unit tests for chat session data models"""

import pytest
from datetime import datetime, timezone, timedelta
from src.models.chat import ChatMessage, ChatSession, MessageRole
import uuid


class TestChatMessage:
    """Test cases for ChatMessage dataclass"""
    
    def test_valid_chat_message(self):
        """Test creating valid chat message"""
        timestamp = datetime.now(timezone.utc)
        message = ChatMessage(
            id="msg_123",
            session_id="session_456",
            content="Hello, how can I help you?",
            role="assistant",
            timestamp=timestamp,
            metadata={"tool_used": "search"}
        )
        
        assert message.id == "msg_123"
        assert message.session_id == "session_456"
        assert message.content == "Hello, how can I help you?"
        assert message.role == "assistant"
        assert message.timestamp == timestamp
        assert message.metadata == {"tool_used": "search"}
        assert message.is_assistant_message()
        assert not message.is_user_message()
        assert not message.is_system_message()
    
    def test_chat_message_validation_empty_id(self):
        """Test validation fails for empty id"""
        timestamp = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="id must be a non-empty string"):
            ChatMessage(
                id="",
                session_id="session_456",
                content="Hello",
                role="user",
                timestamp=timestamp,
                metadata={}
            )
    
    def test_chat_message_validation_invalid_id_format(self):
        """Test validation fails for invalid id format"""
        timestamp = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="id contains invalid characters"):
            ChatMessage(
                id="invalid id with spaces!",
                session_id="session_456",
                content="Hello",
                role="user",
                timestamp=timestamp,
                metadata={}
            )
    
    def test_chat_message_validation_empty_session_id(self):
        """Test validation fails for empty session_id"""
        timestamp = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="session_id must be a non-empty string"):
            ChatMessage(
                id="msg_123",
                session_id="",
                content="Hello",
                role="user",
                timestamp=timestamp,
                metadata={}
            )
    
    def test_chat_message_validation_invalid_session_id_format(self):
        """Test validation fails for invalid session_id format"""
        timestamp = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="session_id contains invalid characters"):
            ChatMessage(
                id="msg_123",
                session_id="invalid session with spaces!",
                content="Hello",
                role="user",
                timestamp=timestamp,
                metadata={}
            )
    
    def test_chat_message_validation_invalid_content_type(self):
        """Test validation fails for non-string content"""
        timestamp = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="content must be a string"):
            ChatMessage(
                id="msg_123",
                session_id="session_456",
                content=123,
                role="user",
                timestamp=timestamp,
                metadata={}
            )
    
    def test_chat_message_validation_empty_role(self):
        """Test validation fails for empty role"""
        timestamp = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="role must be a non-empty string"):
            ChatMessage(
                id="msg_123",
                session_id="session_456",
                content="Hello",
                role="",
                timestamp=timestamp,
                metadata={}
            )
    
    def test_chat_message_validation_invalid_role(self):
        """Test validation fails for invalid role"""
        timestamp = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="role must be one of"):
            ChatMessage(
                id="msg_123",
                session_id="session_456",
                content="Hello",
                role="invalid_role",
                timestamp=timestamp,
                metadata={}
            )
    
    def test_chat_message_validation_invalid_timestamp(self):
        """Test validation fails for invalid timestamp"""
        with pytest.raises(ValueError, match="timestamp must be a datetime object"):
            ChatMessage(
                id="msg_123",
                session_id="session_456",
                content="Hello",
                role="user",
                timestamp="not_a_datetime",
                metadata={}
            )
    
    def test_chat_message_validation_invalid_metadata_type(self):
        """Test validation fails for non-dict metadata"""
        timestamp = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="metadata must be a dictionary"):
            ChatMessage(
                id="msg_123",
                session_id="session_456",
                content="Hello",
                role="user",
                timestamp=timestamp,
                metadata="not_a_dict"
            )
    
    def test_chat_message_role_checks(self):
        """Test role checking methods"""
        timestamp = datetime.now(timezone.utc)
        
        # User message
        user_msg = ChatMessage(
            id="msg_1", session_id="session_1", content="Hello",
            role="user", timestamp=timestamp, metadata={}
        )
        assert user_msg.is_user_message()
        assert not user_msg.is_assistant_message()
        assert not user_msg.is_system_message()
        
        # Assistant message
        assistant_msg = ChatMessage(
            id="msg_2", session_id="session_1", content="Hi there!",
            role="assistant", timestamp=timestamp, metadata={}
        )
        assert not assistant_msg.is_user_message()
        assert assistant_msg.is_assistant_message()
        assert not assistant_msg.is_system_message()
        
        # System message
        system_msg = ChatMessage(
            id="msg_3", session_id="session_1", content="System notification",
            role="system", timestamp=timestamp, metadata={}
        )
        assert not system_msg.is_user_message()
        assert not system_msg.is_assistant_message()
        assert system_msg.is_system_message()
    
    def test_chat_message_get_formatted_content(self):
        """Test formatted content method"""
        timestamp = datetime.now(timezone.utc)
        message = ChatMessage(
            id="msg_123", session_id="session_456",
            content="  Hello, world!  ", role="user",
            timestamp=timestamp, metadata={}
        )
        
        assert message.get_formatted_content() == "Hello, world!"
    
    def test_chat_message_add_metadata(self):
        """Test adding metadata to message"""
        timestamp = datetime.now(timezone.utc)
        message = ChatMessage(
            id="msg_123", session_id="session_456",
            content="Hello", role="user",
            timestamp=timestamp, metadata={}
        )
        
        message.add_metadata("tool", "search")
        assert message.metadata["tool"] == "search"
        
        # Test invalid key
        with pytest.raises(ValueError, match="metadata key must be a non-empty string"):
            message.add_metadata("", "value")
    
    def test_chat_message_create_user_message(self):
        """Test creating user message using class method"""
        message = ChatMessage.create_user_message(
            session_id="session_123",
            content="Hello, assistant!",
            metadata={"source": "web"}
        )
        
        assert message.session_id == "session_123"
        assert message.content == "Hello, assistant!"
        assert message.role == "user"
        assert message.metadata == {"source": "web"}
        assert message.is_user_message()
        assert isinstance(message.timestamp, datetime)
        assert len(message.id) > 0
    
    def test_chat_message_create_assistant_message(self):
        """Test creating assistant message using class method"""
        message = ChatMessage.create_assistant_message(
            session_id="session_123",
            content="Hello, user!",
            metadata={"model": "gpt-4"}
        )
        
        assert message.session_id == "session_123"
        assert message.content == "Hello, user!"
        assert message.role == "assistant"
        assert message.metadata == {"model": "gpt-4"}
        assert message.is_assistant_message()
    
    def test_chat_message_create_system_message(self):
        """Test creating system message using class method"""
        message = ChatMessage.create_system_message(
            session_id="session_123",
            content="System initialized",
            metadata={"event": "startup"}
        )
        
        assert message.session_id == "session_123"
        assert message.content == "System initialized"
        assert message.role == "system"
        assert message.metadata == {"event": "startup"}
        assert message.is_system_message()


class TestChatSession:
    """Test cases for ChatSession dataclass"""
    
    def test_valid_chat_session(self):
        """Test creating valid chat session"""
        created_at = datetime.now(timezone.utc)
        last_activity = created_at + timedelta(minutes=5)
        
        session = ChatSession(
            session_id="session_123",
            user_id="user_456",
            created_at=created_at,
            last_activity=last_activity,
            context={"language": "en", "theme": "dark"}
        )
        
        assert session.session_id == "session_123"
        assert session.user_id == "user_456"
        assert session.created_at == created_at
        assert session.last_activity == last_activity
        assert session.context == {"language": "en", "theme": "dark"}
        assert session.has_user()
    
    def test_chat_session_validation_empty_session_id(self):
        """Test validation fails for empty session_id"""
        now = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="session_id must be a non-empty string"):
            ChatSession(
                session_id="",
                user_id="user_456",
                created_at=now,
                last_activity=now,
                context={}
            )
    
    def test_chat_session_validation_invalid_session_id_format(self):
        """Test validation fails for invalid session_id format"""
        now = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="session_id contains invalid characters"):
            ChatSession(
                session_id="invalid session with spaces!",
                user_id="user_456",
                created_at=now,
                last_activity=now,
                context={}
            )
    
    def test_chat_session_validation_empty_user_id(self):
        """Test validation fails for empty user_id when not None"""
        now = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="user_id must be a non-empty string or None"):
            ChatSession(
                session_id="session_123",
                user_id="",
                created_at=now,
                last_activity=now,
                context={}
            )
    
    def test_chat_session_validation_invalid_user_id_format(self):
        """Test validation fails for invalid user_id format"""
        now = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="user_id contains invalid characters"):
            ChatSession(
                session_id="session_123",
                user_id="invalid user with spaces!",
                created_at=now,
                last_activity=now,
                context={}
            )
    
    def test_chat_session_validation_invalid_created_at(self):
        """Test validation fails for invalid created_at"""
        now = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="created_at must be a datetime object"):
            ChatSession(
                session_id="session_123",
                user_id="user_456",
                created_at="not_a_datetime",
                last_activity=now,
                context={}
            )
    
    def test_chat_session_validation_invalid_last_activity(self):
        """Test validation fails for invalid last_activity"""
        now = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="last_activity must be a datetime object"):
            ChatSession(
                session_id="session_123",
                user_id="user_456",
                created_at=now,
                last_activity="not_a_datetime",
                context={}
            )
    
    def test_chat_session_validation_invalid_context_type(self):
        """Test validation fails for non-dict context"""
        now = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="context must be a dictionary"):
            ChatSession(
                session_id="session_123",
                user_id="user_456",
                created_at=now,
                last_activity=now,
                context="not_a_dict"
            )
    
    def test_chat_session_validation_last_activity_before_created(self):
        """Test validation fails when last_activity is before created_at"""
        created_at = datetime.now(timezone.utc)
        last_activity = created_at - timedelta(minutes=5)
        
        with pytest.raises(ValueError, match="last_activity cannot be before created_at"):
            ChatSession(
                session_id="session_123",
                user_id="user_456",
                created_at=created_at,
                last_activity=last_activity,
                context={}
            )
    
    def test_chat_session_with_none_user_id(self):
        """Test chat session with None user_id"""
        now = datetime.now(timezone.utc)
        session = ChatSession(
            session_id="session_123",
            user_id=None,
            created_at=now,
            last_activity=now,
            context={}
        )
        
        assert session.user_id is None
        assert not session.has_user()
    
    def test_chat_session_update_activity(self):
        """Test updating session activity"""
        created_at = datetime.now(timezone.utc) - timedelta(minutes=10)
        old_activity = created_at + timedelta(minutes=5)
        
        session = ChatSession(
            session_id="session_123",
            user_id="user_456",
            created_at=created_at,
            last_activity=old_activity,
            context={}
        )
        
        session.update_activity()
        assert session.last_activity > old_activity
    
    def test_chat_session_is_active(self):
        """Test session activity check"""
        created_at = datetime.now(timezone.utc) - timedelta(minutes=60)
        
        # Active session (within timeout)
        recent_activity = datetime.now(timezone.utc) - timedelta(minutes=10)
        active_session = ChatSession(
            session_id="session_1",
            user_id="user_1",
            created_at=created_at,
            last_activity=recent_activity,
            context={}
        )
        assert active_session.is_active(timeout_minutes=30)
        
        # Inactive session (beyond timeout)
        old_activity = datetime.now(timezone.utc) - timedelta(minutes=45)
        inactive_session = ChatSession(
            session_id="session_2",
            user_id="user_2",
            created_at=created_at,
            last_activity=old_activity,
            context={}
        )
        assert not inactive_session.is_active(timeout_minutes=30)
        
        # Test invalid timeout
        with pytest.raises(ValueError, match="timeout_minutes must be positive"):
            active_session.is_active(timeout_minutes=0)
    
    def test_chat_session_get_session_duration(self):
        """Test getting session duration"""
        created_at = datetime.now(timezone.utc) - timedelta(minutes=30)
        last_activity = created_at + timedelta(minutes=25)
        
        session = ChatSession(
            session_id="session_123",
            user_id="user_456",
            created_at=created_at,
            last_activity=last_activity,
            context={}
        )
        
        duration = session.get_session_duration()
        assert duration == 25 * 60  # 25 minutes in seconds
    
    def test_chat_session_add_context(self):
        """Test adding context to session"""
        now = datetime.now(timezone.utc)
        session = ChatSession(
            session_id="session_123",
            user_id="user_456",
            created_at=now,
            last_activity=now,
            context={}
        )
        
        old_activity = session.last_activity
        session.add_context("language", "en")
        
        assert session.context["language"] == "en"
        assert session.last_activity > old_activity
        
        # Test invalid key
        with pytest.raises(ValueError, match="context key must be a non-empty string"):
            session.add_context("", "value")
    
    def test_chat_session_get_context(self):
        """Test getting context from session"""
        session = ChatSession(
            session_id="session_123",
            user_id="user_456",
            created_at=datetime.now(timezone.utc),
            last_activity=datetime.now(timezone.utc),
            context={"language": "en", "theme": "dark"}
        )
        
        assert session.get_context("language") == "en"
        assert session.get_context("theme") == "dark"
        assert session.get_context("nonexistent") is None
        assert session.get_context("nonexistent", "default") == "default"
    
    def test_chat_session_create_new_session(self):
        """Test creating new session using class method"""
        session = ChatSession.create_new_session(
            user_id="user_123",
            context={"language": "en"}
        )
        
        assert session.user_id == "user_123"
        assert session.context == {"language": "en"}
        assert session.has_user()
        assert isinstance(session.created_at, datetime)
        assert isinstance(session.last_activity, datetime)
        assert session.created_at == session.last_activity
        assert len(session.session_id) > 0
        
        # Test without user_id
        anonymous_session = ChatSession.create_new_session()
        assert anonymous_session.user_id is None
        assert not anonymous_session.has_user()
        assert anonymous_session.context == {}