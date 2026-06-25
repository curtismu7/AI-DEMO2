"""Error handling module for the LangChain MCP OAuth Agent."""

from .authentication_errors import (
    AuthenticationError,
    ClientRegistrationError,
    TokenAcquisitionError,
    TokenRefreshError,
    AuthorizationError,
    InvalidTokenError,
    TokenExpiredError
)

from .mcp_errors import (
    MCPError,
    MCPConnectionError,
    MCPServerUnavailableError,
    MCPToolExecutionError,
    MCPAuthenticationChallengeError,
    MCPToolNotFoundError,
    MCPTimeoutError
)

from .base_errors import (
    BaseAgentError,
    RetryableError,
    NonRetryableError,
    ConfigurationError,
    ValidationError
)

__all__ = [
    # Base errors
    'BaseAgentError',
    'RetryableError',
    'NonRetryableError',
    'ConfigurationError',
    'ValidationError',
    
    # Authentication errors
    'AuthenticationError',
    'ClientRegistrationError',
    'TokenAcquisitionError',
    'TokenRefreshError',
    'AuthorizationError',
    'InvalidTokenError',
    'TokenExpiredError',
    
    # MCP errors
    'MCPError',
    'MCPConnectionError',
    'MCPServerUnavailableError',
    'MCPToolExecutionError',
    'MCPAuthenticationChallengeError',
    'MCPToolNotFoundError',
    'MCPTimeoutError'
]