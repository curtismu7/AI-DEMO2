"""
Unit tests for OAuth authentication manager components.
"""
import pytest
import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
import aiohttp
from aioresponses import aioresponses

from src.authentication.oauth_manager import (
    DynamicClientRegistration,
    TokenManager,
    UserAuthorizationFacilitator,
    OAuthAuthenticationManager
)
from src.models.auth import ClientCredentials, AccessToken
from src.config.settings import AppConfig, PingOneConfig, SecurityConfig, LangChainConfig

from tests.conftest import TEST_SECURITY_KWARGS


@pytest.fixture
def mock_config():
    """Create a mock configuration for testing."""
    return AppConfig(
        environment="test",
        debug=True,
        log_level="DEBUG",
        pingone=PingOneConfig(
            base_url="https://test-tenant.forgeblocks.com",
            client_registration_endpoint="https://test-tenant.forgeblocks.com/am/oauth2/realms/alpha/register",
            token_endpoint="https://test-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token",
            authorization_endpoint="https://test-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize",
            default_scope="openid profile",
            redirect_uri="https://localhost:8080/callback",
            realm="alpha"
        ),
        security=SecurityConfig(**TEST_SECURITY_KWARGS),
        mcp=MagicMock(),
        chat=MagicMock(),
        langchain=LangChainConfig(),
    )


class TestDynamicClientRegistration:
    """Test cases for DynamicClientRegistration class."""
    
    @pytest.mark.asyncio
    async def test_successful_client_registration(self, mock_config):
        """Test successful client registration with PingOne."""
        registration_response = {
            "client_id": "test-client-id-123",
            "client_secret": "test-client-secret-456",
            "registration_access_token": "test-registration-token-789",
            "client_secret_expires_at": 0  # No expiration
        }
        
        with aioresponses() as m:
            m.post(
                mock_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            async with DynamicClientRegistration(mock_config) as client_reg:
                credentials = await client_reg.register_client()
                
                assert credentials.client_id == "test-client-id-123"
                assert credentials.client_secret == "test-client-secret-456"
                assert credentials.registration_access_token == "test-registration-token-789"
                assert not credentials.is_expired()
    
    @pytest.mark.asyncio
    async def test_client_registration_with_expiration(self, mock_config):
        """Test client registration with expiration timestamp."""
        future_timestamp = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
        registration_response = {
            "client_id": "test-client-id-123",
            "client_secret": "test-client-secret-456",
            "registration_access_token": "test-registration-token-789",
            "client_secret_expires_at": future_timestamp
        }
        
        with aioresponses() as m:
            m.post(
                mock_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            async with DynamicClientRegistration(mock_config) as client_reg:
                credentials = await client_reg.register_client()
                
                assert credentials.client_id == "test-client-id-123"
                assert not credentials.is_expired()
                assert credentials.expires_in_seconds() > 0
    
    @pytest.mark.asyncio
    async def test_client_registration_retry_on_server_error(self, mock_config):
        """Test retry logic on server errors."""
        registration_response = {
            "client_id": "test-client-id-123",
            "client_secret": "test-client-secret-456",
            "registration_access_token": "test-registration-token-789",
            "client_secret_expires_at": 0
        }
        
        with aioresponses() as m:
            # First attempt fails with 500
            m.post(
                mock_config.pingone.client_registration_endpoint,
                status=500,
                payload={"error": "internal_server_error"}
            )
            # Second attempt succeeds
            m.post(
                mock_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            async with DynamicClientRegistration(mock_config) as client_reg:
                credentials = await client_reg.register_client()
                
                assert credentials.client_id == "test-client-id-123"
    
    @pytest.mark.asyncio
    async def test_client_registration_failure_after_retries(self, mock_config):
        """Test failure after exhausting all retry attempts."""
        with aioresponses() as m:
            # All attempts fail with 500
            for _ in range(mock_config.security.max_retry_attempts):
                m.post(
                    mock_config.pingone.client_registration_endpoint,
                    status=500,
                    payload={"error": "internal_server_error"}
                )
            
            async with DynamicClientRegistration(mock_config) as client_reg:
                with pytest.raises(aiohttp.ClientResponseError):
                    await client_reg.register_client()
    
    @pytest.mark.asyncio
    async def test_client_registration_invalid_response(self, mock_config):
        """Test handling of invalid registration response."""
        invalid_response = {
            "error": "invalid_request",
            "error_description": "Missing required parameter"
        }
        
        with aioresponses() as m:
            # Mock all attempts to fail with 400
            for _ in range(mock_config.security.max_retry_attempts):
                m.post(
                    mock_config.pingone.client_registration_endpoint,
                    status=400,
                    payload=invalid_response
                )
            
            async with DynamicClientRegistration(mock_config) as client_reg:
                with pytest.raises(aiohttp.ClientResponseError):
                    await client_reg.register_client()
    
    @pytest.mark.asyncio
    async def test_client_registration_missing_fields(self, mock_config):
        """Test handling of response with missing required fields."""
        incomplete_response = {
            "client_id": "test-client-id-123"
            # Missing client_secret
        }
        
        with aioresponses() as m:
            m.post(
                mock_config.pingone.client_registration_endpoint,
                status=201,
                payload=incomplete_response
            )
            
            async with DynamicClientRegistration(mock_config) as client_reg:
                with pytest.raises(ValueError, match="Invalid registration response"):
                    await client_reg.register_client()
    
    def test_context_manager_usage(self, mock_config):
        """Test that DynamicClientRegistration must be used as context manager."""
        client_reg = DynamicClientRegistration(mock_config)
        
        with pytest.raises(RuntimeError, match="must be used as async context manager"):
            asyncio.run(client_reg.register_client())


class TestTokenManager:
    """Test cases for TokenManager class."""
    
    @pytest.mark.asyncio
    async def test_successful_token_acquisition(self, mock_config):
        """Test successful token acquisition using client credentials."""
        credentials = ClientCredentials(
            client_id="test-client-id",
            client_secret="test-client-secret",
            registration_access_token="test-reg-token",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30)
        )
        
        token_response = {
            "access_token": "test-access-token-123",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile"
        }
        
        with aioresponses() as m:
            m.post(
                mock_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )
            
            async with TokenManager(mock_config) as token_mgr:
                token = await token_mgr.get_client_credentials_token(credentials)
                
                assert token.token == "test-access-token-123"
                assert token.token_type == "Bearer"
                assert token.expires_in == 3600
                assert token.scope == "openid profile"
                assert not token.is_expired()
    
    @pytest.mark.asyncio
    async def test_token_acquisition_with_expired_credentials(self, mock_config):
        """Test token acquisition with expired client credentials."""
        expired_credentials = ClientCredentials(
            client_id="test-client-id",
            client_secret="test-client-secret",
            registration_access_token="test-reg-token",
            expires_at=datetime.now(timezone.utc) - timedelta(days=1)  # Expired
        )
        
        async with TokenManager(mock_config) as token_mgr:
            with pytest.raises(ValueError, match="Client credentials are expired"):
                await token_mgr.get_client_credentials_token(expired_credentials)
    
    @pytest.mark.asyncio
    async def test_token_acquisition_retry_on_server_error(self, mock_config):
        """Test retry logic on server errors during token acquisition."""
        credentials = ClientCredentials(
            client_id="test-client-id",
            client_secret="test-client-secret",
            registration_access_token="test-reg-token",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30)
        )
        
        token_response = {
            "access_token": "test-access-token-123",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile"
        }
        
        with aioresponses() as m:
            # First attempt fails with 503
            m.post(
                mock_config.pingone.token_endpoint,
                status=503,
                payload={"error": "service_unavailable"}
            )
            # Second attempt succeeds
            m.post(
                mock_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )
            
            async with TokenManager(mock_config) as token_mgr:
                token = await token_mgr.get_client_credentials_token(credentials)
                
                assert token.token == "test-access-token-123"
    
    @pytest.mark.asyncio
    async def test_token_acquisition_invalid_credentials(self, mock_config):
        """Test token acquisition with invalid client credentials."""
        credentials = ClientCredentials(
            client_id="invalid-client-id",
            client_secret="invalid-client-secret",
            registration_access_token="test-reg-token",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30)
        )
        
        error_response = {
            "error": "invalid_client",
            "error_description": "Client authentication failed"
        }
        
        with aioresponses() as m:
            # Mock all attempts to fail with 401 (non-retryable error)
            m.post(
                mock_config.pingone.token_endpoint,
                status=401,
                payload=error_response
            )
            
            async with TokenManager(mock_config) as token_mgr:
                with pytest.raises(aiohttp.ClientResponseError):
                    await token_mgr.get_client_credentials_token(credentials)
    
    @pytest.mark.asyncio
    async def test_token_response_parsing_missing_fields(self, mock_config):
        """Test handling of token response with missing required fields."""
        credentials = ClientCredentials(
            client_id="test-client-id",
            client_secret="test-client-secret",
            registration_access_token="test-reg-token",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30)
        )
        
        incomplete_response = {
            "token_type": "Bearer",
            "expires_in": 3600
            # Missing access_token
        }
        
        with aioresponses() as m:
            m.post(
                mock_config.pingone.token_endpoint,
                status=200,
                payload=incomplete_response
            )
            
            async with TokenManager(mock_config) as token_mgr:
                with pytest.raises(ValueError, match="Invalid token response format"):
                    await token_mgr.get_client_credentials_token(credentials)
    
    @pytest.mark.asyncio
    async def test_get_valid_token_uses_cached_token(self, mock_config):
        """Test that get_valid_token uses cached token when available and valid."""
        credentials = ClientCredentials(
            client_id="test-client-id",
            client_secret="test-client-secret",
            registration_access_token="test-reg-token",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30)
        )
        
        token_response = {
            "access_token": "test-access-token-123",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile"
        }
        
        with aioresponses() as m:
            # Only mock one call - if caching works, there should be no second call
            m.post(
                mock_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )
            
            async with TokenManager(mock_config) as token_mgr:
                # First call should fetch token
                token1 = await token_mgr.get_valid_token(credentials)
                
                # Second call should use cached token (no additional HTTP request)
                token2 = await token_mgr.get_valid_token(credentials)
                
                assert token1.token == token2.token
                assert token1 is token2  # Should be the same object
    
    @pytest.mark.asyncio
    async def test_get_valid_token_refreshes_near_expiry_token(self, mock_config):
        """Test that get_valid_token refreshes token when near expiry."""
        credentials = ClientCredentials(
            client_id="test-client-id",
            client_secret="test-client-secret",
            registration_access_token="test-reg-token",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30)
        )
        
        # First token response (near expiry)
        first_token_response = {
            "access_token": "first-token",
            "token_type": "Bearer",
            "expires_in": 200,  # Less than buffer time (300s)
            "scope": "openid profile"
        }
        
        # Second token response (fresh)
        second_token_response = {
            "access_token": "second-token",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile"
        }
        
        with aioresponses() as m:
            # First call
            m.post(
                mock_config.pingone.token_endpoint,
                status=200,
                payload=first_token_response
            )
            # Second call (refresh)
            m.post(
                mock_config.pingone.token_endpoint,
                status=200,
                payload=second_token_response
            )
            
            async with TokenManager(mock_config) as token_mgr:
                # First call gets near-expiry token
                token1 = await token_mgr.get_valid_token(credentials)
                assert token1.token == "first-token"
                
                # Second call should refresh due to near expiry
                token2 = await token_mgr.get_valid_token(credentials)
                assert token2.token == "second-token"
    
    @pytest.mark.asyncio
    async def test_get_valid_token_different_credentials(self, mock_config):
        """Test that get_valid_token fetches new token for different credentials."""
        credentials1 = ClientCredentials(
            client_id="client-1",
            client_secret="secret-1",
            registration_access_token="reg-token-1",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30)
        )
        
        credentials2 = ClientCredentials(
            client_id="client-2",
            client_secret="secret-2",
            registration_access_token="reg-token-2",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30)
        )
        
        token_response1 = {
            "access_token": "token-for-client-1",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile"
        }
        
        token_response2 = {
            "access_token": "token-for-client-2",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile"
        }
        
        with aioresponses() as m:
            m.post(
                mock_config.pingone.token_endpoint,
                status=200,
                payload=token_response1
            )
            m.post(
                mock_config.pingone.token_endpoint,
                status=200,
                payload=token_response2
            )
            
            async with TokenManager(mock_config) as token_mgr:
                # Get token for first client
                token1 = await token_mgr.get_valid_token(credentials1)
                assert token1.token == "token-for-client-1"
                
                # Get token for second client (should fetch new token)
                token2 = await token_mgr.get_valid_token(credentials2)
                assert token2.token == "token-for-client-2"
    
    def test_clear_cached_token(self, mock_config):
        """Test clearing cached token."""
        token_mgr = TokenManager(mock_config)
        
        # Manually set cached token
        token_mgr._current_token = AccessToken(
            token="test-token",
            token_type="Bearer",
            expires_in=3600,
            scope="openid profile",
            issued_at=datetime.now(timezone.utc)
        )
        token_mgr._current_credentials = ClientCredentials(
            client_id="test-client",
            client_secret="test-secret",
            registration_access_token="test-reg-token",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30)
        )
        
        # Clear cache
        token_mgr.clear_cached_token()
        
        assert token_mgr._current_token is None
        assert token_mgr._current_credentials is None


class TestUserAuthorizationFacilitator:
    """Test cases for UserAuthorizationFacilitator class."""
    
    def test_generate_authorization_url(self, mock_config):
        """Test generating authorization URL for MCP server request."""
        facilitator = UserAuthorizationFacilitator(mock_config)
        
        auth_url = facilitator.generate_authorization_url(
            client_id="test-client-123",
            scope="openid profile",
            session_id="session-123",
            mcp_server_id="mcp-server-1"
        )
        
        assert "response_type=code" in auth_url
        assert "client_id=test-client-123" in auth_url
        assert "redirect_uri=" in auth_url
        assert "scope=openid+profile" in auth_url
        assert "state=" in auth_url
        assert mock_config.pingone.authorization_endpoint in auth_url
    
    def test_handle_authorization_callback_success(self, mock_config):
        """Test successful handling of authorization callback."""
        facilitator = UserAuthorizationFacilitator(mock_config)
        
        # First generate authorization URL to create state
        auth_url = facilitator.generate_authorization_url(
            client_id="test-client-123",
            scope="openid profile",
            session_id="session-123",
            mcp_server_id="mcp-server-1"
        )
        
        # Extract state from URL
        from urllib.parse import urlparse, parse_qs
        parsed_url = urlparse(auth_url)
        query_params = parse_qs(parsed_url.query)
        state = query_params["state"][0]
        
        # Handle callback (IN-06: session_id now required)
        auth_data = facilitator.handle_authorization_callback(
            "test-auth-code", state, session_id="session-123"
        )

        assert auth_data["authorization_code"] == "test-auth-code"
        assert auth_data["state"] == state
        assert auth_data["session_id"] == "session-123"
        assert auth_data["mcp_server_id"] == "mcp-server-1"
        assert auth_data["scope"] == "openid profile"
        assert auth_data["client_id"] == "test-client-123"
    
    def test_handle_authorization_callback_invalid_state(self, mock_config):
        """Test handling authorization callback with invalid state."""
        facilitator = UserAuthorizationFacilitator(mock_config)
        
        # IN-06: session_id is required; with a session present, an unknown
        # state still fails the state check (this is what the test asserts).
        with pytest.raises(ValueError, match="Invalid, expired, or session-mismatched state parameter"):
            facilitator.handle_authorization_callback(
                "test-auth-code", "invalid-state", session_id="session-x"
            )
    
    def test_validate_state_success(self, mock_config):
        """Test successful state validation."""
        facilitator = UserAuthorizationFacilitator(mock_config)
        
        # Generate authorization URL to create state
        auth_url = facilitator.generate_authorization_url(
            client_id="test-client-123",
            scope="openid profile",
            session_id="session-123",
            mcp_server_id="mcp-server-1"
        )
        
        # Extract state from URL
        from urllib.parse import urlparse, parse_qs
        parsed_url = urlparse(auth_url)
        query_params = parse_qs(parsed_url.query)
        state = query_params["state"][0]
        
        # Validate state
        is_valid = facilitator.validate_state(state, "session-123")
        assert is_valid
    
    def test_validate_state_wrong_session(self, mock_config):
        """Test state validation with wrong session ID."""
        facilitator = UserAuthorizationFacilitator(mock_config)
        
        # Generate authorization URL to create state
        auth_url = facilitator.generate_authorization_url(
            client_id="test-client-123",
            scope="openid profile",
            session_id="session-123",
            mcp_server_id="mcp-server-1"
        )
        
        # Extract state from URL
        from urllib.parse import urlparse, parse_qs
        parsed_url = urlparse(auth_url)
        query_params = parse_qs(parsed_url.query)
        state = query_params["state"][0]
        
        # Validate state with wrong session ID
        is_valid = facilitator.validate_state(state, "wrong-session")
        assert not is_valid
    
    def test_get_pending_authorization_info(self, mock_config):
        """Test getting pending authorization information."""
        facilitator = UserAuthorizationFacilitator(mock_config)
        
        # Generate authorization URL to create pending authorization
        auth_url = facilitator.generate_authorization_url(
            client_id="test-client-123",
            scope="openid profile",
            session_id="session-123",
            mcp_server_id="mcp-server-1"
        )
        
        # Extract state from URL
        from urllib.parse import urlparse, parse_qs
        parsed_url = urlparse(auth_url)
        query_params = parse_qs(parsed_url.query)
        state = query_params["state"][0]
        
        # Get pending authorization info
        auth_info = facilitator.get_pending_authorization_info(state)
        
        assert auth_info is not None
        assert auth_info["session_id"] == "session-123"
        assert auth_info["mcp_server_id"] == "mcp-server-1"
        assert auth_info["scope"] == "openid profile"
        assert auth_info["client_id"] == "test-client-123"
    
    def test_cleanup_expired_authorizations(self, mock_config):
        """Test cleanup of expired authorization requests."""
        facilitator = UserAuthorizationFacilitator(mock_config)
        
        # Add some expired authorizations manually
        expired_time = datetime.now(timezone.utc) - timedelta(minutes=1)
        facilitator._pending_authorizations["expired-state-1"] = {
            "session_id": "session-1",
            "mcp_server_id": "mcp-1",
            "scope": "openid",
            "client_id": "client-1",
            "created_at": expired_time,
            "expires_at": expired_time
        }
        facilitator._pending_authorizations["expired-state-2"] = {
            "session_id": "session-2",
            "mcp_server_id": "mcp-2",
            "scope": "openid",
            "client_id": "client-2",
            "created_at": expired_time,
            "expires_at": expired_time
        }
        
        # Add a valid authorization
        valid_time = datetime.now(timezone.utc) + timedelta(minutes=5)
        facilitator._pending_authorizations["valid-state"] = {
            "session_id": "session-3",
            "mcp_server_id": "mcp-3",
            "scope": "openid",
            "client_id": "client-3",
            "created_at": datetime.now(timezone.utc),
            "expires_at": valid_time
        }
        
        # Cleanup expired authorizations
        facilitator.cleanup_expired_authorizations()
        
        # Only valid authorization should remain
        assert len(facilitator._pending_authorizations) == 1
        assert "valid-state" in facilitator._pending_authorizations
    
    def test_generate_state_uniqueness(self, mock_config):
        """Test that generated state parameters are unique."""
        facilitator = UserAuthorizationFacilitator(mock_config)
        
        states = set()
        for _ in range(100):
            state = facilitator._generate_state()
            assert len(state) == 32
            assert state not in states
            states.add(state)


class TestOAuthAuthenticationManager:
    """Test cases for the comprehensive OAuthAuthenticationManager class."""

    @pytest.fixture(autouse=True)
    def _use_dcr(self, mock_config):
        """Force DCR path in all OAuthAuthenticationManager tests.

        register_client() normally reads the pre-provisioned client credentials
        from config (PINGONE_USER_CLIENT_ID / AGENT_CLIENT_ID) when
        config.pingone.agent_dcr_enabled is False.  These tests mock the DCR
        HTTP endpoint, so we need the DCR code-path active; mock_config's
        client-credential fields default to "" so the pre-provisioned
        short-circuit stays off.
        """
        mock_config.pingone.agent_dcr_enabled = True

    @pytest.mark.asyncio
    async def test_full_oauth_flow_integration(self, mock_config):
        """Test complete OAuth flow from registration to token acquisition."""
        # Mock client registration response
        registration_response = {
            "client_id": "test-client-id-123",
            "client_secret": "test-client-secret-456",
            "registration_access_token": "test-registration-token-789",
            "client_secret_expires_at": 0
        }
        
        # Mock token response
        token_response = {
            "access_token": "test-access-token-123",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile"
        }
        
        with aioresponses() as m:
            # Mock client registration
            m.post(
                mock_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            # Mock token acquisition
            m.post(
                mock_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )
            
            async with OAuthAuthenticationManager(mock_config) as oauth_mgr:
                # auto_register=True (default) already registered during __aenter__.
                credentials = oauth_mgr.registered_credentials
                assert credentials.client_id == "test-client-id-123"

                # Get access token
                token = await oauth_mgr.get_client_credentials_token()
                assert token.token == "test-access-token-123"

                # Verify cached credentials
                assert oauth_mgr.registered_credentials == credentials
    
    @pytest.mark.asyncio
    async def test_user_authorization_flow(self, mock_config):
        """Test user authorization flow initiation and callback handling."""
        registration_response = {
            "client_id": "test-client-id-123",
            "client_secret": "test-client-secret-456",
            "registration_access_token": "test-registration-token-789",
            "client_secret_expires_at": 0
        }
        
        with aioresponses() as m:
            m.post(
                mock_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            async with OAuthAuthenticationManager(mock_config) as oauth_mgr:
                # auto_register=True (default) already registered during __aenter__.
                # Generate user authorization URL for MCP server
                auth_url = oauth_mgr.generate_user_authorization_url(
                    scope="openid profile",
                    session_id="session-123",
                    mcp_server_id="mcp-server-1"
                )
                
                assert "response_type=code" in auth_url
                assert "client_id=test-client-id-123" in auth_url
                assert "scope=openid+profile" in auth_url
                assert "state=" in auth_url
                
                # Extract state from URL for callback test
                from urllib.parse import urlparse, parse_qs
                parsed_url = urlparse(auth_url)
                query_params = parse_qs(parsed_url.query)
                state = query_params["state"][0]
                
                # Handle authorization callback (IN-06: session_id is mandatory)
                auth_data = oauth_mgr.handle_user_authorization_callback(
                    "test-auth-code", state, session_id="session-123"
                )
                assert auth_data["authorization_code"] == "test-auth-code"
                assert auth_data["session_id"] == "session-123"
                assert auth_data["mcp_server_id"] == "mcp-server-1"
    
    @pytest.mark.asyncio
    async def test_token_caching_and_refresh(self, mock_config):
        """Test token caching and automatic refresh functionality."""
        registration_response = {
            "client_id": "test-client-id-123",
            "client_secret": "test-client-secret-456",
            "registration_access_token": "test-registration-token-789",
            "client_secret_expires_at": 0
        }
        
        token_response = {
            "access_token": "test-access-token-123",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile"
        }
        
        with aioresponses() as m:
            # Mock client registration
            m.post(
                mock_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            # Mock only one token request (caching should prevent second request)
            m.post(
                mock_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )
            
            async with OAuthAuthenticationManager(mock_config) as oauth_mgr:
                # auto_register=True (default) already registered during __aenter__.
                # Get token twice - should use cache for second call
                token1 = await oauth_mgr.get_client_credentials_token()
                token2 = await oauth_mgr.get_client_credentials_token()

                assert token1.token == token2.token
                assert token1 is token2  # Should be same cached object
    
    @pytest.mark.asyncio
    async def test_error_handling_without_registration(self, mock_config):
        """Test error handling when trying to get token without client registration."""
        # auto_register=False skips the __aenter__ registration so we can test
        # the no-credentials error path explicitly.
        async with OAuthAuthenticationManager(mock_config, auto_register=False) as oauth_mgr:
            with pytest.raises(ValueError, match="No client credentials available"):
                await oauth_mgr.get_client_credentials_token()
    
    @pytest.mark.asyncio
    async def test_state_validation(self, mock_config):
        """Test state parameter validation for CSRF protection."""
        registration_response = {
            "client_id": "test-client-id-123",
            "client_secret": "test-client-secret-456",
            "registration_access_token": "test-registration-token-789",
            "client_secret_expires_at": 0
        }
        
        with aioresponses() as m:
            m.post(
                mock_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            async with OAuthAuthenticationManager(mock_config) as oauth_mgr:
                # auto_register=True (default) already registered during __aenter__.
                # Generate authorization URL to create valid state
                auth_url = oauth_mgr.generate_user_authorization_url(
                    scope="openid profile",
                    session_id="session-123",
                    mcp_server_id="mcp-server-1"
                )
                
                # Extract state from URL
                from urllib.parse import urlparse, parse_qs
                parsed_url = urlparse(auth_url)
                query_params = parse_qs(parsed_url.query)
                state = query_params["state"][0]
                
                # Validate correct state
                is_valid = oauth_mgr.validate_authorization_state(state, "session-123")
                assert is_valid
                
                # Validate incorrect session
                is_valid = oauth_mgr.validate_authorization_state(state, "wrong-session")
                assert not is_valid
                
                # Validate invalid state
                is_valid = oauth_mgr.validate_authorization_state("invalid-state", "session-123")
                assert not is_valid
    
    @pytest.mark.asyncio
    async def test_refresh_token_fallback(self, mock_config):
        """Test refresh token method (which falls back to new token for client credentials)."""
        registration_response = {
            "client_id": "test-client-id-123",
            "client_secret": "test-client-secret-456",
            "registration_access_token": "test-registration-token-789",
            "client_secret_expires_at": 0
        }
        
        token_response = {
            "access_token": "test-access-token-123",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile"
        }
        
        with aioresponses() as m:
            m.post(
                mock_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            m.post(
                mock_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )
            
            async with OAuthAuthenticationManager(mock_config) as oauth_mgr:
                # auto_register=True (default) already registered during __aenter__.
                # Refresh token (should get new token via client credentials)
                token = await oauth_mgr.refresh_token("unused-refresh-token")
                assert token.token == "test-access-token-123"
    
    def test_context_manager_requirement(self, mock_config):
        """Test that manager must be used as context manager."""
        oauth_mgr = OAuthAuthenticationManager(mock_config)
        
        with pytest.raises(RuntimeError, match="must be used as async context manager"):
            asyncio.run(oauth_mgr.register_client())