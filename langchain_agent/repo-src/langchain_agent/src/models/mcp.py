"""
MCP (Model Context Protocol) integration models.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, Dict, Any
from enum import Enum
import re
from .auth import AccessToken, AuthorizationCode


class AuthRequirementType(Enum):
    """Types of authentication requirements for MCP servers"""
    NONE = "none"
    AGENT_TOKEN = "agent_token"
    USER_AUTHORIZATION = "user_authorization"
    BOTH = "both"


class ChallengeType(Enum):
    """Types of authentication challenges"""
    OAUTH_AUTHORIZATION_CODE = "oauth_authorization_code"
    OAUTH_CLIENT_CREDENTIALS = "oauth_client_credentials"


@dataclass
class AuthRequirements:
    """Authentication requirements for MCP server"""
    type: AuthRequirementType
    scopes: List[str]
    
    def __post_init__(self):
        """Validate auth requirements after initialization"""
        self.validate()
    
    def validate(self) -> None:
        """Validate authentication requirements"""
        if not isinstance(self.type, AuthRequirementType):
            raise ValueError("type must be an AuthRequirementType enum value")
        
        if not isinstance(self.scopes, list):
            raise ValueError("scopes must be a list")
        
        for scope in self.scopes:
            if not isinstance(scope, str) or not scope.strip():
                raise ValueError("all scopes must be non-empty strings")


@dataclass
class MCPServerConfig:
    """Configuration for MCP server connection"""
    name: str
    endpoint: str
    capabilities: List[str]
    auth_requirements: AuthRequirements
    
    def __post_init__(self):
        """Validate MCP server config after initialization"""
        self.validate()
    
    def validate(self) -> None:
        """Validate MCP server configuration"""
        if not self.name or not isinstance(self.name, str):
            raise ValueError("name must be a non-empty string")
        
        # Validate name format (alphanumeric with hyphens and underscores)
        if not re.match(r'^[A-Za-z0-9\-_]+$', self.name):
            raise ValueError("name contains invalid characters (only alphanumeric, hyphens, and underscores allowed)")
        
        if not self.endpoint or not isinstance(self.endpoint, str):
            raise ValueError("endpoint must be a non-empty string")
        
        # Basic URL validation
        if not (self.endpoint.startswith('http://') or self.endpoint.startswith('https://') or self.endpoint.startswith('ws://') or self.endpoint.startswith('wss://')):
            raise ValueError("endpoint must be a valid URL starting with http://, https://, ws://, or wss://")
        
        if not isinstance(self.capabilities, list):
            raise ValueError("capabilities must be a list")
        
        for capability in self.capabilities:
            if not isinstance(capability, str) or not capability.strip():
                raise ValueError("all capabilities must be non-empty strings")
        
        if not isinstance(self.auth_requirements, AuthRequirements):
            raise ValueError("auth_requirements must be an AuthRequirements instance")
        
        # Validate that auth_requirements is valid
        self.auth_requirements.validate()
    
    def requires_agent_token(self) -> bool:
        """Check if server requires agent token"""
        return self.auth_requirements.type in [AuthRequirementType.AGENT_TOKEN, AuthRequirementType.BOTH]
    
    def requires_user_authorization(self) -> bool:
        """Check if server requires user authorization"""
        return self.auth_requirements.type in [AuthRequirementType.USER_AUTHORIZATION, AuthRequirementType.BOTH]


@dataclass
class AuthChallenge:
    """OAuth authentication challenge from MCP server"""
    challenge_type: str
    authorization_url: str
    scope: str
    state: str
    
    def __post_init__(self):
        """Validate auth challenge after initialization"""
        self.validate()
    
    def validate(self) -> None:
        """Validate authentication challenge"""
        if not self.challenge_type or not isinstance(self.challenge_type, str):
            raise ValueError("challenge_type must be a non-empty string")
        
        # Validate challenge type
        valid_types = [ct.value for ct in ChallengeType]
        if self.challenge_type not in valid_types:
            raise ValueError(f"challenge_type must be one of: {', '.join(valid_types)}")
        
        if not self.authorization_url or not isinstance(self.authorization_url, str):
            raise ValueError("authorization_url must be a non-empty string")
        
        # Basic URL validation
        if not (self.authorization_url.startswith('http://') or self.authorization_url.startswith('https://')):
            raise ValueError("authorization_url must be a valid HTTP/HTTPS URL")
        
        if not self.scope or not isinstance(self.scope, str):
            raise ValueError("scope must be a non-empty string")
        
        if not self.state or not isinstance(self.state, str):
            raise ValueError("state must be a non-empty string")
        
        # Validate state format (should be URL-safe)
        if not re.match(r'^[A-Za-z0-9\-_\.]+$', self.state):
            raise ValueError("state contains invalid characters")
    
    def is_oauth_authorization_code(self) -> bool:
        """Check if this is an OAuth authorization code challenge"""
        return self.challenge_type == ChallengeType.OAUTH_AUTHORIZATION_CODE.value


@dataclass
class MCPToolCall:
    """MCP tool call with authentication context"""
    tool_name: str
    parameters: Dict[str, Any]
    agent_token: AccessToken
    user_auth_code: Optional[AuthorizationCode]
    session_id: str
    
    def __post_init__(self):
        """Validate MCP tool call after initialization"""
        self.validate()
    
    def validate(self) -> None:
        """Validate MCP tool call"""
        if not self.tool_name or not isinstance(self.tool_name, str):
            raise ValueError("tool_name must be a non-empty string")
        
        # Validate tool name format (alphanumeric with dots, hyphens, and underscores)
        if not re.match(r'^[A-Za-z0-9\.\-_]+$', self.tool_name):
            raise ValueError("tool_name contains invalid characters")
        
        if not isinstance(self.parameters, dict):
            raise ValueError("parameters must be a dictionary")
        
        if not isinstance(self.agent_token, AccessToken):
            raise ValueError("agent_token must be an AccessToken instance")
        
        if self.user_auth_code is not None and not isinstance(self.user_auth_code, AuthorizationCode):
            raise ValueError("user_auth_code must be an AuthorizationCode instance or None")
        
        if not self.session_id or not isinstance(self.session_id, str):
            raise ValueError("session_id must be a non-empty string")
        
        # Validate that the agent token itself is valid
        self.agent_token.validate()
        
        # Validate user auth code if present
        if self.user_auth_code is not None:
            self.user_auth_code.validate()
    
    # WR-03: the default dataclass repr embeds `parameters` (may carry account
    # numbers / amounts / free-text) and the nested credential objects. Emit a
    # redacted form: tool + session + arg *keys* only, never arg values; the
    # nested AccessToken / AuthorizationCode reprs are themselves masked.
    def __repr__(self) -> str:  # pragma: no cover - trivial
        param_keys = sorted(self.parameters.keys()) if isinstance(self.parameters, dict) else "***"
        return (
            f"MCPToolCall(tool_name={self.tool_name!r}, "
            f"session_id={self.session_id!r}, param_keys={param_keys!r}, "
            f"agent_token=***masked***, "
            f"user_auth_code={self.user_auth_code!r})"
        )

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.__repr__()

    def has_user_authorization(self) -> bool:
        """Check if tool call has user authorization code"""
        return self.user_auth_code is not None
    
    def is_agent_token_expired(self) -> bool:
        """Check if agent token is expired"""
        return self.agent_token.is_expired()
    
    def is_user_auth_code_expired(self) -> bool:
        """Check if user authorization code is expired (if present)"""
        if self.user_auth_code is None:
            return False
        return self.user_auth_code.is_expired()