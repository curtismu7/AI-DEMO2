"""Base error classes for the LangChain MCP OAuth Agent."""

from typing import Optional, Dict, Any
from datetime import datetime


class BaseAgentError(Exception):
    """Base exception class for all agent errors."""
    
    def __init__(
        self,
        message: str,
        error_code: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        cause: Optional[Exception] = None
    ):
        super().__init__(message)
        self.message = message
        self.error_code = error_code or self.__class__.__name__
        self.details = details or {}
        self.cause = cause
        self.timestamp = datetime.utcnow()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert error to dictionary for logging/serialization."""
        return {
            'error_type': self.__class__.__name__,
            'error_code': self.error_code,
            'message': self.message,
            'details': self.details,
            'timestamp': self.timestamp.isoformat(),
            'cause': str(self.cause) if self.cause else None
        }


class RetryableError(BaseAgentError):
    """Base class for errors that can be retried."""
    
    def __init__(
        self,
        message: str,
        retry_after: Optional[int] = None,
        max_retries: int = 3,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.retry_after = retry_after
        self.max_retries = max_retries
        self.retry_count = 0
    
    def can_retry(self) -> bool:
        """Check if this error can be retried."""
        return self.retry_count < self.max_retries
    
    def increment_retry(self) -> None:
        """Increment the retry count."""
        self.retry_count += 1


class NonRetryableError(BaseAgentError):
    """Base class for errors that should not be retried."""
    pass


class ConfigurationError(NonRetryableError):
    """Error in system configuration."""
    pass


class ValidationError(NonRetryableError):
    """Error in data validation."""
    pass