"""Structured logging utilities for debugging and monitoring."""

import json
import logging
from typing import Dict, Any, Optional, List, Union
from datetime import datetime
from dataclasses import dataclass, asdict
from contextlib import contextmanager

from .secure_logger import SecureLogger, LogLevel


@dataclass
class LogContext:
    """Context information for structured logging."""
    request_id: Optional[str] = None
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    operation: Optional[str] = None
    component: Optional[str] = None
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary, excluding None values."""
        return {k: v for k, v in asdict(self).items() if v is not None}


class StructuredLogger:
    """Logger that provides structured logging with context management."""
    
    def __init__(self, name: str, default_context: Optional[LogContext] = None):
        self.logger = SecureLogger(name)
        self.default_context = default_context or LogContext()
        self._context_stack: List[LogContext] = []
    
    def _merge_contexts(self, additional_context: Optional[LogContext] = None) -> Dict[str, Any]:
        """Merge default context with current context stack and additional context."""
        merged = self.default_context.to_dict()
        
        # Apply context stack
        for context in self._context_stack:
            merged.update(context.to_dict())
        
        # Apply additional context
        if additional_context:
            merged.update(additional_context.to_dict())
        
        return merged
    
    @contextmanager
    def context(self, context: LogContext):
        """Context manager for temporary logging context."""
        self._context_stack.append(context)
        try:
            yield
        finally:
            self._context_stack.pop()
    
    def log_operation_start(
        self,
        operation: str,
        context: Optional[LogContext] = None,
        details: Optional[Dict[str, Any]] = None
    ) -> None:
        """Log the start of an operation."""
        log_context = LogContext(operation=operation)
        if context:
            log_context = LogContext(**{**log_context.to_dict(), **context.to_dict()})
        
        merged_context = self._merge_contexts(log_context)
        
        log_data = {
            'event_type': 'operation_start',
            'operation': operation,
            'timestamp': datetime.utcnow().isoformat(),
            **merged_context
        }
        
        if details:
            log_data['details'] = details
        
        self.logger.info(f"Operation started: {operation}", extra=log_data)
    
    def log_operation_success(
        self,
        operation: str,
        context: Optional[LogContext] = None,
        details: Optional[Dict[str, Any]] = None,
        duration_ms: Optional[float] = None
    ) -> None:
        """Log successful completion of an operation."""
        log_context = LogContext(operation=operation)
        if context:
            log_context = LogContext(**{**log_context.to_dict(), **context.to_dict()})
        
        merged_context = self._merge_contexts(log_context)
        
        log_data = {
            'event_type': 'operation_success',
            'operation': operation,
            'timestamp': datetime.utcnow().isoformat(),
            **merged_context
        }
        
        if details:
            log_data['details'] = details
        
        if duration_ms is not None:
            log_data['duration_ms'] = duration_ms
        
        self.logger.info(f"Operation completed successfully: {operation}", extra=log_data)
    
    def log_operation_failure(
        self,
        operation: str,
        error: Exception,
        context: Optional[LogContext] = None,
        details: Optional[Dict[str, Any]] = None,
        duration_ms: Optional[float] = None
    ) -> None:
        """Log failure of an operation."""
        log_context = LogContext(operation=operation)
        if context:
            log_context = LogContext(**{**log_context.to_dict(), **context.to_dict()})
        
        merged_context = self._merge_contexts(log_context)
        
        log_data = {
            'event_type': 'operation_failure',
            'operation': operation,
            'timestamp': datetime.utcnow().isoformat(),
            'error_type': type(error).__name__,
            'error_message': str(error),
            **merged_context
        }
        
        if details:
            log_data['details'] = details
        
        if duration_ms is not None:
            log_data['duration_ms'] = duration_ms
        
        self.logger.error(f"Operation failed: {operation}", extra=log_data, exc_info=True)
    
    def log_api_request(
        self,
        method: str,
        url: str,
        status_code: Optional[int] = None,
        context: Optional[LogContext] = None,
        duration_ms: Optional[float] = None,
        request_size: Optional[int] = None,
        response_size: Optional[int] = None
    ) -> None:
        """Log API request details."""
        merged_context = self._merge_contexts(context)
        
        log_data = {
            'event_type': 'api_request',
            'method': method,
            'url': url,
            'timestamp': datetime.utcnow().isoformat(),
            **merged_context
        }
        
        if status_code is not None:
            log_data['status_code'] = status_code
        
        if duration_ms is not None:
            log_data['duration_ms'] = duration_ms
        
        if request_size is not None:
            log_data['request_size_bytes'] = request_size
        
        if response_size is not None:
            log_data['response_size_bytes'] = response_size
        
        level = LogLevel.ERROR if status_code and status_code >= 400 else LogLevel.INFO
        message = f"API {method} {url}"
        if status_code:
            message += f" -> {status_code}"
        
        self.logger._log(
            getattr(logging, level.value),
            message,
            extra=log_data
        )
    
    def log_mcp_interaction(
        self,
        server_name: str,
        tool_name: str,
        operation: str,
        context: Optional[LogContext] = None,
        success: bool = True,
        duration_ms: Optional[float] = None,
        error_details: Optional[Dict[str, Any]] = None
    ) -> None:
        """Log MCP server interactions."""
        log_context = LogContext(
            operation=f"mcp_{operation}",
            component="mcp_client"
        )
        if context:
            log_context = LogContext(**{**log_context.to_dict(), **context.to_dict()})
        
        merged_context = self._merge_contexts(log_context)
        
        log_data = {
            'event_type': 'mcp_interaction',
            'server_name': server_name,
            'tool_name': tool_name,
            'mcp_operation': operation,  # Use different key to avoid conflict
            'success': success,
            'timestamp': datetime.utcnow().isoformat(),
            **merged_context
        }
        
        if duration_ms is not None:
            log_data['duration_ms'] = duration_ms
        
        if error_details:
            log_data['error_details'] = error_details
        
        level = LogLevel.ERROR if not success else LogLevel.INFO
        message = f"MCP {operation}: {server_name}.{tool_name} -> {'success' if success else 'failure'}"
        
        self.logger._log(
            getattr(logging, level.value),
            message,
            extra=log_data
        )
    
    def log_performance_metric(
        self,
        metric_name: str,
        value: Union[int, float],
        unit: str,
        context: Optional[LogContext] = None,
        tags: Optional[Dict[str, str]] = None
    ) -> None:
        """Log performance metrics."""
        merged_context = self._merge_contexts(context)
        
        log_data = {
            'event_type': 'performance_metric',
            'metric_name': metric_name,
            'value': value,
            'unit': unit,
            'timestamp': datetime.utcnow().isoformat(),
            **merged_context
        }
        
        if tags:
            log_data['tags'] = tags
        
        self.logger.info(f"Metric: {metric_name} = {value} {unit}", extra=log_data)
    
    def log_security_event(
        self,
        event_type: str,
        severity: str,
        context: Optional[LogContext] = None,
        details: Optional[Dict[str, Any]] = None
    ) -> None:
        """Log security-related events."""
        merged_context = self._merge_contexts(context)
        
        log_data = {
            'event_type': 'security_event',
            'security_event_type': event_type,
            'severity': severity,
            'timestamp': datetime.utcnow().isoformat(),
            **merged_context
        }
        
        if details:
            log_data['details'] = details
        
        # Map severity to log level
        level_mapping = {
            'low': LogLevel.INFO,
            'medium': LogLevel.WARNING,
            'high': LogLevel.ERROR,
            'critical': LogLevel.CRITICAL
        }
        level = level_mapping.get(severity.lower(), LogLevel.WARNING)
        
        self.logger._log(
            getattr(logging, level.value),
            f"Security event: {event_type} (severity: {severity})",
            extra=log_data
        )


def create_log_context(
    request_id: Optional[str] = None,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    operation: Optional[str] = None,
    component: Optional[str] = None,
    trace_id: Optional[str] = None,
    span_id: Optional[str] = None
) -> LogContext:
    """Create a log context with the provided parameters."""
    return LogContext(
        request_id=request_id,
        session_id=session_id,
        user_id=user_id,
        operation=operation,
        component=component,
        trace_id=trace_id,
        span_id=span_id
    )


def setup_logging(level: str = "INFO", format_type: str = "structured") -> None:
    """
    Setup application logging configuration.

    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        format_type: Format type ("structured" or "simple")
    """
    import logging
    import sys
    from pathlib import Path
    # Create logs directory if it doesn't exist
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper()))

    # Clear existing handlers
    root_logger.handlers.clear()

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(getattr(logging, level.upper()))

    # File handler
    file_handler = logging.FileHandler(logs_dir / "app.log")
    file_handler.setLevel(getattr(logging, level.upper()))

    # Set formatters
    if format_type == "structured":
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
    else:
        formatter = logging.Formatter(
            '%(asctime)s - %(levelname)s - %(message)s'
        )

    console_handler.setFormatter(formatter)
    file_handler.setFormatter(formatter)

    # Teaching demo: tokens/claims are an intentional educational surface
    # (see docs/superpowers/specs/2026-05-15-logging-as-teaching-surface-design.md).
    # SensitiveDataFilter is deliberately NOT attached so logs show the full
    # OAuth/RFC 8693 story. REGRESSION_PLAN §4 entry: logging-phase1-unredact.

    # Add handlers
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)

    # Set specific logger levels
    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("aiohttp").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)