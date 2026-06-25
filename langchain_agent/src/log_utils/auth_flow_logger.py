"""Specialized logging for OAuth authentication flows."""

import json
import logging
from typing import Dict, Any, Optional
from enum import Enum
from datetime import datetime

from .secure_logger import SecureLogger, LogLevel


class AuthFlowEvent(Enum):
    """Authentication flow events for structured logging."""
    CLIENT_REGISTRATION_START = "client_registration_start"
    CLIENT_REGISTRATION_SUCCESS = "client_registration_success"
    CLIENT_REGISTRATION_FAILURE = "client_registration_failure"
    
    TOKEN_ACQUISITION_START = "token_acquisition_start"
    TOKEN_ACQUISITION_SUCCESS = "token_acquisition_success"
    TOKEN_ACQUISITION_FAILURE = "token_acquisition_failure"
    
    TOKEN_REFRESH_START = "token_refresh_start"
    TOKEN_REFRESH_SUCCESS = "token_refresh_success"
    TOKEN_REFRESH_FAILURE = "token_refresh_failure"
    
    AUTHORIZATION_REQUEST_START = "authorization_request_start"
    AUTHORIZATION_REQUEST_SUCCESS = "authorization_request_success"
    AUTHORIZATION_REQUEST_FAILURE = "authorization_request_failure"
    
    AUTHORIZATION_CODE_RECEIVED = "authorization_code_received"
    AUTHORIZATION_CODE_EXCHANGE_START = "authorization_code_exchange_start"
    AUTHORIZATION_CODE_EXCHANGE_SUCCESS = "authorization_code_exchange_success"
    AUTHORIZATION_CODE_EXCHANGE_FAILURE = "authorization_code_exchange_failure"
    
    MCP_AUTH_CHALLENGE_RECEIVED = "mcp_auth_challenge_received"
    MCP_AUTH_CHALLENGE_HANDLED = "mcp_auth_challenge_handled"
    MCP_AUTH_CHALLENGE_FAILED = "mcp_auth_challenge_failed"


class AuthFlowLogger:
    """Specialized logger for OAuth authentication flows."""
    
    def __init__(self, name: str = "auth_flow"):
        self.logger = SecureLogger(name, LogLevel.INFO)
        self.session_contexts: Dict[str, Dict[str, Any]] = {}
    
    def start_session(self, session_id: str, context: Optional[Dict[str, Any]] = None) -> None:
        """Start tracking an authentication session."""
        self.session_contexts[session_id] = {
            'session_id': session_id,
            'start_time': datetime.utcnow().isoformat(),
            'events': [],
            **(context or {})
        }
        
        self.logger.info(
            f"Authentication session started: {session_id}",
            extra={'session_id': session_id, 'context': context}
        )
    
    def log_event(
        self,
        event: AuthFlowEvent,
        session_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        level: LogLevel = LogLevel.INFO
    ) -> None:
        """Log an authentication flow event."""
        event_data = {
            'event': event.value,
            'timestamp': datetime.utcnow().isoformat(),
            'session_id': session_id,
            'details': details or {}
        }
        
        # Add to session context if session exists
        if session_id and session_id in self.session_contexts:
            self.session_contexts[session_id]['events'].append(event_data)
        
        # Log the event
        message = f"Auth flow event: {event.value}"
        if session_id:
            message += f" (session: {session_id})"
        
        self.logger._log(
            getattr(logging, level.value),
            message,
            extra=event_data
        )
    
    def log_client_registration(
        self,
        event: AuthFlowEvent,
        session_id: Optional[str] = None,
        client_id: Optional[str] = None,
        status_code: Optional[int] = None,
        error_details: Optional[Dict[str, Any]] = None
    ) -> None:
        """Log client registration events."""
        details = {}
        
        if client_id:
            # Only log first few characters of client_id for identification
            details['client_id_prefix'] = client_id[:8] + "..." if len(client_id) > 8 else client_id
        
        if status_code:
            details['status_code'] = status_code
        
        if error_details:
            details['error'] = error_details
        
        level = LogLevel.ERROR if 'failure' in event.value else LogLevel.INFO
        self.log_event(event, session_id, details, level)
    
    def log_token_operation(
        self,
        event: AuthFlowEvent,
        session_id: Optional[str] = None,
        grant_type: Optional[str] = None,
        scope: Optional[str] = None,
        token_type: Optional[str] = None,
        expires_in: Optional[int] = None,
        error_details: Optional[Dict[str, Any]] = None
    ) -> None:
        """Log token acquisition/refresh events."""
        details = {}
        
        if grant_type:
            details['grant_type'] = grant_type
        
        if scope:
            details['scope'] = scope
        
        if token_type:
            details['token_type'] = token_type
        
        if expires_in:
            details['expires_in'] = expires_in
        
        if error_details:
            details['error'] = error_details
        
        level = LogLevel.ERROR if 'failure' in event.value else LogLevel.INFO
        self.log_event(event, session_id, details, level)
    
    def log_authorization_flow(
        self,
        event: AuthFlowEvent,
        session_id: Optional[str] = None,
        state: Optional[str] = None,
        scope: Optional[str] = None,
        redirect_uri: Optional[str] = None,
        error_details: Optional[Dict[str, Any]] = None
    ) -> None:
        """Log authorization code flow events."""
        details = {}
        
        if state:
            # Only log first few characters of state for identification
            details['state_prefix'] = state[:8] + "..." if len(state) > 8 else state
        
        if scope:
            details['scope'] = scope
        
        if redirect_uri:
            details['redirect_uri'] = redirect_uri
        
        if error_details:
            details['error'] = error_details
        
        level = LogLevel.ERROR if 'failure' in event.value else LogLevel.INFO
        self.log_event(event, session_id, details, level)
    
    def log_mcp_auth_challenge(
        self,
        event: AuthFlowEvent,
        session_id: Optional[str] = None,
        server_name: Optional[str] = None,
        challenge_type: Optional[str] = None,
        required_scopes: Optional[list] = None,
        error_details: Optional[Dict[str, Any]] = None
    ) -> None:
        """Log MCP authentication challenge events."""
        details = {}
        
        if server_name:
            details['server_name'] = server_name
        
        if challenge_type:
            details['challenge_type'] = challenge_type
        
        if required_scopes:
            details['required_scopes'] = required_scopes
        
        if error_details:
            details['error'] = error_details
        
        level = LogLevel.ERROR if 'failed' in event.value else LogLevel.INFO
        self.log_event(event, session_id, details, level)
    
    def end_session(self, session_id: str, success: bool = True) -> None:
        """End an authentication session and log summary."""
        if session_id not in self.session_contexts:
            self.logger.warning(f"Attempted to end unknown session: {session_id}")
            return
        
        session_context = self.session_contexts[session_id]
        session_context['end_time'] = datetime.utcnow().isoformat()
        session_context['success'] = success
        
        # Calculate session duration
        start_time = datetime.fromisoformat(session_context['start_time'])
        end_time = datetime.fromisoformat(session_context['end_time'])
        duration = (end_time - start_time).total_seconds()
        
        summary = {
            'session_id': session_id,
            'duration_seconds': duration,
            'event_count': len(session_context['events']),
            'success': success
        }
        
        level = LogLevel.INFO if success else LogLevel.ERROR
        self.logger._log(
            getattr(logging, level.value),
            f"Authentication session ended: {session_id} ({'success' if success else 'failure'})",
            extra=summary
        )
        
        # Clean up session context
        del self.session_contexts[session_id]
    
    def get_session_summary(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get summary of authentication session."""
        if session_id not in self.session_contexts:
            return None
        
        session_context = self.session_contexts[session_id].copy()
        
        # Remove sensitive details from events
        sanitized_events = []
        for event in session_context.get('events', []):
            sanitized_event = {
                'event': event['event'],
                'timestamp': event['timestamp']
            }
            # Only include non-sensitive details
            if 'details' in event:
                details = event['details']
                sanitized_details = {}
                for key, value in details.items():
                    if key not in ['client_secret', 'access_token', 'refresh_token', 'authorization_code']:
                        sanitized_details[key] = value
                if sanitized_details:
                    sanitized_event['details'] = sanitized_details
            sanitized_events.append(sanitized_event)
        
        session_context['events'] = sanitized_events
        return session_context


# Global auth flow logger instance
_auth_flow_logger = None


def get_auth_flow_logger() -> AuthFlowLogger:
    """Get the global auth flow logger instance."""
    global _auth_flow_logger
    if _auth_flow_logger is None:
        _auth_flow_logger = AuthFlowLogger()
    return _auth_flow_logger


def log_auth_event(
    event: AuthFlowEvent,
    session_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    level: LogLevel = LogLevel.INFO
) -> None:
    """Convenience function to log auth events."""
    logger = get_auth_flow_logger()
    logger.log_event(event, session_id, details, level)