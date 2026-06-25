"""Security-aware logging utilities that exclude sensitive information."""

import logging
import re
import json
from typing import Dict, Any, List, Optional, Union
from enum import Enum
from datetime import datetime


class LogLevel(Enum):
    """Log levels for structured logging."""
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class SensitiveDataFilter(logging.Filter):
    """Filter to remove sensitive data from log records."""
    
    # Patterns for sensitive data
    SENSITIVE_PATTERNS = [
        # Tokens and secrets in JSON format
        (r'("access_token":\s*")[^"]*(")', r'\1[REDACTED]\2'),
        (r'("refresh_token":\s*")[^"]*(")', r'\1[REDACTED]\2'),
        (r'("client_secret":\s*")[^"]*(")', r'\1[REDACTED]\2'),
        (r'("authorization_code":\s*")[^"]*(")', r'\1[REDACTED]\2'),
        (r'("password":\s*")[^"]*(")', r'\1[REDACTED]\2'),
        (r'("token":\s*")[^"]*(")', r'\1[REDACTED]\2'),
        
        # Tokens and secrets in key=value format
        (r'(access_token=)[^\s&]+', r'\1[REDACTED]'),
        (r'(refresh_token=)[^\s&]+', r'\1[REDACTED]'),
        (r'(client_secret=)[^\s&]+', r'\1[REDACTED]'),
        (r'(authorization_code=)[^\s&]+', r'\1[REDACTED]'),
        (r'(password=)[^\s&]+', r'\1[REDACTED]'),
        (r'(token=)[^\s&]+', r'\1[REDACTED]'),
        
        # Authorization headers
        (r'(Authorization:\s*Bearer\s+)[^\s]+', r'\1[REDACTED]'),
        (r'(Bearer\s+)[^\s]+', r'\1[REDACTED]'),
        
        # URLs with tokens
        (r'([?&]access_token=)[^&\s]+', r'\1[REDACTED]'),
        (r'([?&]code=)[^&\s]+', r'\1[REDACTED]'),
        (r'([?&]client_secret=)[^&\s]+', r'\1[REDACTED]'),
        
        # Common sensitive field names
        (r'("(?:secret|key|token|password|credential)":\s*")[^"]*(")', r'\1[REDACTED]\2'),

        # PII patterns
        (r'("email":\s*")[^"]*(")', r'\1[EMAIL_REDACTED]\2'),
        (r'("phone":\s*")[^"]*(")', r'\1[PHONE_REDACTED]\2'),
        (r'("ssn":\s*")[^"]*(")', r'\1[SSN_REDACTED]\2'),

        # BL-02: bare JWT in a log line — three base64url segments joined by '.'.
        # Catches any AccessToken whose call site forgot to mask, including
        # third-party libraries that log full request payloads. The pattern is
        # length-bounded to limit catastrophic backtracking risk on huge inputs.
        (r'\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b', '[REDACTED_JWT]'),
    ]
    
    # Fields that should be completely removed from logs
    SENSITIVE_FIELDS = {
        'access_token', 'refresh_token', 'client_secret', 'authorization_code',
        'password', 'token', 'secret', 'key', 'credential', 'private_key',
        'jwt', 'session_token', 'api_key'
    }
    
    def filter(self, record: logging.LogRecord) -> bool:
        """Filter sensitive data from log record."""
        # Filter message
        if hasattr(record, 'msg') and record.msg:
            record.msg = self._sanitize_message(str(record.msg))
        
        # Filter args if present
        if hasattr(record, 'args') and record.args:
            record.args = tuple(
                self._sanitize_message(str(arg)) if isinstance(arg, str) else arg
                for arg in record.args
            )
        
        # Filter extra fields
        if hasattr(record, '__dict__'):
            for key, value in list(record.__dict__.items()):
                if key.lower() in self.SENSITIVE_FIELDS:
                    setattr(record, key, '[REDACTED]')
                elif isinstance(value, str):
                    setattr(record, key, self._sanitize_message(value))
                elif isinstance(value, dict):
                    setattr(record, key, self._sanitize_dict(value))
        
        return True
    
    def _sanitize_message(self, message: str) -> str:
        """Sanitize a message string."""
        for pattern, replacement in self.SENSITIVE_PATTERNS:
            message = re.sub(pattern, replacement, message, flags=re.IGNORECASE)
        return message
    
    def _sanitize_dict(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Sanitize a dictionary by removing sensitive fields."""
        if not isinstance(data, dict):
            return data
        
        sanitized = {}
        for key, value in data.items():
            if key.lower() in self.SENSITIVE_FIELDS:
                sanitized[key] = '[REDACTED]'
            elif isinstance(value, dict):
                sanitized[key] = self._sanitize_dict(value)
            elif isinstance(value, str):
                sanitized[key] = self._sanitize_message(value)
            elif isinstance(value, list):
                sanitized[key] = [
                    self._sanitize_dict(item) if isinstance(item, dict)
                    else self._sanitize_message(item) if isinstance(item, str)
                    else item
                    for item in value
                ]
            else:
                sanitized[key] = value
        
        return sanitized


class SecureLogger:
    """Security-aware logger that filters sensitive information."""
    
    def __init__(self, name: str, level: LogLevel = LogLevel.INFO):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(getattr(logging, level.value))
        
        # Add sensitive data filter
        self.sensitive_filter = SensitiveDataFilter()
        self.logger.addFilter(self.sensitive_filter)
        
        # Configure formatter for structured logging
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        
        # Add console handler if not already present
        if not self.logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(formatter)
            handler.addFilter(self.sensitive_filter)
            self.logger.addHandler(handler)
            # This logger emits via its own handler — stop propagation to the
            # root logger's handlers, which double-emitted every record.
            self.logger.propagate = False
    
    def debug(self, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log debug message."""
        self._log(logging.DEBUG, message, extra)
    
    def info(self, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log info message."""
        self._log(logging.INFO, message, extra)
    
    def warning(self, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log warning message."""
        self._log(logging.WARNING, message, extra)
    
    def error(self, message: str, extra: Optional[Dict[str, Any]] = None, exc_info: bool = False) -> None:
        """Log error message."""
        self._log(logging.ERROR, message, extra, exc_info=exc_info)
    
    def critical(self, message: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log critical message."""
        self._log(logging.CRITICAL, message, extra)
    
    def _log(self, level: int, message: str, extra: Optional[Dict[str, Any]] = None, exc_info: bool = False) -> None:
        """Internal logging method."""
        if extra:
            # Sanitize extra data before logging
            sanitized_extra = self.sensitive_filter._sanitize_dict(extra)
            self.logger.log(level, message, extra=sanitized_extra, exc_info=exc_info)
        else:
            self.logger.log(level, message, exc_info=exc_info)
    
    def log_dict(self, level: LogLevel, message: str, data: Dict[str, Any]) -> None:
        """Log a message with structured data."""
        sanitized_data = self.sensitive_filter._sanitize_dict(data)
        formatted_message = f"{message} | Data: {json.dumps(sanitized_data, default=str)}"
        self._log(getattr(logging, level.value), formatted_message)
    
    def log_exception(self, message: str, exception: Exception, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log an exception with context."""
        error_context = {
            'exception_type': type(exception).__name__,
            'exception_message': str(exception),
            'timestamp': datetime.utcnow().isoformat()
        }
        
        if extra:
            error_context.update(extra)
        
        self.error(message, extra=error_context, exc_info=True)


def get_secure_logger(name: str, level: LogLevel = LogLevel.INFO) -> SecureLogger:
    """Get a secure logger instance."""
    return SecureLogger(name, level)


def configure_logging(
    level: LogLevel = LogLevel.INFO,
    format_string: Optional[str] = None,
    enable_file_logging: bool = False,
    log_file_path: Optional[str] = None
) -> None:
    """Configure global logging settings."""
    # Set root logger level
    logging.getLogger().setLevel(getattr(logging, level.value))
    
    # Create formatter
    if format_string is None:
        format_string = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    
    formatter = logging.Formatter(format_string)
    
    # Configure console logging
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.addFilter(SensitiveDataFilter())
    
    # Configure file logging if requested
    if enable_file_logging and log_file_path:
        file_handler = logging.FileHandler(log_file_path)
        file_handler.setFormatter(formatter)
        file_handler.addFilter(SensitiveDataFilter())
        logging.getLogger().addHandler(file_handler)
    
    # Add console handler to root logger
    root_logger = logging.getLogger()
    if not root_logger.handlers:
        root_logger.addHandler(console_handler)