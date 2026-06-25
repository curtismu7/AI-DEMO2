"""
Chat session data models.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from enum import Enum
import uuid
import re


class MessageRole(Enum):
    """Roles for chat messages"""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


@dataclass
class ChatMessage:
    """Individual chat message with metadata"""
    id: str
    session_id: str
    content: str
    role: str
    timestamp: datetime
    metadata: Dict[str, Any]
    
    def __post_init__(self):
        """Validate chat message after initialization"""
        self.validate()
    
    def validate(self) -> None:
        """Validate chat message format and values"""
        if not self.id or not isinstance(self.id, str):
            raise ValueError("id must be a non-empty string")
        
        # Validate ID format (UUID or alphanumeric with hyphens)
        if not re.match(r'^[A-Za-z0-9\-_]+$', self.id):
            raise ValueError("id contains invalid characters")
        
        if not self.session_id or not isinstance(self.session_id, str):
            raise ValueError("session_id must be a non-empty string")
        
        # Validate session ID format
        if not re.match(r'^[A-Za-z0-9\-_]+$', self.session_id):
            raise ValueError("session_id contains invalid characters")
        
        if not isinstance(self.content, str):
            raise ValueError("content must be a string")
        
        if not self.role or not isinstance(self.role, str):
            raise ValueError("role must be a non-empty string")
        
        # Validate role
        valid_roles = [role.value for role in MessageRole]
        if self.role not in valid_roles:
            raise ValueError(f"role must be one of: {', '.join(valid_roles)}")
        
        if not isinstance(self.timestamp, datetime):
            raise ValueError("timestamp must be a datetime object")
        
        if not isinstance(self.metadata, dict):
            raise ValueError("metadata must be a dictionary")
    
    def is_user_message(self) -> bool:
        """Check if message is from user"""
        return self.role == MessageRole.USER.value
    
    def is_assistant_message(self) -> bool:
        """Check if message is from assistant"""
        return self.role == MessageRole.ASSISTANT.value
    
    def is_system_message(self) -> bool:
        """Check if message is a system message"""
        return self.role == MessageRole.SYSTEM.value
    
    def get_formatted_content(self) -> str:
        """Get formatted message content for display"""
        return self.content.strip()
    
    def add_metadata(self, key: str, value: Any) -> None:
        """Add metadata to the message"""
        if not isinstance(key, str) or not key.strip():
            raise ValueError("metadata key must be a non-empty string")
        self.metadata[key] = value
    
    @classmethod
    def create_user_message(cls, session_id: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> 'ChatMessage':
        """Create a user message"""
        return cls(
            id=str(uuid.uuid4()),
            session_id=session_id,
            content=content,
            role=MessageRole.USER.value,
            timestamp=datetime.now(timezone.utc),
            metadata=metadata or {}
        )
    
    @classmethod
    def create_assistant_message(cls, session_id: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> 'ChatMessage':
        """Create an assistant message"""
        return cls(
            id=str(uuid.uuid4()),
            session_id=session_id,
            content=content,
            role=MessageRole.ASSISTANT.value,
            timestamp=datetime.now(timezone.utc),
            metadata=metadata or {}
        )
    
    @classmethod
    def create_system_message(cls, session_id: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> 'ChatMessage':
        """Create a system message"""
        return cls(
            id=str(uuid.uuid4()),
            session_id=session_id,
            content=content,
            role=MessageRole.SYSTEM.value,
            timestamp=datetime.now(timezone.utc),
            metadata=metadata or {}
        )


@dataclass
class ChatSession:
    """Chat session with conversation context"""
    session_id: str
    user_id: Optional[str]
    created_at: datetime
    last_activity: datetime
    context: Dict[str, Any]
    
    def __post_init__(self):
        """Validate chat session after initialization"""
        self.validate()
    
    def validate(self) -> None:
        """Validate chat session format and values"""
        if not self.session_id or not isinstance(self.session_id, str):
            raise ValueError("session_id must be a non-empty string")
        
        # Validate session ID format
        if not re.match(r'^[A-Za-z0-9\-_]+$', self.session_id):
            raise ValueError("session_id contains invalid characters")
        
        if self.user_id is not None:
            if not isinstance(self.user_id, str) or not self.user_id.strip():
                raise ValueError("user_id must be a non-empty string or None")
            
            # Validate user ID format if provided
            if not re.match(r'^[A-Za-z0-9\-_]+$', self.user_id):
                raise ValueError("user_id contains invalid characters")
        
        if not isinstance(self.created_at, datetime):
            raise ValueError("created_at must be a datetime object")
        
        if not isinstance(self.last_activity, datetime):
            raise ValueError("last_activity must be a datetime object")
        
        if not isinstance(self.context, dict):
            raise ValueError("context must be a dictionary")
        
        # Validate that last_activity is not before created_at
        if self.last_activity < self.created_at:
            raise ValueError("last_activity cannot be before created_at")
    
    def update_activity(self) -> None:
        """Update last activity timestamp to now"""
        self.last_activity = datetime.now(timezone.utc)
    
    def is_active(self, timeout_minutes: int = 30) -> bool:
        """Check if session is still active based on timeout"""
        if timeout_minutes <= 0:
            raise ValueError("timeout_minutes must be positive")
        
        from datetime import timedelta
        timeout_threshold = datetime.now(timezone.utc) - timedelta(minutes=timeout_minutes)
        return self.last_activity >= timeout_threshold
    
    def get_session_duration(self) -> float:
        """Get session duration in seconds"""
        return (self.last_activity - self.created_at).total_seconds()
    
    def add_context(self, key: str, value: Any) -> None:
        """Add context information to the session"""
        if not isinstance(key, str) or not key.strip():
            raise ValueError("context key must be a non-empty string")
        self.context[key] = value
        self.update_activity()
    
    def get_context(self, key: str, default: Any = None) -> Any:
        """Get context value by key"""
        return self.context.get(key, default)
    
    def has_user(self) -> bool:
        """Check if session has an associated user"""
        return self.user_id is not None
    
    @classmethod
    def create_new_session(cls, user_id: Optional[str] = None, context: Optional[Dict[str, Any]] = None) -> 'ChatSession':
        """Create a new chat session"""
        now = datetime.now(timezone.utc)
        return cls(
            session_id=str(uuid.uuid4()),
            user_id=user_id,
            created_at=now,
            last_activity=now,
            context=context or {}
        )