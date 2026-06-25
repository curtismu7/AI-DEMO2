"""Tests for security-aware logging functionality."""

import pytest
import logging
import json
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime

from log_utils import (
    SecureLogger,
    get_secure_logger,
    configure_logging,
    LogLevel,
    SensitiveDataFilter,
    AuthFlowLogger,
    AuthFlowEvent,
    log_auth_event,
    StructuredLogger,
    LogContext,
    create_log_context
)


class TestSensitiveDataFilter:
    """Test sensitive data filtering."""
    
    def test_filter_access_token_in_json(self):
        """Test filtering access tokens in JSON strings."""
        filter_obj = SensitiveDataFilter()
        
        message = '{"access_token": "secret_token_123", "user": "test"}'
        filtered = filter_obj._sanitize_message(message)
        
        assert "secret_token_123" not in filtered
        assert "[REDACTED]" in filtered
        assert "test" in filtered
    
    def test_filter_authorization_header(self):
        """Test filtering Authorization headers."""
        filter_obj = SensitiveDataFilter()
        
        message = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        filtered = filter_obj._sanitize_message(message)
        
        assert "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" not in filtered
        assert "Bearer [REDACTED]" in filtered
    
    def test_filter_url_parameters(self):
        """Test filtering sensitive URL parameters."""
        filter_obj = SensitiveDataFilter()
        
        message = "https://api.example.com/token?access_token=secret123&user=test"
        filtered = filter_obj._sanitize_message(message)
        
        assert "secret123" not in filtered
        assert "access_token=[REDACTED]" in filtered
        assert "user=test" in filtered
    
    def test_filter_sensitive_fields_in_dict(self):
        """Test filtering sensitive fields in dictionaries."""
        filter_obj = SensitiveDataFilter()
        
        data = {
            "access_token": "secret123",
            "user_id": "user123",
            "client_secret": "secret456",
            "normal_field": "normal_value"
        }
        
        filtered = filter_obj._sanitize_dict(data)
        
        assert filtered["access_token"] == "[REDACTED]"
        assert filtered["client_secret"] == "[REDACTED]"
        assert filtered["user_id"] == "user123"
        assert filtered["normal_field"] == "normal_value"
    
    def test_filter_nested_dict(self):
        """Test filtering in nested dictionaries."""
        filter_obj = SensitiveDataFilter()
        
        data = {
            "auth": {
                "access_token": "secret123",
                "user": "test"
            },
            "config": {
                "client_secret": "secret456",
                "endpoint": "https://api.example.com"
            }
        }
        
        filtered = filter_obj._sanitize_dict(data)
        
        assert filtered["auth"]["access_token"] == "[REDACTED]"
        assert filtered["auth"]["user"] == "test"
        assert filtered["config"]["client_secret"] == "[REDACTED]"
        assert filtered["config"]["endpoint"] == "https://api.example.com"
    
    def test_filter_log_record(self):
        """Test filtering log records."""
        filter_obj = SensitiveDataFilter()
        
        # Create a real log record instead of mock
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Token: access_token=secret123",
            args=("Bearer secret456",),
            exc_info=None
        )
        
        # Add sensitive attributes
        record.access_token = "secret789"
        record.normal_field = "normal_value"
        
        result = filter_obj.filter(record)
        
        assert result is True
        assert "secret123" not in record.msg
        assert "[REDACTED]" in record.msg
        assert "secret456" not in record.args[0]
        assert record.access_token == "[REDACTED]"
        assert record.normal_field == "normal_value"


class TestSecureLogger:
    """Test SecureLogger functionality."""
    
    @pytest.fixture
    def secure_logger(self):
        """Create a secure logger for testing."""
        return SecureLogger("test_logger", LogLevel.DEBUG)
    
    def test_logger_creation(self, secure_logger):
        """Test secure logger creation."""
        assert secure_logger.logger.name == "test_logger"
        assert secure_logger.logger.level == logging.DEBUG
        assert len(secure_logger.logger.filters) > 0
        assert isinstance(secure_logger.sensitive_filter, SensitiveDataFilter)
    
    @patch('logging.Logger.log')
    def test_log_with_sensitive_data(self, mock_log, secure_logger):
        """Test logging with sensitive data gets filtered."""
        extra_data = {
            "access_token": "secret123",
            "user_id": "user123"
        }
        
        secure_logger.info("Test message", extra=extra_data)
        
        # Verify log was called
        mock_log.assert_called_once()
        call_args = mock_log.call_args
        
        # Check that sensitive data was filtered
        logged_extra = call_args[1]['extra']
        assert logged_extra["access_token"] == "[REDACTED]"
        assert logged_extra["user_id"] == "user123"
    
    def test_log_dict_method(self, secure_logger):
        """Test log_dict method with structured data."""
        with patch.object(secure_logger.logger, 'log') as mock_log:
            data = {
                "client_secret": "secret123",
                "status": "success"
            }
            
            secure_logger.log_dict(LogLevel.INFO, "Test message", data)
            
            mock_log.assert_called_once()
            # Verify the message contains sanitized JSON
            logged_message = mock_log.call_args[0][1]
            assert "secret123" not in logged_message
            assert "[REDACTED]" in logged_message
            assert "success" in logged_message
    
    def test_log_exception_method(self, secure_logger):
        """Test log_exception method."""
        with patch.object(secure_logger, 'error') as mock_error:
            exception = ValueError("Test error")
            extra = {"context": "test"}
            
            secure_logger.log_exception("Exception occurred", exception, extra)
            
            mock_error.assert_called_once()
            call_args = mock_error.call_args
            
            # Check error context was added
            logged_extra = call_args[1]['extra']
            assert logged_extra['exception_type'] == 'ValueError'
            assert logged_extra['exception_message'] == 'Test error'
            assert logged_extra['context'] == 'test'
            assert 'timestamp' in logged_extra


class TestAuthFlowLogger:
    """Test AuthFlowLogger functionality."""
    
    @pytest.fixture
    def auth_logger(self):
        """Create an auth flow logger for testing."""
        return AuthFlowLogger("test_auth_logger")
    
    def test_start_session(self, auth_logger):
        """Test starting an authentication session."""
        session_id = "test_session_123"
        context = {"user_id": "user123"}
        
        with patch.object(auth_logger.logger, 'info') as mock_info:
            auth_logger.start_session(session_id, context)
            
            assert session_id in auth_logger.session_contexts
            session_data = auth_logger.session_contexts[session_id]
            assert session_data['session_id'] == session_id
            assert session_data['user_id'] == "user123"
            assert 'start_time' in session_data
            assert session_data['events'] == []
            
            mock_info.assert_called_once()
    
    def test_log_event(self, auth_logger):
        """Test logging authentication events."""
        session_id = "test_session_123"
        auth_logger.start_session(session_id)
        
        with patch.object(auth_logger.logger, '_log') as mock_log:
            auth_logger.log_event(
                AuthFlowEvent.TOKEN_ACQUISITION_START,
                session_id,
                {"grant_type": "client_credentials"}
            )
            
            # Check event was added to session
            session_data = auth_logger.session_contexts[session_id]
            assert len(session_data['events']) == 1
            
            event = session_data['events'][0]
            assert event['event'] == 'token_acquisition_start'
            assert event['session_id'] == session_id
            assert event['details']['grant_type'] == 'client_credentials'
            
            mock_log.assert_called_once()
    
    def test_log_client_registration(self, auth_logger):
        """Test logging client registration events."""
        with patch.object(auth_logger, 'log_event') as mock_log_event:
            auth_logger.log_client_registration(
                AuthFlowEvent.CLIENT_REGISTRATION_SUCCESS,
                session_id="test_session",
                client_id="client_123456789",
                status_code=201
            )
            
            mock_log_event.assert_called_once()
            call_args = mock_log_event.call_args
            
            # Check that client_id was truncated for security
            details = call_args[0][2]  # details parameter
            assert details['client_id_prefix'] == 'client_1...'
            assert details['status_code'] == 201
    
    def test_log_token_operation(self, auth_logger):
        """Test logging token operations."""
        with patch.object(auth_logger, 'log_event') as mock_log_event:
            auth_logger.log_token_operation(
                AuthFlowEvent.TOKEN_ACQUISITION_SUCCESS,
                session_id="test_session",
                grant_type="client_credentials",
                scope="read write",
                token_type="Bearer",
                expires_in=3600
            )
            
            mock_log_event.assert_called_once()
            call_args = mock_log_event.call_args
            
            details = call_args[0][2]  # details parameter
            assert details['grant_type'] == 'client_credentials'
            assert details['scope'] == 'read write'
            assert details['token_type'] == 'Bearer'
            assert details['expires_in'] == 3600
    
    def test_end_session(self, auth_logger):
        """Test ending an authentication session."""
        session_id = "test_session_123"
        auth_logger.start_session(session_id)
        
        with patch.object(auth_logger.logger, '_log') as mock_log:
            auth_logger.end_session(session_id, success=True)
            
            # Check session was removed
            assert session_id not in auth_logger.session_contexts
            
            mock_log.assert_called_once()
            call_args = mock_log.call_args
            
            # Check summary data
            logged_extra = call_args[1]['extra']
            assert logged_extra['session_id'] == session_id
            assert logged_extra['success'] is True
            assert 'duration_seconds' in logged_extra
    
    def test_get_session_summary(self, auth_logger):
        """Test getting session summary."""
        session_id = "test_session_123"
        auth_logger.start_session(session_id)
        
        # Add some events
        auth_logger.log_event(
            AuthFlowEvent.TOKEN_ACQUISITION_START,
            session_id,
            {"client_secret": "secret123", "grant_type": "client_credentials"}
        )
        
        summary = auth_logger.get_session_summary(session_id)
        
        assert summary is not None
        assert summary['session_id'] == session_id
        assert len(summary['events']) == 1
        
        # Check that sensitive data was removed from summary
        event = summary['events'][0]
        assert 'client_secret' not in event.get('details', {})
        assert event['details']['grant_type'] == 'client_credentials'


class TestStructuredLogger:
    """Test StructuredLogger functionality."""
    
    @pytest.fixture
    def structured_logger(self):
        """Create a structured logger for testing."""
        default_context = LogContext(component="test_component")
        return StructuredLogger("test_structured", default_context)
    
    def test_context_merging(self, structured_logger):
        """Test context merging functionality."""
        additional_context = LogContext(session_id="session123")
        merged = structured_logger._merge_contexts(additional_context)
        
        assert merged['component'] == 'test_component'
        assert merged['session_id'] == 'session123'
    
    def test_context_manager(self, structured_logger):
        """Test context manager functionality."""
        temp_context = LogContext(operation="test_op")
        
        with structured_logger.context(temp_context):
            merged = structured_logger._merge_contexts()
            assert merged['operation'] == 'test_op'
            assert merged['component'] == 'test_component'
        
        # Context should be removed after exiting
        merged = structured_logger._merge_contexts()
        assert 'operation' not in merged
        assert merged['component'] == 'test_component'
    
    def test_log_operation_start(self, structured_logger):
        """Test logging operation start."""
        with patch.object(structured_logger.logger, 'info') as mock_info:
            structured_logger.log_operation_start(
                "test_operation",
                context=LogContext(session_id="session123"),
                details={"param": "value"}
            )
            
            mock_info.assert_called_once()
            call_args = mock_info.call_args
            
            logged_extra = call_args[1]['extra']
            assert logged_extra['event_type'] == 'operation_start'
            assert logged_extra['operation'] == 'test_operation'
            assert logged_extra['session_id'] == 'session123'
            assert logged_extra['component'] == 'test_component'
            assert logged_extra['details']['param'] == 'value'
    
    def test_log_operation_failure(self, structured_logger):
        """Test logging operation failure."""
        with patch.object(structured_logger.logger, 'error') as mock_error:
            error = ValueError("Test error")
            
            structured_logger.log_operation_failure(
                "test_operation",
                error,
                context=LogContext(session_id="session123"),
                duration_ms=150.5
            )
            
            mock_error.assert_called_once()
            call_args = mock_error.call_args
            
            logged_extra = call_args[1]['extra']
            assert logged_extra['event_type'] == 'operation_failure'
            assert logged_extra['operation'] == 'test_operation'
            assert logged_extra['error_type'] == 'ValueError'
            assert logged_extra['error_message'] == 'Test error'
            assert logged_extra['duration_ms'] == 150.5
    
    def test_log_api_request(self, structured_logger):
        """Test logging API requests."""
        with patch.object(structured_logger.logger, '_log') as mock_log:
            structured_logger.log_api_request(
                method="POST",
                url="https://api.example.com/token",
                status_code=200,
                duration_ms=250.0,
                request_size=1024,
                response_size=512
            )
            
            mock_log.assert_called_once()
            call_args = mock_log.call_args
            
            logged_extra = call_args[1]['extra']
            assert logged_extra['event_type'] == 'api_request'
            assert logged_extra['method'] == 'POST'
            assert logged_extra['url'] == 'https://api.example.com/token'
            assert logged_extra['status_code'] == 200
            assert logged_extra['duration_ms'] == 250.0
            assert logged_extra['request_size_bytes'] == 1024
            assert logged_extra['response_size_bytes'] == 512
    
    def test_log_mcp_interaction(self, structured_logger):
        """Test logging MCP interactions."""
        with patch.object(structured_logger.logger, '_log') as mock_log:
            structured_logger.log_mcp_interaction(
                server_name="test_server",
                tool_name="test_tool",
                operation="execute",
                success=True,
                duration_ms=100.0
            )
            
            mock_log.assert_called_once()
            call_args = mock_log.call_args
            
            logged_extra = call_args[1]['extra']
            assert logged_extra['event_type'] == 'mcp_interaction'
            assert logged_extra['server_name'] == 'test_server'
            assert logged_extra['tool_name'] == 'test_tool'
            assert logged_extra['mcp_operation'] == 'execute'
            assert logged_extra['operation'] == 'mcp_execute'  # This comes from merged_context
            assert logged_extra['success'] is True
            assert logged_extra['duration_ms'] == 100.0
    
    def test_log_security_event(self, structured_logger):
        """Test logging security events."""
        with patch.object(structured_logger.logger, '_log') as mock_log:
            structured_logger.log_security_event(
                event_type="unauthorized_access",
                severity="high",
                details={"ip": "192.168.1.1", "user_agent": "test"}
            )
            
            mock_log.assert_called_once()
            call_args = mock_log.call_args
            
            logged_extra = call_args[1]['extra']
            assert logged_extra['event_type'] == 'security_event'
            assert logged_extra['security_event_type'] == 'unauthorized_access'
            assert logged_extra['severity'] == 'high'
            assert logged_extra['details']['ip'] == '192.168.1.1'


class TestLogContext:
    """Test LogContext functionality."""
    
    def test_log_context_creation(self):
        """Test creating log context."""
        context = LogContext(
            request_id="req123",
            session_id="session123",
            operation="test_op"
        )
        
        assert context.request_id == "req123"
        assert context.session_id == "session123"
        assert context.operation == "test_op"
        assert context.user_id is None
    
    def test_log_context_to_dict(self):
        """Test converting log context to dictionary."""
        context = LogContext(
            request_id="req123",
            session_id="session123",
            user_id=None  # Should be excluded
        )
        
        context_dict = context.to_dict()
        
        assert context_dict['request_id'] == "req123"
        assert context_dict['session_id'] == "session123"
        assert 'user_id' not in context_dict  # None values excluded
    
    def test_create_log_context_function(self):
        """Test create_log_context convenience function."""
        context = create_log_context(
            request_id="req123",
            operation="test_op",
            component="test_component"
        )
        
        assert isinstance(context, LogContext)
        assert context.request_id == "req123"
        assert context.operation == "test_op"
        assert context.component == "test_component"


class TestGlobalFunctions:
    """Test global logging functions."""
    
    def test_get_secure_logger(self):
        """Test get_secure_logger function."""
        logger = get_secure_logger("test_logger", LogLevel.DEBUG)
        
        assert isinstance(logger, SecureLogger)
        assert logger.logger.name == "test_logger"
        assert logger.logger.level == logging.DEBUG
    
    @patch('logging.getLogger')
    def test_configure_logging(self, mock_get_logger):
        """Test configure_logging function."""
        mock_root_logger = Mock()
        mock_root_logger.handlers = []
        mock_get_logger.return_value = mock_root_logger
        
        configure_logging(
            level=LogLevel.INFO,
            enable_file_logging=True,
            log_file_path="/tmp/test.log"
        )
        
        # Verify root logger was configured
        mock_root_logger.setLevel.assert_called_with(logging.INFO)
        mock_root_logger.addHandler.assert_called()
    
    def test_log_auth_event_function(self):
        """Test log_auth_event convenience function."""
        with patch('log_utils.auth_flow_logger.get_auth_flow_logger') as mock_get_logger:
            mock_logger = Mock()
            mock_get_logger.return_value = mock_logger
            
            log_auth_event(
                AuthFlowEvent.TOKEN_ACQUISITION_START,
                session_id="session123",
                details={"grant_type": "client_credentials"}
            )
            
            mock_logger.log_event.assert_called_once_with(
                AuthFlowEvent.TOKEN_ACQUISITION_START,
                "session123",
                {"grant_type": "client_credentials"},
                LogLevel.INFO
            )