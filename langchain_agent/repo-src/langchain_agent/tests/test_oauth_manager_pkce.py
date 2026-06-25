"""
CR-05 regression: the langchain authorization-code flow MUST use PKCE S256.

PKCE S256 is mandatory for every authorization code flow, no exceptions
(RFC 9700 / OAuth 2.1; oauth-pingone skill §4c — PingOne enforces
pkceEnforcement=S256_REQUIRED). These tests pin the client-side contract:

  * the authorize URL carries code_challenge + code_challenge_method=S256
  * code_challenge == base64url(SHA256(code_verifier)) with no padding
  * the verifier is per-request (fresh each call), single-use (consumed with
    the state on callback), and correlated to the issuing state
  * the code->token exchange data surfaces the matching code_verifier so the
    exchanger can forward it (RFC 7636 §4.5)

The IdP rejects a missing/mismatched verifier on the exchange — that is the
authorization server's job. The client-side guarantee asserted here is that
langchain *sends* a correct S256 challenge and forwards the paired verifier.
"""
import base64
import hashlib
from urllib.parse import urlparse, parse_qs

import pytest
from unittest.mock import MagicMock

from src.authentication.oauth_manager import UserAuthorizationFacilitator
from src.config.settings import AppConfig, PingOneConfig, SecurityConfig, LangChainConfig

from tests.conftest import TEST_SECURITY_KWARGS


@pytest.fixture
def mock_config():
    """Mock config mirroring tests/test_oauth_manager.py::mock_config."""
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
            realm="alpha",
        ),
        security=SecurityConfig(**TEST_SECURITY_KWARGS),
        mcp=MagicMock(),
        chat=MagicMock(),
        langchain=LangChainConfig(),
    )


def _params(auth_url: str) -> dict:
    return parse_qs(urlparse(auth_url).query)


def _expected_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


class TestAuthorizationUrlPKCE:
    """The authorize URL must carry an S256 PKCE challenge."""

    def test_auth_url_contains_code_challenge_and_s256_method(self, mock_config):
        facilitator = UserAuthorizationFacilitator(mock_config)

        auth_url = facilitator.generate_authorization_url(
            client_id="test-client-123",
            scope="banking:accounts:read",
            session_id="session-123",
            mcp_server_id="mcp-server-1",
        )

        params = _params(auth_url)
        assert params["code_challenge_method"] == ["S256"]
        assert "code_challenge" in params
        challenge = params["code_challenge"][0]
        assert challenge, "code_challenge must be non-empty"
        # base64url, no padding: must not contain '+', '/', or '='
        assert "+" not in challenge and "/" not in challenge and "=" not in challenge
        # never leak the raw verifier in the URL
        assert "code_verifier" not in params

    def test_challenge_is_s256_of_stored_verifier(self, mock_config):
        facilitator = UserAuthorizationFacilitator(mock_config)

        auth_url = facilitator.generate_authorization_url(
            client_id="test-client-123",
            scope="banking:accounts:read",
            session_id="session-123",
            mcp_server_id="mcp-server-1",
        )

        params = _params(auth_url)
        state = params["state"][0]
        verifier = facilitator._pending_authorizations[state]["code_verifier"]

        # RFC 7636 §4.1: verifier 43-128 chars, URL-safe
        assert 43 <= len(verifier) <= 128
        # mirrors the BFF strength: secrets.token_hex(64) == 128 hex chars
        assert len(verifier) == 128
        assert all(c in "0123456789abcdef" for c in verifier)

        # RFC 7636 §4.2: challenge == base64url(SHA256(verifier)), no padding
        assert params["code_challenge"][0] == _expected_challenge(verifier)

    def test_verifier_is_per_request_fresh(self, mock_config):
        facilitator = UserAuthorizationFacilitator(mock_config)

        url1 = facilitator.generate_authorization_url(
            client_id="c", scope="s", session_id="sess", mcp_server_id="m"
        )
        url2 = facilitator.generate_authorization_url(
            client_id="c", scope="s", session_id="sess", mcp_server_id="m"
        )

        s1 = _params(url1)["state"][0]
        s2 = _params(url2)["state"][0]
        v1 = facilitator._pending_authorizations[s1]["code_verifier"]
        v2 = facilitator._pending_authorizations[s2]["code_verifier"]

        assert s1 != s2
        assert v1 != v2, "each authorization request must use a fresh verifier"
        assert _params(url1)["code_challenge"] != _params(url2)["code_challenge"]


class TestCallbackForwardsVerifier:
    """The callback must surface the matching verifier, single-use."""

    def test_callback_returns_matching_code_verifier(self, mock_config):
        facilitator = UserAuthorizationFacilitator(mock_config)

        auth_url = facilitator.generate_authorization_url(
            client_id="test-client-123",
            scope="banking:accounts:read",
            session_id="session-123",
            mcp_server_id="mcp-server-1",
        )
        params = _params(auth_url)
        state = params["state"][0]
        expected_verifier = facilitator._pending_authorizations[state]["code_verifier"]

        auth_data = facilitator.handle_authorization_callback(
            "the-auth-code", state, session_id="session-123"
        )

        assert auth_data["code_verifier"] == expected_verifier
        assert params["code_challenge"][0] == _expected_challenge(
            auth_data["code_verifier"]
        )
        # CSRF/state binding must not regress
        assert auth_data["authorization_code"] == "the-auth-code"
        assert auth_data["state"] == state
        assert auth_data["session_id"] == "session-123"

    def test_verifier_is_single_use(self, mock_config):
        facilitator = UserAuthorizationFacilitator(mock_config)

        auth_url = facilitator.generate_authorization_url(
            client_id="test-client-123",
            scope="banking:accounts:read",
            session_id="session-123",
            mcp_server_id="mcp-server-1",
        )
        state = _params(auth_url)["state"][0]

        # First consumption succeeds and forwards the verifier.
        first = facilitator.handle_authorization_callback(
            "code-1", state, session_id="session-123"
        )
        assert first["code_verifier"]

        # State (and its verifier) are consumed — a replay must be rejected,
        # so the verifier can never be reused for a second exchange.
        assert state not in facilitator._pending_authorizations
        with pytest.raises(ValueError, match="Invalid, expired, or session-mismatched state parameter"):
            facilitator.handle_authorization_callback(
                "code-2", state, session_id="session-123"
            )

    def test_session_bound_callback_still_forwards_verifier(self, mock_config):
        """BL-03 session-binding path must also surface the verifier."""
        facilitator = UserAuthorizationFacilitator(mock_config)

        auth_url = facilitator.generate_authorization_url(
            client_id="test-client-123",
            scope="banking:accounts:read",
            session_id="session-xyz",
            mcp_server_id="mcp-server-1",
        )
        state = _params(auth_url)["state"][0]
        expected_verifier = facilitator._pending_authorizations[state]["code_verifier"]

        auth_data = facilitator.handle_authorization_callback(
            "the-auth-code", state, session_id="session-xyz"
        )
        assert auth_data["code_verifier"] == expected_verifier

    def test_wrong_session_rejected_before_verifier_exposed(self, mock_config):
        """A mismatched session must be refused — no verifier leakage."""
        facilitator = UserAuthorizationFacilitator(mock_config)

        auth_url = facilitator.generate_authorization_url(
            client_id="test-client-123",
            scope="banking:accounts:read",
            session_id="session-real",
            mcp_server_id="mcp-server-1",
        )
        state = _params(auth_url)["state"][0]

        with pytest.raises(ValueError):
            facilitator.handle_authorization_callback(
                "the-auth-code", state, session_id="session-attacker"
            )
