"""MCP-related error classes."""

from typing import Optional, Dict, Any, List
from .base_errors import BaseAgentError, RetryableError, NonRetryableError


class MCPError(BaseAgentError):
    """Base class for MCP-related errors."""
    
    def __init__(
        self,
        message: str,
        server_name: Optional[str] = None,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.server_name = server_name
        if server_name:
            self.details['server_name'] = server_name


class MCPConnectionError(RetryableError):
    """Error connecting to MCP server."""
    
    def __init__(
        self,
        message: str,
        server_name: Optional[str] = None,
        endpoint: Optional[str] = None,
        connection_timeout: Optional[int] = None,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.server_name = server_name
        self.endpoint = endpoint
        self.connection_timeout = connection_timeout
        
        self.details.update({
            'server_name': server_name,
            'endpoint': endpoint,
            'connection_timeout': connection_timeout
        })


class MCPServerUnavailableError(RetryableError):
    """Error when MCP server is unavailable."""
    
    def __init__(
        self,
        message: str,
        server_name: Optional[str] = None,
        last_successful_connection: Optional[str] = None,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.server_name = server_name
        self.last_successful_connection = last_successful_connection
        
        self.details.update({
            'server_name': server_name,
            'last_successful_connection': last_successful_connection
        })


class MCPToolExecutionError(RetryableError):
    """Error during MCP tool execution."""
    
    def __init__(
        self,
        message: str,
        tool_name: Optional[str] = None,
        server_name: Optional[str] = None,
        execution_id: Optional[str] = None,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.tool_name = tool_name
        self.server_name = server_name
        self.execution_id = execution_id
        
        self.details.update({
            'tool_name': tool_name,
            'server_name': server_name,
            'execution_id': execution_id
        })


class MCPAuthenticationChallengeError(NonRetryableError):
    """Error handling MCP authentication challenges."""
    
    def __init__(
        self,
        message: str,
        challenge_type: Optional[str] = None,
        server_name: Optional[str] = None,
        required_scopes: Optional[List[str]] = None,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.challenge_type = challenge_type
        self.server_name = server_name
        self.required_scopes = required_scopes or []
        
        self.details.update({
            'challenge_type': challenge_type,
            'server_name': server_name,
            'required_scopes': required_scopes
        })


class MCPToolNotFoundError(NonRetryableError):
    """Error when requested MCP tool is not found."""
    
    def __init__(
        self,
        message: str,
        tool_name: Optional[str] = None,
        server_name: Optional[str] = None,
        available_tools: Optional[List[str]] = None,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.tool_name = tool_name
        self.server_name = server_name
        self.available_tools = available_tools or []
        
        self.details.update({
            'tool_name': tool_name,
            'server_name': server_name,
            'available_tools_count': len(available_tools) if available_tools else 0
        })


class MCPTimeoutError(RetryableError):
    """Error when MCP operation times out."""
    
    def __init__(
        self,
        message: str,
        operation: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
        server_name: Optional[str] = None,
        **kwargs
    ):
        super().__init__(message, **kwargs)
        self.operation = operation
        self.timeout_seconds = timeout_seconds
        self.server_name = server_name
        
        self.details.update({
            'operation': operation,
            'timeout_seconds': timeout_seconds,
            'server_name': server_name
        })