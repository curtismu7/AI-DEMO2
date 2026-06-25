"""Authentication-related error classes."""

from typing import Optional, Dict, Any
from .base_errors import BaseAgentError, RetryableError, NonRetryableError


class AuthenticationError(BaseAgentError):
    """Base class for authentication-related errors."""
    pass


class ClientRegistrationError(RetryableError):
    """Error during dynamic client registration with PingOne."""
    
    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        response_body: Optional[str] = None,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.status_code = status_code
        self.response_body = response_body
        
        # Add details for logging
        if status_code:
            self.details['status_code'] = status_code
        if response_body:
            # Don't include full response body in details to avoid logging sensitive data
            self.details['has_response_body'] = True


class TokenAcquisitionError(RetryableError):
    """Error during token acquisition using client credentials flow."""
    
    def __init__(
        self,
        message: str,
        grant_type: str = "client_credentials",
        status_code: Optional[int] = None,
        error_description: Optional[str] = None,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.grant_type = grant_type
        self.status_code = status_code
        self.error_description = error_description
        
        self.details.update({
            'grant_type': grant_type,
            'status_code': status_code,
            'error_description': error_description
        })


class TokenRefreshError(RetryableError):
    """Error during token refresh."""
    
    def __init__(
        self,
        message: str,
        token_type: str = "access_token",
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.token_type = token_type
        self.details['token_type'] = token_type


class AuthorizationError(NonRetryableError):
    """Error during user authorization code flow."""
    
    def __init__(
        self,
        message: str,
        error_code: Optional[str] = None,
        state: Optional[str] = None,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.state = state
        if state:
            self.details['state'] = state


class InvalidTokenError(NonRetryableError):
    """Error when a token is invalid or malformed."""
    
    def __init__(
        self,
        message: str,
        token_type: str = "access_token",
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.token_type = token_type
        self.details['token_type'] = token_type


class TokenExpiredError(RetryableError):
    """Error when a token has expired."""
    
    def __init__(
        self,
        message: str,
        token_type: str = "access_token",
        expired_at: Optional[str] = None,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.token_type = token_type
        self.expired_at = expired_at
        
        self.details.update({
            'token_type': token_type,
            'expired_at': expired_at
        })