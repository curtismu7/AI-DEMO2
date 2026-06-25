"""
Base interfaces and abstract classes for authentication components.
"""
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from datetime import datetime

from models.auth import ClientCredentials, AccessToken


class AuthenticationProvider(ABC):
    """Abstract base class for OAuth authentication providers."""
    
    @abstractmethod
    async def register_client(self) -> ClientCredentials:
        """Register a new OAuth client with the authorization server."""
        pass
    
    @abstractmethod
    async def get_client_credentials_token(self, client_credentials: ClientCredentials) -> AccessToken:
        """Obtain an access token using client credentials flow."""
        pass
    
    @abstractmethod
    async def refresh_token(self, refresh_token: str) -> AccessToken:
        """Refresh an expired access token."""
        pass
    
    @abstractmethod
    async def generate_authorization_url(self, client_id: str, scope: str, state: str) -> str:
        """Generate authorization URL for user authorization code flow."""
        pass


class TokenStorage(ABC):
    """Abstract base class for secure token storage."""
    
    @abstractmethod
    async def store_client_credentials(self, credentials: ClientCredentials) -> None:
        """Store client credentials securely."""
        pass
    
    @abstractmethod
    async def get_client_credentials(self) -> Optional[ClientCredentials]:
        """Retrieve stored client credentials."""
        pass
    
    @abstractmethod
    async def store_agent_token(self, token: AccessToken) -> None:
        """Store agent access token securely."""
        pass
    
    @abstractmethod
    async def get_agent_token(self) -> Optional[AccessToken]:
        """Retrieve stored agent access token."""
        pass
    
    @abstractmethod
    async def clear_expired_tokens(self) -> None:
        """Remove expired tokens from storage."""
        pass


class UserAuthorizationFacilitator(ABC):
    """Abstract base class for facilitating user authorization between users and MCP servers."""
    
    @abstractmethod
    def generate_authorization_url(self, client_id: str, scope: str, session_id: str, mcp_server_id: str) -> str:
        """Generate authorization URL for user to visit when MCP server requests authorization."""
        pass
    
    @abstractmethod
    def handle_authorization_callback(
        self,
        auth_code: str,
        state: str,
        session_id: str,
    ) -> Dict[str, Any]:
        """Handle authorization callback and prepare data for MCP server.

        session_id is REQUIRED (IN-06). The implementation MUST invoke
        validate_state(state, session_id) before exchanging the auth code
        (BL-03 — closes the CSRF/replay window on the OAuth callback) and
        MUST reject a missing/empty session_id rather than silent-passing.
        """
        pass
    
    @abstractmethod
    def validate_state(self, state: str, session_id: str) -> bool:
        """Validate state parameter for CSRF protection."""
        pass