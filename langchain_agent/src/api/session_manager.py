"""
Session management for user chat sessions.
"""
import asyncio
import logging
from typing import Dict, Any, Optional, List, Set
from datetime import datetime, timezone, timedelta
import uuid

from models.chat import ChatSession, ChatMessage
from config.settings import get_config


logger = logging.getLogger(__name__)


class SessionManager:
    """
    Manages user session lifecycle including creation, cleanup, and timeout handling.
    
    Handles session state, timeout management, and cleanup operations for chat sessions.
    """
    
    def __init__(self, config=None):
        """
        Initialize the session manager.
        
        Args:
            config: Optional configuration object
        """
        self.config = config or get_config()
        
        # Active sessions: session_id -> ChatSession
        self._sessions: Dict[str, ChatSession] = {}
        
        # Session messages: session_id -> List[ChatMessage]
        self._session_messages: Dict[str, List[ChatMessage]] = {}
        
        # User to sessions mapping: user_id -> Set[session_id]
        self._user_sessions: Dict[str, Set[str]] = {}
        
        # Session cleanup task
        self._cleanup_task: Optional[asyncio.Task] = None
        self._shutdown_event = asyncio.Event()
        
        logger.info("Initialized SessionManager")
    
    async def start(self) -> None:
        """Start the session manager and background cleanup task."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            logger.info("Started session cleanup task")
    
    async def stop(self) -> None:
        """Stop the session manager and cleanup task."""
        self._shutdown_event.set()
        
        if self._cleanup_task and not self._cleanup_task.done():
            try:
                await asyncio.wait_for(self._cleanup_task, timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning("Session cleanup task did not stop gracefully")
                self._cleanup_task.cancel()
                # Await the cancelled task so it is fully torn down before
                # stop() returns (no orphaned task / unretrieved exception).
                try:
                    await self._cleanup_task
                except asyncio.CancelledError:
                    pass

        logger.info("Stopped SessionManager")
    
    async def create_session(self, user_id: Optional[str] = None, context: Optional[Dict[str, Any]] = None, session_id: Optional[str] = None) -> ChatSession:
        """
        Create a new chat session.
        
        Args:
            user_id: Optional user ID to associate with the session
            context: Optional initial context data
            session_id: Optional specific session ID to use
            
        Returns:
            ChatSession: The created session
        """
        if session_id:
            # Create session with specific ID
            now = datetime.now(timezone.utc)
            session = ChatSession(
                session_id=session_id,
                user_id=user_id,
                created_at=now,
                last_activity=now,
                context=context or {}
            )
        else:
            # Create session with generated ID
            session = ChatSession.create_new_session(user_id=user_id, context=context or {})
        
        # Store session
        self._sessions[session.session_id] = session
        self._session_messages[session.session_id] = []
        
        # Update user mapping if user_id provided
        if user_id:
            if user_id not in self._user_sessions:
                self._user_sessions[user_id] = set()
            self._user_sessions[user_id].add(session.session_id)
        
        logger.info(f"Created session {session.session_id} for user {user_id}")
        return session
    
    async def get_session(self, session_id: str) -> Optional[ChatSession]:
        """
        Get a session by ID.
        
        Args:
            session_id: The session ID
            
        Returns:
            ChatSession or None if not found
        """
        session = self._sessions.get(session_id)
        if session:
            # Update activity timestamp
            session.update_activity()
        return session
    
    async def update_session_activity(self, session_id: str) -> bool:
        """
        Update the last activity timestamp for a session.
        
        Args:
            session_id: The session ID
            
        Returns:
            bool: True if session was found and updated
        """
        session = self._sessions.get(session_id)
        if session:
            session.update_activity()
            logger.debug(f"Updated activity for session {session_id}")
            return True
        return False
    
    async def add_session_context(self, session_id: str, key: str, value: Any) -> bool:
        """
        Add context data to a session.
        
        Args:
            session_id: The session ID
            key: The context key
            value: The context value
            
        Returns:
            bool: True if session was found and context was added
        """
        session = self._sessions.get(session_id)
        if session:
            session.add_context(key, value)
            logger.debug(f"Added context {key} to session {session_id}")
            return True
        return False
    
    async def get_session_context(self, session_id: str, key: str, default: Any = None) -> Any:
        """
        Get context data from a session.
        
        Args:
            session_id: The session ID
            key: The context key
            default: Default value if key not found
            
        Returns:
            The context value or default
        """
        session = self._sessions.get(session_id)
        if session:
            return session.get_context(key, default)
        return default
    
    async def add_message_to_session(self, session_id: str, message: ChatMessage) -> bool:
        """
        Add a message to a session's message history.
        
        Args:
            session_id: The session ID
            message: The chat message to add
            
        Returns:
            bool: True if message was added successfully
        """
        if session_id not in self._sessions:
            logger.warning(f"Attempted to add message to non-existent session {session_id}")
            return False
        
        # Validate message belongs to this session
        if message.session_id != session_id:
            logger.error(f"Message session ID {message.session_id} does not match target session {session_id}")
            return False
        
        # Add message to session history
        if session_id not in self._session_messages:
            self._session_messages[session_id] = []
        
        self._session_messages[session_id].append(message)
        
        # Limit message history
        max_messages = self.config.chat.conversation_history_limit
        if len(self._session_messages[session_id]) > max_messages:
            # Remove oldest messages
            self._session_messages[session_id] = self._session_messages[session_id][-max_messages:]
            logger.debug(f"Trimmed message history for session {session_id} to {max_messages} messages")
        
        # Update session activity
        await self.update_session_activity(session_id)
        
        logger.debug(f"Added message {message.id} to session {session_id}")
        return True
    
    async def get_session_messages(self, session_id: str, limit: Optional[int] = None) -> List[ChatMessage]:
        """
        Get messages for a session.
        
        Args:
            session_id: The session ID
            limit: Optional limit on number of messages to return (most recent)
            
        Returns:
            List of chat messages
        """
        messages = self._session_messages.get(session_id, [])
        
        if limit and limit > 0:
            messages = messages[-limit:]
        
        return messages.copy()
    
    async def get_user_sessions(self, user_id: str) -> List[ChatSession]:
        """
        Get all active sessions for a user.
        
        Args:
            user_id: The user ID
            
        Returns:
            List of active chat sessions for the user
        """
        session_ids = self._user_sessions.get(user_id, set())
        sessions = []
        
        for session_id in session_ids:
            session = self._sessions.get(session_id)
            if session:
                sessions.append(session)
        
        # Sort by last activity (most recent first)
        sessions.sort(key=lambda s: s.last_activity, reverse=True)
        return sessions
    
    async def close_session(self, session_id: str) -> bool:
        """
        Close a session and clean up its data.
        
        Args:
            session_id: The session ID to close
            
        Returns:
            bool: True if session was found and closed
        """
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        # Remove from user mapping
        if session.user_id and session.user_id in self._user_sessions:
            self._user_sessions[session.user_id].discard(session_id)
            if not self._user_sessions[session.user_id]:
                del self._user_sessions[session.user_id]
        
        # Remove session and messages
        del self._sessions[session_id]
        if session_id in self._session_messages:
            del self._session_messages[session_id]
        
        logger.info(f"Closed session {session_id}")
        return True
    
    async def close_user_sessions(self, user_id: str) -> int:
        """
        Close all sessions for a user.
        
        Args:
            user_id: The user ID
            
        Returns:
            int: Number of sessions closed
        """
        session_ids = self._user_sessions.get(user_id, set()).copy()
        closed_count = 0
        
        for session_id in session_ids:
            if await self.close_session(session_id):
                closed_count += 1
        
        logger.info(f"Closed {closed_count} sessions for user {user_id}")
        return closed_count
    
    async def cleanup_expired_sessions(self) -> int:
        """
        Clean up expired sessions based on timeout configuration.
        
        Returns:
            int: Number of sessions cleaned up
        """
        timeout_minutes = self.config.security.session_timeout_minutes
        expired_sessions = []
        
        for session_id, session in self._sessions.items():
            if not session.is_active(timeout_minutes):
                expired_sessions.append(session_id)
        
        # Close expired sessions
        closed_count = 0
        for session_id in expired_sessions:
            if await self.close_session(session_id):
                closed_count += 1
        
        if closed_count > 0:
            logger.info(f"Cleaned up {closed_count} expired sessions")
        
        return closed_count
    
    async def get_session_stats(self) -> Dict[str, Any]:
        """
        Get statistics about active sessions.
        
        Returns:
            Dict containing session statistics
        """
        total_sessions = len(self._sessions)
        total_users = len(self._user_sessions)
        total_messages = sum(len(messages) for messages in self._session_messages.values())
        
        # Calculate session durations
        durations = [session.get_session_duration() for session in self._sessions.values()]
        avg_duration = sum(durations) / len(durations) if durations else 0
        
        # Count active sessions (within timeout)
        timeout_minutes = self.config.security.session_timeout_minutes
        active_sessions = sum(1 for session in self._sessions.values() 
                            if session.is_active(timeout_minutes))
        
        return {
            "total_sessions": total_sessions,
            "active_sessions": active_sessions,
            "total_users": total_users,
            "total_messages": total_messages,
            "average_session_duration_seconds": avg_duration,
            "session_timeout_minutes": timeout_minutes
        }
    
    async def is_session_active(self, session_id: str) -> bool:
        """
        Check if a session is active (exists and not expired).
        
        Args:
            session_id: The session ID
            
        Returns:
            bool: True if session is active
        """
        session = self._sessions.get(session_id)
        if not session:
            return False
        
        return session.is_active(self.config.security.session_timeout_minutes)
    
    async def get_active_session_ids(self) -> List[str]:
        """
        Get list of all active session IDs.
        
        Returns:
            List of active session IDs
        """
        timeout_minutes = self.config.security.session_timeout_minutes
        active_ids = []
        
        for session_id, session in self._sessions.items():
            if session.is_active(timeout_minutes):
                active_ids.append(session_id)
        
        return active_ids
    
    async def _cleanup_loop(self) -> None:
        """Background task for periodic session cleanup."""
        cleanup_interval = timedelta(minutes=self.config.chat.session_cleanup_interval_minutes)
        
        logger.info(f"Started session cleanup loop with {cleanup_interval.total_seconds()}s interval")
        
        while not self._shutdown_event.is_set():
            try:
                # Wait for cleanup interval or shutdown
                await asyncio.wait_for(
                    self._shutdown_event.wait(), 
                    timeout=cleanup_interval.total_seconds()
                )
                # If we get here, shutdown was requested
                break
            except asyncio.TimeoutError:
                # Timeout is expected - time to run cleanup
                pass
            
            try:
                await self.cleanup_expired_sessions()
            except Exception as e:
                logger.error(f"Error during session cleanup: {e}")
        
        logger.info("Session cleanup loop stopped")
    
    async def shutdown(self) -> None:
        """Shutdown the session manager and clean up all sessions."""
        await self.stop()
        
        # Close all sessions
        session_ids = list(self._sessions.keys())
        for session_id in session_ids:
            await self.close_session(session_id)
        
        logger.info("SessionManager shutdown complete")