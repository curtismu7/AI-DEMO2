"""Tests for error handling classes."""

import pytest
from datetime import datetime

from src.errors import (
    BaseAgentError,
    RetryableError,
    NonRetryableError,
    ConfigurationError,
    ValidationError,
    AuthenticationError,
    ClientRegistrationError,
    TokenAcquisitionError,
    TokenRefreshError,
    AuthorizationError,
    InvalidTokenError,
    TokenExpiredError,
    MCPError,
    MCPConnectionError,
    MCPServerUnavailableError,
    MCPToolExecutionError,
    MCPAuthenticationChallengeError,
    MCPToolNotFoundError,
    MCPTimeoutError
)



class TestBaseErrors:
    """Test base error classes."""
    
    def test_base_agent_error_creation(self):
        """Test BaseAgentError creation and serialization."""
        error = BaseAgentError(
            message="Test error",
            error_code="TEST_ERROR",
            details={"key": "value"},
            cause=ValueError("Original error")
        )
        
        assert error.message == "Test error"
        assert error.error_code == "TEST_ERROR"
        assert error.details == {"key": "value"}
        assert isinstance(error.cause, ValueError)
        assert isinstance(error.timestamp, datetime)
        
        # Test serialization
        error_dict = error.to_dict()
        assert error_dict['error_type'] == 'BaseAgentError'
        assert error_dict['error_code'] == 'TEST_ERROR'
        assert error_dict['message'] == 'Test error'
        assert error_dict['details'] == {"key": "value"}
        assert 'timestamp' in error_dict
        assert error_dict['cause'] == "Original error"
    
    def test_retryable_error_retry_logic(self):
        """Test RetryableError retry logic."""
        error = RetryableError(
            message="Retryable error",
            retry_after=5,
            max_retries=3
        )
        
        assert error.can_retry() is True
        assert error.retry_count == 0
        assert error.retry_after == 5
        assert error.max_retries == 3
        
        # Test retry counting
        error.increment_retry()
        assert error.retry_count == 1
        assert error.can_retry() is True
        
        error.increment_retry()
        error.increment_retry()
        assert error.retry_count == 3
        assert error.can_retry() is False
    
    def test_non_retryable_error(self):
        """Test NonRetryableError."""
        error = NonRetryableError("Non-retryable error")
        assert error.message == "Non-retryable error"
        assert isinstance(error, BaseAgentError)


class TestAuthenticationErrors:
    """Test authentication error classes."""
    
    def test_client_registration_error(self):
        """Test ClientRegistrationError."""
        error = ClientRegistrationError(
            message="Registration failed",
            status_code=400,
            response_body="Invalid request"
        )
        
        assert error.status_code == 400
        assert error.response_body == "Invalid request"
        assert error.details['status_code'] == 400
        assert error.details['has_response_body'] is True
        assert error.can_retry() is True
    
    def test_token_acquisition_error(self):
        """Test TokenAcquisitionError."""
        error = TokenAcquisitionError(
            message="Token acquisition failed",
            grant_type="client_credentials",
            status_code=401,
            error_description="Invalid client"
        )
        
        assert error.grant_type == "client_credentials"
        assert error.status_code == 401
        assert error.error_description == "Invalid client"
        assert error.details['grant_type'] == "client_credentials"
    
    def test_token_expired_error(self):
        """Test TokenExpiredError."""
        expired_time = "2023-01-01T00:00:00Z"
        error = TokenExpiredError(
            message="Token expired",
            token_type="access_token",
            expired_at=expired_time
        )
        
        assert error.token_type == "access_token"
        assert error.expired_at == expired_time
        assert error.details['token_type'] == "access_token"
        assert error.details['expired_at'] == expired_time
        assert error.can_retry() is True
    
    def test_authorization_error(self):
        """Test AuthorizationError."""
        error = AuthorizationError(
            message="Authorization failed",
            error_code="access_denied",
            state="test_state"
        )
        
        assert error.state == "test_state"
        assert error.details['state'] == "test_state"
        assert isinstance(error, NonRetryableError)


class TestMCPErrors:
    """Test MCP error classes."""
    
    def test_mcp_connection_error(self):
        """Test MCPConnectionError."""
        error = MCPConnectionError(
            message="Connection failed",
            server_name="test_server",
            endpoint="http://localhost:8080",
            connection_timeout=30
        )
        
        assert error.server_name == "test_server"
        assert error.endpoint == "http://localhost:8080"
        assert error.connection_timeout == 30
        assert error.details['server_name'] == "test_server"
        assert error.can_retry() is True
    
    def test_mcp_tool_execution_error(self):
        """Test MCPToolExecutionError."""
        error = MCPToolExecutionError(
            message="Tool execution failed",
            tool_name="test_tool",
            server_name="test_server",
            execution_id="exec_123"
        )
        
        assert error.tool_name == "test_tool"
        assert error.server_name == "test_server"
        assert error.execution_id == "exec_123"
        assert error.details['tool_name'] == "test_tool"
    
    def test_mcp_authentication_challenge_error(self):
        """Test MCPAuthenticationChallengeError."""
        error = MCPAuthenticationChallengeError(
            message="Auth challenge failed",
            challenge_type="oauth_authorization_code",
            server_name="test_server",
            required_scopes=["read", "write"]
        )
        
        assert error.challenge_type == "oauth_authorization_code"
        assert error.server_name == "test_server"
        assert error.required_scopes == ["read", "write"]
        assert error.details['required_scopes'] == ["read", "write"]
        assert isinstance(error, NonRetryableError)
    
    def test_mcp_tool_not_found_error(self):
        """Test MCPToolNotFoundError."""
        error = MCPToolNotFoundError(
            message="Tool not found",
            tool_name="missing_tool",
            server_name="test_server",
            available_tools=["tool1", "tool2"]
        )
        
        assert error.tool_name == "missing_tool"
        assert error.available_tools == ["tool1", "tool2"]
        assert error.details['available_tools_count'] == 2
