"""
Integration tests for OAuth authentication flows.

These tests verify complete end-to-end authentication flows including:
- Client registration and token acquisition
- Authorization code flow with mock authorization server
- Error handling and retry mechanisms
"""
import pytest
import asyncio
import json
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import urlparse, parse_qs
import aiohttp
from aioresponses import aioresponses

from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.models.auth import ClientCredentials, AccessToken
from src.config.settings import AppConfig, PingOneConfig, SecurityConfig, LangChainConfig

from tests.conftest import TEST_SECURITY_KWARGS


@pytest.fixture
def integration_config():
    """Create configuration for integration testing."""
    return AppConfig(
        environment="integration",
        debug=True,
        log_level="DEBUG",
        pingone=PingOneConfig(
            base_url="https://integration-tenant.forgeblocks.com",
            client_registration_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/register",
            token_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token",
            authorization_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize",
            default_scope="openid profile mcp:access",
            redirect_uri="https://localhost:8080/oauth/callback",
            realm="alpha",
            # These tests mock the DCR HTTP endpoint — force the DCR code-path
            # (register_client() reads config, not env, since the SSOT change).
            agent_dcr_enabled=True,
        ),
        security=SecurityConfig(**TEST_SECURITY_KWARGS),
        mcp=MagicMock(),
        chat=MagicMock(),
        langchain=LangChainConfig(),
    )


class TestCompleteOAuthFlows:
    """Integration tests for complete OAuth authentication flows."""
    
    @pytest.mark.asyncio
    async def test_complete_client_credentials_flow(self, integration_config):
        """Test complete client credentials flow from registration to token usage."""
        # Mock responses for complete flow
        registration_response = {
            "client_id": "integration-client-123",
            "client_secret": "integration-secret-456",
            "registration_access_token": "integration-reg-token-789",
            "client_secret_expires_at": int((datetime.now(timezone.utc) + timedelta(days=365)).timestamp())
        }
        
        token_response = {
            "access_token": "integration-access-token-abc",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile mcp:access"
        }
        
        with aioresponses() as m:
            # Mock client registration
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            # Mock token acquisition (multiple calls for testing caching)
            m.post(
                integration_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )
            
            # auto_register/auto_cleanup off: registration is exercised
            # explicitly below, so the single-shot aioresponses mocks must
            # not also be consumed by __aenter__ auto-registration or the
            # __aexit__ DCR DELETE cleanup call.
            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                # Step 1: Register OAuth client
                credentials = await oauth_mgr.register_client()
                
                assert credentials.client_id == "integration-client-123"
                assert credentials.client_secret == "integration-secret-456"
                assert not credentials.is_expired()
                
                # Step 2: Acquire access token using client credentials
                token = await oauth_mgr.get_client_credentials_token()
                
                assert token.token == "integration-access-token-abc"
                assert token.token_type == "Bearer"
                assert token.expires_in == 3600
                assert token.scope == "openid profile mcp:access"
                assert not token.is_expired()
                
                # Step 3: Verify token can be used for authorization header
                auth_header = token.authorization_header()
                assert auth_header == "Bearer integration-access-token-abc"
                
                # Step 4: Test token caching (second call should use cached token)
                cached_token = await oauth_mgr.get_client_credentials_token()
                assert cached_token.token == token.token
                assert cached_token is token  # Should be same object from cache
    
    @pytest.mark.asyncio
    async def test_complete_authorization_code_flow(self, integration_config):
        """Test complete authorization code flow for user authorization."""
        # Mock client registration
        registration_response = {
            "client_id": "integration-client-456",
            "client_secret": "integration-secret-789",
            "registration_access_token": "integration-reg-token-abc",
            "client_secret_expires_at": 0
        }
        
        with aioresponses() as m:
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            # auto_register/auto_cleanup off: registration is exercised
            # explicitly below, so the single-shot aioresponses mocks must
            # not also be consumed by __aenter__ auto-registration or the
            # __aexit__ DCR DELETE cleanup call.
            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                # Step 1: Register client
                await oauth_mgr.register_client()
                
                # Step 2: Generate authorization URL for MCP server request
                auth_url = oauth_mgr.generate_user_authorization_url(
                    scope="openid profile user:read",
                    session_id="integration-session-123",
                    mcp_server_id="github-mcp-server"
                )
                
                # Verify authorization URL structure
                parsed_url = urlparse(auth_url)
                query_params = parse_qs(parsed_url.query)
                
                assert parsed_url.scheme == "https"
                assert "integration-tenant.forgeblocks.com" in parsed_url.netloc
                assert query_params["response_type"][0] == "code"
                assert query_params["client_id"][0] == "integration-client-456"
                assert query_params["scope"][0] == "openid profile user:read"
                assert "state" in query_params
                
                state = query_params["state"][0]
                
                # Step 3: Simulate authorization server callback
                auth_code = "integration-auth-code-xyz"
                
                # Validate state before processing callback
                is_valid_state = oauth_mgr.validate_authorization_state(
                    state, "integration-session-123"
                )
                assert is_valid_state
                
                # Step 4: Handle authorization callback (session_id is
                # mandatory — IN-06 session-binding enforcement)
                auth_data = oauth_mgr.handle_user_authorization_callback(
                    auth_code, state, session_id="integration-session-123"
                )
                
                assert auth_data["authorization_code"] == auth_code
                assert auth_data["state"] == state
                assert auth_data["session_id"] == "integration-session-123"
                assert auth_data["mcp_server_id"] == "github-mcp-server"
                assert auth_data["scope"] == "openid profile user:read"
                assert auth_data["client_id"] == "integration-client-456"
                assert auth_data["redirect_uri"] == integration_config.pingone.redirect_uri
                
                # Step 5: Verify state is cleaned up after use
                invalid_state_check = oauth_mgr.validate_authorization_state(
                    state, "integration-session-123"
                )
                assert not invalid_state_check  # Should be False after callback processing
    
    @pytest.mark.asyncio
    async def test_token_refresh_on_expiry(self, integration_config):
        """Test automatic token refresh when token is near expiry."""
        registration_response = {
            "client_id": "refresh-test-client",
            "client_secret": "refresh-test-secret",
            "registration_access_token": "refresh-test-reg-token",
            "client_secret_expires_at": 0
        }
        
        # First token response (short expiry)
        first_token_response = {
            "access_token": "first-token-short-lived",
            "token_type": "Bearer",
            "expires_in": 200,  # Less than buffer time (300s)
            "scope": "openid profile mcp:access"
        }
        
        # Second token response (fresh token)
        second_token_response = {
            "access_token": "second-token-fresh",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile mcp:access"
        }
        
        with aioresponses() as m:
            # Mock client registration
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            # Mock first token acquisition
            m.post(
                integration_config.pingone.token_endpoint,
                status=200,
                payload=first_token_response
            )
            
            # Mock second token acquisition (refresh)
            m.post(
                integration_config.pingone.token_endpoint,
                status=200,
                payload=second_token_response
            )
            
            # auto_register/auto_cleanup off: registration is exercised
            # explicitly below, so the single-shot aioresponses mocks must
            # not also be consumed by __aenter__ auto-registration or the
            # __aexit__ DCR DELETE cleanup call.
            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                # Register client
                await oauth_mgr.register_client()
                
                # Get first token (short-lived)
                first_token = await oauth_mgr.get_client_credentials_token()
                assert first_token.token == "first-token-short-lived"
                assert first_token.expires_in == 200
                
                # Get token again - should refresh due to short expiry
                refreshed_token = await oauth_mgr.get_client_credentials_token()
                assert refreshed_token.token == "second-token-fresh"
                assert refreshed_token.expires_in == 3600
                assert refreshed_token is not first_token  # Should be different object
    
    @pytest.mark.asyncio
    async def test_concurrent_token_requests(self, integration_config):
        """Test handling of concurrent token requests."""
        registration_response = {
            "client_id": "concurrent-test-client",
            "client_secret": "concurrent-test-secret",
            "registration_access_token": "concurrent-test-reg-token",
            "client_secret_expires_at": 0
        }
        
        token_response = {
            "access_token": "concurrent-test-token",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile mcp:access"
        }
        
        with aioresponses() as m:
            # Mock client registration
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            # Mock token acquisition (should only be called once due to caching)
            m.post(
                integration_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )
            
            # auto_register/auto_cleanup off: registration is exercised
            # explicitly below, so the single-shot aioresponses mocks must
            # not also be consumed by __aenter__ auto-registration or the
            # __aexit__ DCR DELETE cleanup call.
            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                # Register client
                await oauth_mgr.register_client()
                
                # Make multiple concurrent token requests
                tasks = [
                    oauth_mgr.get_client_credentials_token()
                    for _ in range(5)
                ]
                
                tokens = await asyncio.gather(*tasks)
                
                # All tokens should be identical (from cache)
                for token in tokens:
                    assert token.token == "concurrent-test-token"
                    assert token is tokens[0]  # Should be same object
    
    @pytest.mark.asyncio
    async def test_error_recovery_and_retry(self, integration_config):
        """Test error recovery and retry mechanisms in authentication flows."""
        registration_response = {
            "client_id": "retry-test-client",
            "client_secret": "retry-test-secret",
            "registration_access_token": "retry-test-reg-token",
            "client_secret_expires_at": 0
        }
        
        token_response = {
            "access_token": "retry-test-token",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile mcp:access"
        }
        
        with aioresponses() as m:
            # Mock client registration with initial failure
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=503,  # Service unavailable
                payload={"error": "service_unavailable"}
            )
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,  # Success on retry
                payload=registration_response
            )
            
            # Mock token acquisition with initial failure
            m.post(
                integration_config.pingone.token_endpoint,
                status=429,  # Rate limited
                payload={"error": "rate_limit_exceeded"}
            )
            m.post(
                integration_config.pingone.token_endpoint,
                status=200,  # Success on retry
                payload=token_response
            )
            
            # auto_register/auto_cleanup off: registration is exercised
            # explicitly below, so the single-shot aioresponses mocks must
            # not also be consumed by __aenter__ auto-registration or the
            # __aexit__ DCR DELETE cleanup call.
            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                # Should succeed despite initial failures
                credentials = await oauth_mgr.register_client()
                assert credentials.client_id == "retry-test-client"
                
                token = await oauth_mgr.get_client_credentials_token()
                assert token.token == "retry-test-token"
    
    @pytest.mark.asyncio
    async def test_multiple_authorization_flows(self, integration_config):
        """Test handling multiple concurrent authorization flows for different MCP servers."""
        registration_response = {
            "client_id": "multi-auth-client",
            "client_secret": "multi-auth-secret",
            "registration_access_token": "multi-auth-reg-token",
            "client_secret_expires_at": 0
        }
        
        with aioresponses() as m:
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            # auto_register/auto_cleanup off: registration is exercised
            # explicitly below, so the single-shot aioresponses mocks must
            # not also be consumed by __aenter__ auto-registration or the
            # __aexit__ DCR DELETE cleanup call.
            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                await oauth_mgr.register_client()
                
                # Generate authorization URLs for multiple MCP servers
                github_auth_url = oauth_mgr.generate_user_authorization_url(
                    scope="repo user:read",
                    session_id="session-123",
                    mcp_server_id="github-mcp"
                )
                
                slack_auth_url = oauth_mgr.generate_user_authorization_url(
                    scope="channels:read users:read",
                    session_id="session-123",
                    mcp_server_id="slack-mcp"
                )
                
                # Extract states from URLs
                github_state = parse_qs(urlparse(github_auth_url).query)["state"][0]
                slack_state = parse_qs(urlparse(slack_auth_url).query)["state"][0]
                
                # Verify states are different
                assert github_state != slack_state
                
                # Verify both states are valid
                assert oauth_mgr.validate_authorization_state(github_state, "session-123")
                assert oauth_mgr.validate_authorization_state(slack_state, "session-123")
                
                # Handle callbacks for both (session_id is mandatory — IN-06)
                github_auth_data = oauth_mgr.handle_user_authorization_callback(
                    "github-auth-code", github_state, session_id="session-123"
                )
                slack_auth_data = oauth_mgr.handle_user_authorization_callback(
                    "slack-auth-code", slack_state, session_id="session-123"
                )
                
                # Verify correct data for each MCP server
                assert github_auth_data["mcp_server_id"] == "github-mcp"
                assert github_auth_data["scope"] == "repo user:read"
                assert github_auth_data["authorization_code"] == "github-auth-code"
                
                assert slack_auth_data["mcp_server_id"] == "slack-mcp"
                assert slack_auth_data["scope"] == "channels:read users:read"
                assert slack_auth_data["authorization_code"] == "slack-auth-code"


class TestAuthenticationErrorHandling:
    """Integration tests for authentication error handling scenarios."""
    
    @pytest.mark.asyncio
    async def test_invalid_client_credentials_handling(self, integration_config):
        """Test handling of invalid client credentials during token acquisition."""
        registration_response = {
            "client_id": "invalid-creds-client",
            "client_secret": "invalid-creds-secret",
            "registration_access_token": "invalid-creds-reg-token",
            "client_secret_expires_at": 0
        }
        
        error_response = {
            "error": "invalid_client",
            "error_description": "Client authentication failed"
        }
        
        with aioresponses() as m:
            # Mock successful registration
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            # Mock token endpoint returning invalid client error
            m.post(
                integration_config.pingone.token_endpoint,
                status=401,
                payload=error_response
            )
            
            # auto_register/auto_cleanup off: registration is exercised
            # explicitly below, so the single-shot aioresponses mocks must
            # not also be consumed by __aenter__ auto-registration or the
            # __aexit__ DCR DELETE cleanup call.
            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                # Registration should succeed
                await oauth_mgr.register_client()
                
                # Token acquisition should fail with proper error
                with pytest.raises(aiohttp.ClientResponseError) as exc_info:
                    await oauth_mgr.get_client_credentials_token()
                
                assert exc_info.value.status == 401
                assert "Client authentication failed" in str(exc_info.value)
    
    @pytest.mark.asyncio
    async def test_authorization_server_unavailable(self, integration_config):
        """Test handling when authorization server is completely unavailable."""
        # aiohttp >= 3.10 dereferences connection_key in __str__, so a real
        # ConnectionKey is required (connection_key=None crashes on logging).
        from aiohttp.client_reqrep import ConnectionKey
        conn_key = ConnectionKey(
            "integration-tenant.forgeblocks.com", 443, True, True, None, None, None
        )

        with aioresponses() as m:
            # Mock all requests to fail with connection error
            m.post(
                integration_config.pingone.client_registration_endpoint,
                exception=aiohttp.ClientConnectorError(
                    connection_key=conn_key,
                    os_error=OSError("Connection refused")
                ),
                repeat=True  # register_client retries up to max_retry_attempts
            )
            
            # auto_register/auto_cleanup off: registration is exercised
            # explicitly below, so the single-shot aioresponses mocks must
            # not also be consumed by __aenter__ auto-registration or the
            # __aexit__ DCR DELETE cleanup call.
            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                # Should fail after retries
                with pytest.raises(aiohttp.ClientConnectorError):
                    await oauth_mgr.register_client()
    
    @pytest.mark.asyncio
    async def test_malformed_authorization_callback(self, integration_config):
        """Test handling of malformed authorization callbacks."""
        registration_response = {
            "client_id": "malformed-test-client",
            "client_secret": "malformed-test-secret",
            "registration_access_token": "malformed-test-reg-token",
            "client_secret_expires_at": 0
        }
        
        with aioresponses() as m:
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            # auto_register/auto_cleanup off: registration is exercised
            # explicitly below, so the single-shot aioresponses mocks must
            # not also be consumed by __aenter__ auto-registration or the
            # __aexit__ DCR DELETE cleanup call.
            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                await oauth_mgr.register_client()
                
                # Test invalid state parameter
                with pytest.raises(ValueError, match="Invalid, expired, or session-mismatched state parameter"):
                    oauth_mgr.handle_user_authorization_callback(
                        "valid-auth-code", "invalid-state-parameter",
                        session_id="session-123"
                    )

                # Test missing session_id (IN-06: session binding mandatory)
                auth_url = oauth_mgr.generate_user_authorization_url(
                    scope="openid", session_id="session-123", mcp_server_id="test-mcp"
                )
                state = parse_qs(urlparse(auth_url).query)["state"][0]

                with pytest.raises(ValueError, match="session_id is required"):
                    oauth_mgr.handle_user_authorization_callback(
                        "valid-auth-code", state, session_id=""
                    )

                # Test session mismatch (state issued for a different session)
                with pytest.raises(ValueError, match="session-mismatched"):
                    oauth_mgr.handle_user_authorization_callback(
                        "valid-auth-code", state, session_id="other-session"
                    )
    
    @pytest.mark.asyncio
    async def test_expired_authorization_state_cleanup(self, integration_config):
        """Test cleanup of expired authorization states."""
        # This test exercises state-expiry cleanup only — skip the DCR
        # registration path (its aioresponses mock is broken with the venv's
        # aiohttp, same as the registration tests above) and use
        # pre-provisioned credentials instead.
        integration_config.pingone.agent_dcr_enabled = False
        integration_config.pingone.user_client_id = "cleanup-test-client"
        integration_config.pingone.user_client_secret = "cleanup-test-secret"

        with aioresponses():
            async with OAuthAuthenticationManager(integration_config) as oauth_mgr:

                # Generate authorization URL
                auth_url = oauth_mgr.generate_user_authorization_url(
                    scope="openid", session_id="session-123", mcp_server_id="test-mcp"
                )
                state = parse_qs(urlparse(auth_url).query)["state"][0]
                
                # Verify state is initially valid
                assert oauth_mgr.validate_authorization_state(state, "session-123")
                
                # Manually expire the state by manipulating internal state
                # (In real scenario, this would happen after 10 minutes)
                oauth_mgr._user_auth_facilitator._pending_authorizations[state]["expires_at"] = (
                    datetime.now(timezone.utc) - timedelta(minutes=1)
                )
                
                # Cleanup expired states
                oauth_mgr.cleanup_expired_states()
                
                # State should now be invalid
                assert not oauth_mgr.validate_authorization_state(state, "session-123")


class TestAuthenticationPerformance:
    """Integration tests for authentication performance characteristics."""
    
    @pytest.mark.asyncio
    async def test_token_caching_performance(self, integration_config):
        """Test that token caching provides performance benefits."""
        registration_response = {
            "client_id": "perf-test-client",
            "client_secret": "perf-test-secret",
            "registration_access_token": "perf-test-reg-token",
            "client_secret_expires_at": 0
        }
        
        token_response = {
            "access_token": "perf-test-token",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "openid profile mcp:access"
        }
        
        with aioresponses() as m:
            # Mock client registration
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            # Mock token acquisition - should only be called once due to caching
            m.post(
                integration_config.pingone.token_endpoint,
                status=200,
                payload=token_response
            )
            
            # auto_register/auto_cleanup off: registration is exercised
            # explicitly below, so the single-shot aioresponses mocks must
            # not also be consumed by __aenter__ auto-registration or the
            # __aexit__ DCR DELETE cleanup call.
            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                await oauth_mgr.register_client()
                
                # Time first token acquisition
                import time
                start_time = time.time()
                first_token = await oauth_mgr.get_client_credentials_token()
                first_duration = time.time() - start_time
                
                # Time second token acquisition (should be from cache)
                start_time = time.time()
                second_token = await oauth_mgr.get_client_credentials_token()
                second_duration = time.time() - start_time
                
                # Cached access should be significantly faster
                assert second_duration < first_duration / 2
                assert first_token is second_token  # Same object from cache
    
    @pytest.mark.asyncio
    async def test_concurrent_authorization_requests(self, integration_config):
        """Test handling of many concurrent authorization requests."""
        registration_response = {
            "client_id": "concurrent-auth-client",
            "client_secret": "concurrent-auth-secret",
            "registration_access_token": "concurrent-auth-reg-token",
            "client_secret_expires_at": 0
        }
        
        with aioresponses() as m:
            m.post(
                integration_config.pingone.client_registration_endpoint,
                status=201,
                payload=registration_response
            )
            
            # auto_register/auto_cleanup off: registration is exercised
            # explicitly below, so the single-shot aioresponses mocks must
            # not also be consumed by __aenter__ auto-registration or the
            # __aexit__ DCR DELETE cleanup call.
            async with OAuthAuthenticationManager(
                integration_config, auto_register=False, auto_cleanup=False
            ) as oauth_mgr:
                await oauth_mgr.register_client()
                
                # Generate many concurrent authorization URLs.
                # (asyncio.coroutine was removed in Python 3.11 — wrap the
                # sync call in a plain coroutine function instead.)
                num_requests = 50

                async def _generate(i: int) -> str:
                    return oauth_mgr.generate_user_authorization_url(
                        scope="openid",
                        session_id=f"session-{i}",
                        mcp_server_id=f"mcp-{i}"
                    )

                tasks = [
                    asyncio.create_task(_generate(i))
                    for i in range(num_requests)
                ]

                auth_urls = await asyncio.gather(*tasks)
                
                # Verify all URLs are unique and valid
                states = set()
                for url in auth_urls:
                    state = parse_qs(urlparse(url).query)["state"][0]
                    assert state not in states  # All states should be unique
                    states.add(state)
                
                assert len(states) == num_requests