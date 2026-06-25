"""
MCP authentication challenge handler for OAuth flows.
"""
import logging
from typing import Dict, Any, Optional, Callable, Awaitable
from dataclasses import dataclass
from datetime import datetime, timedelta
import asyncio
import uuid

from models.mcp import AuthChallenge, ChallengeType
from models.auth import AuthorizationCode


logger = logging.getLogger(__name__)


@dataclass
class AuthRequest:
    """Authentication request for user authorization"""
    challenge_id: str
    authorization_url: str
    scope: str
    state: str
    session_id: str
    server_name: str
    tool_name: str
    expires_at: datetime
    
    def __post_init__(self):
        """Validate auth request after initialization"""
        if not self.challenge_id or not isinstance(self.challenge_id, str):
            raise ValueError("challenge_id must be a non-empty string")
        
        if not self.authorization_url or not isinstance(self.authorization_url, str):
            raise ValueError("authorization_url must be a non-empty string")
        
        if not self.scope or not isinstance(self.scope, str):
            raise ValueError("scope must be a non-empty string")
        
        if not self.state or not isinstance(self.state, str):
            raise ValueError("state must be a non-empty string")
        
        if not self.session_id or not isinstance(self.session_id, str):
            raise ValueError("session_id must be a non-empty string")
        
        if not self.server_name or not isinstance(self.server_name, str):
            raise ValueError("server_name must be a non-empty string")
        
        if not self.tool_name or not isinstance(self.tool_name, str):
            raise ValueError("tool_name must be a non-empty string")
        
        if not isinstance(self.expires_at, datetime):
            raise ValueError("expires_at must be a datetime object")
    
    def is_expired(self) -> bool:
        """Check if auth request is expired"""
        from datetime import timezone
        return datetime.now(timezone.utc) >= self.expires_at
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert auth request to dictionary"""
        return {
            "challenge_id": self.challenge_id,
            "authorization_url": self.authorization_url,
            "scope": self.scope,
            "state": self.state,
            "session_id": self.session_id,
            "server_name": self.server_name,
            "tool_name": self.tool_name,
            "expires_at": self.expires_at.isoformat()
        }


@dataclass
class AuthResponse:
    """Authentication response from user"""
    challenge_id: str
    authorization_code: Optional[str] = None
    error: Optional[str] = None
    state: Optional[str] = None
    
    def __post_init__(self):
        """Validate auth response after initialization"""
        if not self.challenge_id or not isinstance(self.challenge_id, str):
            raise ValueError("challenge_id must be a non-empty string")
        
        if not self.authorization_code and not self.error:
            raise ValueError("Either authorization_code or error must be provided")
        
        if self.authorization_code and self.error:
            raise ValueError("Cannot have both authorization_code and error")
    
    def is_success(self) -> bool:
        """Check if auth response is successful"""
        return self.authorization_code is not None and self.error is None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert auth response to dictionary"""
        return {
            "challenge_id": self.challenge_id,
            "authorization_code": self.authorization_code,
            "error": self.error,
            "state": self.state
        }


# Type alias for auth request callback
AuthRequestCallback = Callable[[AuthRequest], Awaitable[None]]


class AuthenticationHandler:
    """Handler for OAuth authentication challenges from MCP servers"""
    
    def __init__(self, auth_request_callback: Optional[AuthRequestCallback] = None):
        self.auth_request_callback = auth_request_callback
        self._pending_challenges: Dict[str, AuthRequest] = {}  # challenge_id -> AuthRequest
        self._challenge_futures: Dict[str, asyncio.Future] = {}  # challenge_id -> Future[AuthResponse]
        self._handler_lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None
        
        logger.info("Initialized MCP authentication handler")
    
    async def handle_auth_challenge(self, challenge: AuthChallenge, session_id: str,
                                  server_name: str, tool_name: str,
                                  timeout_seconds: int = 300) -> AuthResponse:
        """Handle an OAuth authentication challenge from an MCP server"""
        
        if not isinstance(challenge, AuthChallenge):
            raise ValueError("challenge must be an AuthChallenge instance")
        
        if not session_id or not isinstance(session_id, str):
            raise ValueError("session_id must be a non-empty string")
        
        if not server_name or not isinstance(server_name, str):
            raise ValueError("server_name must be a non-empty string")
        
        if not tool_name or not isinstance(tool_name, str):
            raise ValueError("tool_name must be a non-empty string")
        
        # Validate challenge type
        if not challenge.is_oauth_authorization_code():
            raise ValueError(f"Unsupported challenge type: {challenge.challenge_type}")
        
        logger.info(f"Handling auth challenge for {server_name}.{tool_name} in session {session_id}")

        async with self._handler_lock:
            # Start cleanup task if not already running. Check-then-act under
            # the lock so only one cleanup loop can ever be spawned.
            if self._cleanup_task is None:
                self._cleanup_task = asyncio.create_task(self._cleanup_expired_challenges())

            # Generate unique challenge ID
            challenge_id = str(uuid.uuid4())
            
            # Create auth request
            from datetime import timezone
            auth_request = AuthRequest(
                challenge_id=challenge_id,
                authorization_url=challenge.authorization_url,
                scope=challenge.scope,
                state=challenge.state,
                session_id=session_id,
                server_name=server_name,
                tool_name=tool_name,
                expires_at=datetime.now(timezone.utc) + timedelta(seconds=timeout_seconds)
            )
            
            # Store pending challenge
            self._pending_challenges[challenge_id] = auth_request
            
            # Create future for response
            response_future = asyncio.Future()
            self._challenge_futures[challenge_id] = response_future
        
        try:
            # Notify callback about auth request
            if self.auth_request_callback:
                await self.auth_request_callback(auth_request)
            else:
                logger.warning(f"No auth request callback configured for challenge {challenge_id}")
            
            # Wait for response with timeout
            try:
                auth_response = await asyncio.wait_for(response_future, timeout=timeout_seconds)
                logger.info(f"Received auth response for challenge {challenge_id}")
                return auth_response
                
            except asyncio.TimeoutError:
                logger.warning(f"Auth challenge {challenge_id} timed out")
                return AuthResponse(
                    challenge_id=challenge_id,
                    error="Authentication request timed out"
                )
        
        finally:
            # Clean up
            async with self._handler_lock:
                self._pending_challenges.pop(challenge_id, None)
                self._challenge_futures.pop(challenge_id, None)
    
    async def provide_auth_response(self, challenge_id: str, authorization_code: Optional[str] = None,
                                  error: Optional[str] = None, state: Optional[str] = None) -> bool:
        """Provide authentication response for a pending challenge"""
        
        if not challenge_id or not isinstance(challenge_id, str):
            raise ValueError("challenge_id must be a non-empty string")
        
        async with self._handler_lock:
            if challenge_id not in self._challenge_futures:
                logger.warning(f"No pending challenge found for ID: {challenge_id}")
                return False
            
            future = self._challenge_futures[challenge_id]
            
            if future.done():
                logger.warning(f"Challenge {challenge_id} already completed")
                return False
            
            # Create response
            try:
                auth_response = AuthResponse(
                    challenge_id=challenge_id,
                    authorization_code=authorization_code,
                    error=error,
                    state=state
                )
                
                # Set future result
                future.set_result(auth_response)
                logger.info(f"Provided auth response for challenge {challenge_id}")
                return True
                
            except Exception as e:
                logger.error(f"Error creating auth response for challenge {challenge_id}: {e}")
                future.set_exception(e)
                return False
    
    async def get_pending_challenges(self, session_id: Optional[str] = None) -> Dict[str, AuthRequest]:
        """Get pending authentication challenges, optionally filtered by session"""
        
        async with self._handler_lock:
            if session_id:
                return {
                    challenge_id: auth_request
                    for challenge_id, auth_request in self._pending_challenges.items()
                    if auth_request.session_id == session_id and not auth_request.is_expired()
                }
            else:
                return {
                    challenge_id: auth_request
                    for challenge_id, auth_request in self._pending_challenges.items()
                    if not auth_request.is_expired()
                }
    
    async def cancel_challenge(self, challenge_id: str, reason: str = "Cancelled by user") -> bool:
        """Cancel a pending authentication challenge"""
        
        if not challenge_id or not isinstance(challenge_id, str):
            raise ValueError("challenge_id must be a non-empty string")
        
        async with self._handler_lock:
            if challenge_id not in self._challenge_futures:
                return False
            
            future = self._challenge_futures[challenge_id]
            
            if future.done():
                return False
            
            # Cancel with error response
            auth_response = AuthResponse(
                challenge_id=challenge_id,
                error=reason
            )
            
            future.set_result(auth_response)
            logger.info(f"Cancelled auth challenge {challenge_id}: {reason}")
            return True
    
    async def generate_authorization_url(self, challenge: AuthChallenge, 
                                       redirect_uri: Optional[str] = None) -> str:
        """Generate authorization URL with optional redirect URI"""
        
        if not isinstance(challenge, AuthChallenge):
            raise ValueError("challenge must be an AuthChallenge instance")
        
        base_url = challenge.authorization_url
        
        # Add redirect URI if provided
        if redirect_uri:
            separator = "&" if "?" in base_url else "?"
            base_url += f"{separator}redirect_uri={redirect_uri}"
        
        return base_url
    
    async def create_authorization_code(self, challenge_id: str, code: str, 
                                      session_id: str) -> AuthorizationCode:
        """Create AuthorizationCode object from challenge response"""
        
        async with self._handler_lock:
            auth_request = self._pending_challenges.get(challenge_id)
            
            if not auth_request:
                raise ValueError(f"No pending challenge found for ID: {challenge_id}")
            
            if auth_request.session_id != session_id:
                raise ValueError("Session ID mismatch")
            
            if auth_request.is_expired():
                raise ValueError("Auth request has expired")
            
            # Create authorization code with expiration
            from datetime import timezone
            return AuthorizationCode(
                code=code,
                state=auth_request.state,
                session_id=session_id,
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=10)  # Standard expiration
            )
    
    async def get_handler_stats(self) -> Dict[str, Any]:
        """Get statistics about the authentication handler"""
        async with self._handler_lock:
            active_challenges = len(self._pending_challenges)
            expired_challenges = sum(
                1 for auth_request in self._pending_challenges.values()
                if auth_request.is_expired()
            )
            
            return {
                "active_challenges": active_challenges,
                "expired_challenges": expired_challenges,
                "total_futures": len(self._challenge_futures),
                "has_callback": self.auth_request_callback is not None
            }
    
    async def _cleanup_expired_challenges(self) -> None:
        """Background task to clean up expired challenges"""
        while True:
            try:
                await asyncio.sleep(60)  # Check every minute
                
                async with self._handler_lock:
                    expired_ids = [
                        challenge_id for challenge_id, auth_request in self._pending_challenges.items()
                        if auth_request.is_expired()
                    ]
                    
                    for challenge_id in expired_ids:
                        # Cancel expired challenges
                        if challenge_id in self._challenge_futures:
                            future = self._challenge_futures[challenge_id]
                            if not future.done():
                                auth_response = AuthResponse(
                                    challenge_id=challenge_id,
                                    error="Authentication request expired"
                                )
                                future.set_result(auth_response)
                        
                        # Remove from tracking
                        self._pending_challenges.pop(challenge_id, None)
                        self._challenge_futures.pop(challenge_id, None)
                    
                    if expired_ids:
                        logger.info(f"Cleaned up {len(expired_ids)} expired auth challenges")
            
            except Exception as e:
                logger.error(f"Error in auth challenge cleanup: {e}")
    
    async def shutdown(self) -> None:
        """Shutdown the authentication handler"""
        # Cancel cleanup task
        if self._cleanup_task is not None:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None
        
        # Cancel all pending challenges
        async with self._handler_lock:
            for challenge_id, future in self._challenge_futures.items():
                if not future.done():
                    auth_response = AuthResponse(
                        challenge_id=challenge_id,
                        error="Authentication handler shutting down"
                    )
                    future.set_result(auth_response)
            
            self._pending_challenges.clear()
            self._challenge_futures.clear()
        
        logger.info("Authentication handler shutdown complete")


class AuthChallengeDetector:
    """Utility class for detecting authentication challenges in MCP responses"""
    
    @staticmethod
    def is_auth_challenge(response: Dict[str, Any]) -> bool:
        """Check if a response contains an authentication challenge"""
        return (
            isinstance(response, dict) and
            response.get("type") == "auth_challenge" and
            "challenge_type" in response and
            "authorization_url" in response and
            "scope" in response and
            "state" in response
        )
    
    @staticmethod
    def extract_auth_challenge(response: Dict[str, Any]) -> AuthChallenge:
        """Extract AuthChallenge from MCP response"""
        if not AuthChallengeDetector.is_auth_challenge(response):
            raise ValueError("Response does not contain a valid auth challenge")
        
        return AuthChallenge(
            challenge_type=response["challenge_type"],
            authorization_url=response["authorization_url"],
            scope=response["scope"],
            state=response["state"]
        )
    
    @staticmethod
    def create_challenge_response(challenge: AuthChallenge, 
                                authorization_code: Optional[str] = None,
                                error: Optional[str] = None) -> Dict[str, Any]:
        """Create challenge response for MCP server"""
        response = {
            "type": "auth_challenge_response",
            "challenge_type": challenge.challenge_type,
            "state": challenge.state
        }
        
        if authorization_code:
            response["authorization_code"] = authorization_code
        elif error:
            response["error"] = error
        else:
            response["error"] = "No authorization provided"
        
        return response