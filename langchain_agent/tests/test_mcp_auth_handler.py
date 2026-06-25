"""
Unit tests for MCP authentication challenge handler.
"""
import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timezone, timedelta
import uuid

from src.mcp.auth_handler import (
    AuthRequest, AuthResponse, AuthenticationHandler,
    AuthChallengeDetector, AuthRequestCallback
)
# Import models via the same path the handler uses (`models.*`, see
# pythonpath in pytest.ini) so isinstance checks see the same class objects.
from models.mcp import AuthChallenge, ChallengeType
from models.auth import AuthorizationCode


@pytest.fixture
def sample_auth_challenge():
    """Sample authentication challenge for testing"""
    return AuthChallenge(
        challenge_type="oauth_authorization_code",
        authorization_url="https://auth.example.com/authorize?client_id=123&scope=read",
        scope="read write",
        state="state-123"
    )


@pytest.fixture
def sample_auth_request():
    """Sample authentication request for testing"""
    return AuthRequest(
        challenge_id="challenge-123",
        authorization_url="https://auth.example.com/authorize",
        scope="read write",
        state="state-123",
        session_id="session-456",
        server_name="test-server",
        tool_name="test-tool",
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5)
    )


class TestAuthRequest:
    """Test cases for AuthRequest class"""
    
    def test_auth_request_creation(self):
        """Test AuthRequest creation and validation"""
        auth_request = AuthRequest(
            challenge_id="challenge-123",
            authorization_url="https://auth.example.com/authorize",
            scope="read write",
            state="state-123",
            session_id="session-456",
            server_name="test-server",
            tool_name="test-tool",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5)
        )
        
        assert auth_request.challenge_id == "challenge-123"
        assert auth_request.authorization_url == "https://auth.example.com/authorize"
        assert auth_request.scope == "read write"
        assert auth_request.state == "state-123"
        assert auth_request.session_id == "session-456"
        assert auth_request.server_name == "test-server"
        assert auth_request.tool_name == "test-tool"
        assert not auth_request.is_expired()
    
    def test_auth_request_validation(self):
        """Test AuthRequest validation"""
        base_args = {
            "challenge_id": "challenge-123",
            "authorization_url": "https://auth.example.com/authorize",
            "scope": "read write",
            "state": "state-123",
            "session_id": "session-456",
            "server_name": "test-server",
            "tool_name": "test-tool",
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5)
        }
        
        # Test empty challenge_id
        with pytest.raises(ValueError, match="challenge_id must be a non-empty string"):
            AuthRequest(**{**base_args, "challenge_id": ""})
        
        # Test empty authorization_url
        with pytest.raises(ValueError, match="authorization_url must be a non-empty string"):
            AuthRequest(**{**base_args, "authorization_url": ""})
        
        # Test empty session_id
        with pytest.raises(ValueError, match="session_id must be a non-empty string"):
            AuthRequest(**{**base_args, "session_id": ""})
    
    def test_auth_request_expiration(self):
        """Test AuthRequest expiration check"""
        # Expired request
        expired_request = AuthRequest(
            challenge_id="challenge-123",
            authorization_url="https://auth.example.com/authorize",
            scope="read write",
            state="state-123",
            session_id="session-456",
            server_name="test-server",
            tool_name="test-tool",
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)
        )
        
        assert expired_request.is_expired()
    
    def test_auth_request_to_dict(self, sample_auth_request):
        """Test AuthRequest to_dict conversion"""
        result = sample_auth_request.to_dict()
        
        assert result["challenge_id"] == sample_auth_request.challenge_id
        assert result["authorization_url"] == sample_auth_request.authorization_url
        assert result["scope"] == sample_auth_request.scope
        assert result["state"] == sample_auth_request.state
        assert result["session_id"] == sample_auth_request.session_id
        assert result["server_name"] == sample_auth_request.server_name
        assert result["tool_name"] == sample_auth_request.tool_name
        assert "expires_at" in result


class TestAuthResponse:
    """Test cases for AuthResponse class"""
    
    def test_auth_response_success(self):
        """Test successful AuthResponse creation"""
        response = AuthResponse(
            challenge_id="challenge-123",
            authorization_code="auth-code-456",
            state="state-123"
        )
        
        assert response.challenge_id == "challenge-123"
        assert response.authorization_code == "auth-code-456"
        assert response.state == "state-123"
        assert response.error is None
        assert response.is_success()
    
    def test_auth_response_error(self):
        """Test error AuthResponse creation"""
        response = AuthResponse(
            challenge_id="challenge-123",
            error="User denied access"
        )
        
        assert response.challenge_id == "challenge-123"
        assert response.authorization_code is None
        assert response.error == "User denied access"
        assert not response.is_success()
    
    def test_auth_response_validation(self):
        """Test AuthResponse validation"""
        # Test empty challenge_id
        with pytest.raises(ValueError, match="challenge_id must be a non-empty string"):
            AuthResponse(challenge_id="")
        
        # Test neither code nor error
        with pytest.raises(ValueError, match="Either authorization_code or error must be provided"):
            AuthResponse(challenge_id="challenge-123")
        
        # Test both code and error
        with pytest.raises(ValueError, match="Cannot have both authorization_code and error"):
            AuthResponse(
                challenge_id="challenge-123",
                authorization_code="code",
                error="error"
            )
    
    def test_auth_response_to_dict(self):
        """Test AuthResponse to_dict conversion"""
        response = AuthResponse(
            challenge_id="challenge-123",
            authorization_code="auth-code-456",
            state="state-123"
        )
        
        result = response.to_dict()
        
        assert result["challenge_id"] == "challenge-123"
        assert result["authorization_code"] == "auth-code-456"
        assert result["state"] == "state-123"
        assert result["error"] is None


class TestAuthenticationHandler:
    """Test cases for AuthenticationHandler class"""
    
    @pytest.fixture
    def mock_callback(self):
        """Mock auth request callback"""
        return AsyncMock()
    
    @pytest.fixture
    def auth_handler(self, mock_callback):
        """Authentication handler with mock callback"""
        return AuthenticationHandler(auth_request_callback=mock_callback)
    
    @pytest.mark.asyncio
    async def test_handler_initialization(self):
        """Test authentication handler initialization"""
        handler = AuthenticationHandler()
        
        assert handler.auth_request_callback is None
        assert len(handler._pending_challenges) == 0
        assert len(handler._challenge_futures) == 0
        
        # Cleanup
        await handler.shutdown()
    
    @pytest.mark.asyncio
    async def test_handle_auth_challenge_success(self, auth_handler, mock_callback, 
                                               sample_auth_challenge):
        """Test successful authentication challenge handling"""
        
        # Start challenge handling
        challenge_task = asyncio.create_task(
            auth_handler.handle_auth_challenge(
                challenge=sample_auth_challenge,
                session_id="session-123",
                server_name="test-server",
                tool_name="test-tool",
                timeout_seconds=5
            )
        )
        
        # Wait a bit for the challenge to be registered
        await asyncio.sleep(0.1)
        
        # Verify callback was called
        mock_callback.assert_called_once()
        auth_request = mock_callback.call_args[0][0]
        assert isinstance(auth_request, AuthRequest)
        assert auth_request.session_id == "session-123"
        assert auth_request.server_name == "test-server"
        assert auth_request.tool_name == "test-tool"
        
        # Provide response
        success = await auth_handler.provide_auth_response(
            challenge_id=auth_request.challenge_id,
            authorization_code="auth-code-123",
            state=sample_auth_challenge.state
        )
        assert success
        
        # Wait for challenge completion
        response = await challenge_task
        
        assert response.is_success()
        assert response.authorization_code == "auth-code-123"
        assert response.state == sample_auth_challenge.state
        
        # Cleanup
        await auth_handler.shutdown()
    
    @pytest.mark.asyncio
    async def test_handle_auth_challenge_timeout(self, auth_handler, sample_auth_challenge):
        """Test authentication challenge timeout"""
        
        response = await auth_handler.handle_auth_challenge(
            challenge=sample_auth_challenge,
            session_id="session-123",
            server_name="test-server",
            tool_name="test-tool",
            timeout_seconds=0.1  # Very short timeout
        )
        
        assert not response.is_success()
        assert "timed out" in response.error.lower()
        
        # Cleanup
        await auth_handler.shutdown()
    
    @pytest.mark.asyncio
    async def test_handle_auth_challenge_validation(self, auth_handler):
        """Test authentication challenge validation"""
        
        # Test invalid challenge type by creating a mock challenge
        from unittest.mock import Mock
        invalid_challenge = Mock(spec=AuthChallenge)
        invalid_challenge.challenge_type = "invalid_type"
        invalid_challenge.authorization_url = "https://auth.example.com/authorize"
        invalid_challenge.scope = "read"
        invalid_challenge.state = "state-123"
        invalid_challenge.is_oauth_authorization_code.return_value = False
        
        with pytest.raises(ValueError, match="Unsupported challenge type"):
            await auth_handler.handle_auth_challenge(
                challenge=invalid_challenge,
                session_id="session-123",
                server_name="test-server",
                tool_name="test-tool"
            )
        
        # Test empty session_id
        valid_challenge = AuthChallenge(
            challenge_type="oauth_authorization_code",
            authorization_url="https://auth.example.com/authorize",
            scope="read",
            state="state-123"
        )
        
        with pytest.raises(ValueError, match="session_id must be a non-empty string"):
            await auth_handler.handle_auth_challenge(
                challenge=valid_challenge,
                session_id="",
                server_name="test-server",
                tool_name="test-tool"
            )
        
        # Cleanup
        await auth_handler.shutdown()
    
    @pytest.mark.asyncio
    async def test_provide_auth_response_invalid_challenge(self, auth_handler):
        """Test providing response for non-existent challenge"""
        
        success = await auth_handler.provide_auth_response(
            challenge_id="non-existent",
            authorization_code="code"
        )
        
        assert not success
        
        # Cleanup
        await auth_handler.shutdown()
    
    @pytest.mark.asyncio
    async def test_get_pending_challenges(self, auth_handler, mock_callback, 
                                        sample_auth_challenge):
        """Test getting pending challenges"""
        
        # Start challenge
        challenge_task = asyncio.create_task(
            auth_handler.handle_auth_challenge(
                challenge=sample_auth_challenge,
                session_id="session-123",
                server_name="test-server",
                tool_name="test-tool",
                timeout_seconds=5
            )
        )
        
        # Wait for challenge to be registered
        await asyncio.sleep(0.1)
        
        # Get all pending challenges
        all_challenges = await auth_handler.get_pending_challenges()
        assert len(all_challenges) == 1
        
        # Get challenges for specific session
        session_challenges = await auth_handler.get_pending_challenges("session-123")
        assert len(session_challenges) == 1
        
        # Get challenges for different session
        other_challenges = await auth_handler.get_pending_challenges("other-session")
        assert len(other_challenges) == 0
        
        # Cancel the challenge
        challenge_id = list(all_challenges.keys())[0]
        await auth_handler.cancel_challenge(challenge_id)
        
        # Wait for completion
        await challenge_task
        
        # Cleanup
        await auth_handler.shutdown()
    
    @pytest.mark.asyncio
    async def test_cancel_challenge(self, auth_handler, mock_callback, sample_auth_challenge):
        """Test cancelling a pending challenge"""
        
        # Start challenge
        challenge_task = asyncio.create_task(
            auth_handler.handle_auth_challenge(
                challenge=sample_auth_challenge,
                session_id="session-123",
                server_name="test-server",
                tool_name="test-tool",
                timeout_seconds=5
            )
        )
        
        # Wait for challenge to be registered
        await asyncio.sleep(0.1)
        
        # Get challenge ID
        challenges = await auth_handler.get_pending_challenges()
        challenge_id = list(challenges.keys())[0]
        
        # Cancel challenge
        success = await auth_handler.cancel_challenge(challenge_id, "Test cancellation")
        assert success
        
        # Wait for completion
        response = await challenge_task
        
        assert not response.is_success()
        assert "Test cancellation" in response.error
        
        # Cleanup
        await auth_handler.shutdown()
    
    @pytest.mark.asyncio
    async def test_generate_authorization_url(self, auth_handler, sample_auth_challenge):
        """Test generating authorization URL"""
        
        # Without redirect URI
        url = await auth_handler.generate_authorization_url(sample_auth_challenge)
        assert url == sample_auth_challenge.authorization_url
        
        # With redirect URI
        redirect_uri = "https://app.example.com/callback"
        url_with_redirect = await auth_handler.generate_authorization_url(
            sample_auth_challenge, redirect_uri
        )
        assert redirect_uri in url_with_redirect
        
        # Cleanup
        await auth_handler.shutdown()
    
    @pytest.mark.asyncio
    async def test_create_authorization_code(self, auth_handler, mock_callback, 
                                           sample_auth_challenge):
        """Test creating authorization code from challenge"""
        
        # Start challenge
        challenge_task = asyncio.create_task(
            auth_handler.handle_auth_challenge(
                challenge=sample_auth_challenge,
                session_id="session-123",
                server_name="test-server",
                tool_name="test-tool",
                timeout_seconds=5
            )
        )
        
        # Wait for challenge to be registered
        await asyncio.sleep(0.1)
        
        # Get challenge ID
        challenges = await auth_handler.get_pending_challenges()
        challenge_id = list(challenges.keys())[0]
        
        # Create authorization code
        auth_code = await auth_handler.create_authorization_code(
            challenge_id=challenge_id,
            code="auth-code-123",
            session_id="session-123"
        )
        
        assert isinstance(auth_code, AuthorizationCode)
        assert auth_code.code == "auth-code-123"
        assert auth_code.state == sample_auth_challenge.state
        assert auth_code.session_id == "session-123"
        assert not auth_code.is_expired()
        
        # Cancel challenge to complete
        await auth_handler.cancel_challenge(challenge_id)
        await challenge_task
        
        # Cleanup
        await auth_handler.shutdown()
    
    @pytest.mark.asyncio
    async def test_create_authorization_code_validation(self, auth_handler):
        """Test authorization code creation validation"""
        
        # Test non-existent challenge
        with pytest.raises(ValueError, match="No pending challenge found"):
            await auth_handler.create_authorization_code(
                challenge_id="non-existent",
                code="code",
                session_id="session"
            )
        
        # Cleanup
        await auth_handler.shutdown()
    
    @pytest.mark.asyncio
    async def test_get_handler_stats(self, auth_handler, mock_callback, sample_auth_challenge):
        """Test getting handler statistics"""
        
        # Initial stats
        stats = await auth_handler.get_handler_stats()
        assert stats["active_challenges"] == 0
        assert stats["expired_challenges"] == 0
        assert stats["has_callback"] is True
        
        # Start challenge
        challenge_task = asyncio.create_task(
            auth_handler.handle_auth_challenge(
                challenge=sample_auth_challenge,
                session_id="session-123",
                server_name="test-server",
                tool_name="test-tool",
                timeout_seconds=5
            )
        )
        
        # Wait for challenge to be registered
        await asyncio.sleep(0.1)
        
        # Stats with active challenge
        stats = await auth_handler.get_handler_stats()
        assert stats["active_challenges"] == 1
        assert stats["total_futures"] == 1
        
        # Cancel challenge
        challenges = await auth_handler.get_pending_challenges()
        challenge_id = list(challenges.keys())[0]
        await auth_handler.cancel_challenge(challenge_id)
        await challenge_task
        
        # Cleanup
        await auth_handler.shutdown()


class TestAuthChallengeDetector:
    """Test cases for AuthChallengeDetector class"""
    
    def test_is_auth_challenge_valid(self):
        """Test detecting valid auth challenge"""
        response = {
            "type": "auth_challenge",
            "challenge_type": "oauth_authorization_code",
            "authorization_url": "https://auth.example.com/authorize",
            "scope": "read write",
            "state": "state-123"
        }
        
        assert AuthChallengeDetector.is_auth_challenge(response)
    
    def test_is_auth_challenge_invalid(self):
        """Test detecting invalid responses"""
        # Missing type
        response1 = {
            "challenge_type": "oauth_authorization_code",
            "authorization_url": "https://auth.example.com/authorize",
            "scope": "read write",
            "state": "state-123"
        }
        assert not AuthChallengeDetector.is_auth_challenge(response1)
        
        # Wrong type
        response2 = {
            "type": "result",
            "challenge_type": "oauth_authorization_code",
            "authorization_url": "https://auth.example.com/authorize",
            "scope": "read write",
            "state": "state-123"
        }
        assert not AuthChallengeDetector.is_auth_challenge(response2)
        
        # Missing required fields
        response3 = {
            "type": "auth_challenge",
            "challenge_type": "oauth_authorization_code"
        }
        assert not AuthChallengeDetector.is_auth_challenge(response3)
    
    def test_extract_auth_challenge(self):
        """Test extracting AuthChallenge from response"""
        response = {
            "type": "auth_challenge",
            "challenge_type": "oauth_authorization_code",
            "authorization_url": "https://auth.example.com/authorize",
            "scope": "read write",
            "state": "state-123"
        }
        
        challenge = AuthChallengeDetector.extract_auth_challenge(response)
        
        assert isinstance(challenge, AuthChallenge)
        assert challenge.challenge_type == "oauth_authorization_code"
        assert challenge.authorization_url == "https://auth.example.com/authorize"
        assert challenge.scope == "read write"
        assert challenge.state == "state-123"
    
    def test_extract_auth_challenge_invalid(self):
        """Test extracting from invalid response"""
        response = {
            "type": "result",
            "data": "some data"
        }
        
        with pytest.raises(ValueError, match="does not contain a valid auth challenge"):
            AuthChallengeDetector.extract_auth_challenge(response)
    
    def test_create_challenge_response_success(self, sample_auth_challenge):
        """Test creating successful challenge response"""
        response = AuthChallengeDetector.create_challenge_response(
            challenge=sample_auth_challenge,
            authorization_code="auth-code-123"
        )
        
        assert response["type"] == "auth_challenge_response"
        assert response["challenge_type"] == sample_auth_challenge.challenge_type
        assert response["state"] == sample_auth_challenge.state
        assert response["authorization_code"] == "auth-code-123"
        assert "error" not in response
    
    def test_create_challenge_response_error(self, sample_auth_challenge):
        """Test creating error challenge response"""
        response = AuthChallengeDetector.create_challenge_response(
            challenge=sample_auth_challenge,
            error="User denied access"
        )
        
        assert response["type"] == "auth_challenge_response"
        assert response["challenge_type"] == sample_auth_challenge.challenge_type
        assert response["state"] == sample_auth_challenge.state
        assert response["error"] == "User denied access"
        assert "authorization_code" not in response
    
    def test_create_challenge_response_no_data(self, sample_auth_challenge):
        """Test creating challenge response with no data"""
        response = AuthChallengeDetector.create_challenge_response(
            challenge=sample_auth_challenge
        )
        
        assert response["type"] == "auth_challenge_response"
        assert response["challenge_type"] == sample_auth_challenge.challenge_type
        assert response["state"] == sample_auth_challenge.state
        assert response["error"] == "No authorization provided"