"""
OAuth authentication manager.

By default reads pre-provisioned PingOne credentials from the environment
(PINGONE_USER_CLIENT_ID/SECRET or AGENT_CLIENT_ID/SECRET), which the repo's
`npm run pingone:bootstrap` provisions via the PingOne Management API.

The DynamicClientRegistration class below targets ForgeRock DCR endpoints
(/am/oauth2/realms/...). PingOne does not expose those, so DCR is opt-in
via AGENT_DCR_ENABLED=true and only useful against a real ForgeRock tenant.
"""

import asyncio
import base64
import hashlib
import json
import logging
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlencode, urlparse

import aiohttp
from config.settings import get_config
from models.auth import AccessToken, ClientCredentials

from .interfaces import AuthenticationProvider

logger = logging.getLogger(__name__)


class DynamicClientRegistration:
    """Handles dynamic client registration with PingOne AI IAM Core (ForgeRock)."""

    def __init__(self, config=None):
        self.config = config or get_config()
        self.session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        """Async context manager entry."""
        self.session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.session:
            await self.session.close()

    async def register_client(
        self, additional_scopes: Optional[List[str]] = None
    ) -> ClientCredentials:
        """
        Register a new OAuth client with PingOne AI IAM Core (ForgeRock).

        Args:
            additional_scopes: Optional list of additional scopes to request beyond default

        Returns:
            ClientCredentials: The registered client credentials

        Raises:
            aiohttp.ClientError: If registration request fails
            ValueError: If response is invalid
        """
        if not self.session:
            raise RuntimeError(
                "DynamicClientRegistration must be used as async context manager"
            )

        # Build scope string with additional scopes
        scopes = [self.config.pingone.default_scope, "ai_agent"]
        if additional_scopes:
            scopes.extend(additional_scopes)
        scope_string = " ".join(scopes)

        # ForgeRock Dynamic Client Registration payload
        registration_data = {
            "client_name": "LangChain MCP OAuth Agent",
            "client_uri": "https://github.com/langchain/mcp-oauth-agent",
            "redirect_uris": [self.config.pingone.redirect_uri],
            "grant_types": ["client_credentials", "authorization_code"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "client_secret_basic",
            "scope": scope_string,
            "application_type": "web",
            "subject_type": "public",
        }

        headers = {"Content-Type": "application/json", "Accept": "application/json"}

        max_retries = self.config.security.max_retry_attempts
        backoff_seconds = self.config.security.retry_backoff_seconds

        for attempt in range(max_retries):
            try:
                logger.info(
                    f"Attempting client registration (attempt {attempt + 1}/{max_retries})"
                )

                async with self.session.post(
                    self.config.pingone.client_registration_endpoint,
                    json=registration_data,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status == 201:
                        response_data = await response.json()
                        return self._parse_registration_response(response_data)

                    elif response.status in [429, 500, 502, 503, 504]:
                        # Retryable errors
                        if attempt < max_retries - 1:
                            wait_time = backoff_seconds * (2**attempt)
                            logger.warning(
                                f"Registration failed with status {response.status}, retrying in {wait_time}s"
                            )
                            await asyncio.sleep(wait_time)
                            continue

                    # Non-retryable error or max retries reached
                    error_text = await response.text()
                    logger.error(
                        f"Client registration failed with status {response.status}: {error_text}"
                    )
                    raise aiohttp.ClientResponseError(
                        request_info=response.request_info,
                        history=response.history,
                        status=response.status,
                        message=f"Client registration failed: {error_text}",
                    )

            except aiohttp.ClientError as e:
                if attempt < max_retries - 1:
                    wait_time = backoff_seconds * (2**attempt)
                    logger.warning(
                        f"Registration request failed: {e}, retrying in {wait_time}s"
                    )
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.error(
                        f"Client registration failed after {max_retries} attempts: {e}"
                    )
                    raise

        raise RuntimeError("Client registration failed after all retry attempts")

    async def delete_client(self, client_credentials: ClientCredentials) -> bool:
        """
        Delete a dynamically registered OAuth client from ForgeRock.

        Args:
            client_credentials: The client credentials containing registration_access_token

        Returns:
            bool: True if deletion was successful

        Raises:
            aiohttp.ClientError: If deletion request fails
            ValueError: If registration_access_token is missing
        """
        if not self.session:
            raise RuntimeError(
                "DynamicClientRegistration must be used as async context manager"
            )

        if not client_credentials.registration_access_token:
            raise ValueError(
                "Missing registration_access_token required for client deletion"
            )

        # Build the registration client URI
        registration_uri = f"{self.config.pingone.client_registration_endpoint}?client_id={client_credentials.client_id}"

        headers = {
            "Authorization": f"Bearer {client_credentials.registration_access_token}",
            "Accept": "application/json",
        }

        max_retries = self.config.security.max_retry_attempts
        backoff_seconds = self.config.security.retry_backoff_seconds

        for attempt in range(max_retries):
            try:
                logger.info(
                    f"Attempting client deletion for {client_credentials.client_id} (attempt {attempt + 1}/{max_retries})"
                )

                async with self.session.delete(
                    registration_uri,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status == 204:
                        # 204 No Content = successful deletion
                        logger.info(
                            f"Successfully deleted client {client_credentials.client_id}"
                        )
                        return True

                    elif response.status == 404:
                        # Client already deleted or doesn't exist
                        logger.warning(
                            f"Client {client_credentials.client_id} not found (may already be deleted)"
                        )
                        return True

                    elif response.status in [429, 500, 502, 503, 504]:
                        # Retryable errors
                        if attempt < max_retries - 1:
                            wait_time = backoff_seconds * (2**attempt)
                            logger.warning(
                                f"Deletion failed with status {response.status}, retrying in {wait_time}s"
                            )
                            await asyncio.sleep(wait_time)
                            continue

                    # Non-retryable error or max retries reached
                    error_text = await response.text()
                    logger.error(
                        f"Client deletion failed with status {response.status}: {error_text}"
                    )
                    raise aiohttp.ClientResponseError(
                        request_info=response.request_info,
                        history=response.history,
                        status=response.status,
                        message=f"Client deletion failed: {error_text}",
                    )

            except aiohttp.ClientError as e:
                if attempt < max_retries - 1:
                    wait_time = backoff_seconds * (2**attempt)
                    logger.warning(
                        f"Deletion request failed: {e}, retrying in {wait_time}s"
                    )
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.error(
                        f"Client deletion failed after {max_retries} attempts: {e}"
                    )
                    raise

        raise RuntimeError("Client deletion failed after all retry attempts")

    def _parse_registration_response(
        self, response_data: Dict[str, Any]
    ) -> ClientCredentials:
        """
        Parse the client registration response from ForgeRock.

        Args:
            response_data: The JSON response from the registration endpoint

        Returns:
            ClientCredentials: Parsed client credentials

        Raises:
            ValueError: If response format is invalid
        """
        try:
            client_id = response_data["client_id"]
            client_secret = response_data["client_secret"]
            registration_access_token = response_data.get(
                "registration_access_token", ""
            )

            # ForgeRock uses client_secret_expires_at (Unix timestamp) or no expiration
            expires_in = response_data.get("client_secret_expires_at", 0)
            if expires_in == 0:
                # No expiration specified, set to 1 year from now (ForgeRock default)
                expires_at = datetime.now(timezone.utc) + timedelta(days=365)
            else:
                # Convert Unix timestamp to datetime
                expires_at = datetime.fromtimestamp(expires_in, tz=timezone.utc)

            credentials = ClientCredentials(
                client_id=client_id,
                client_secret=client_secret,
                registration_access_token=registration_access_token,
                expires_at=expires_at,
            )

            logger.info(
                f"Successfully registered ForgeRock client {client_id}, expires at {expires_at}"
            )
            return credentials

        except KeyError as e:
            logger.error(
                f"Missing required field in ForgeRock registration response: {e}"
            )
            raise ValueError(f"Invalid registration response: missing {e}")
        except Exception as e:
            logger.error(f"Failed to parse ForgeRock registration response: {e}")
            raise ValueError(f"Invalid registration response format: {e}")


class TokenManager:
    """Manages OAuth token acquisition and refresh for agent authentication."""

    def __init__(self, config=None):
        self.config = config or get_config()
        self.session: Optional[aiohttp.ClientSession] = None
        self._current_token: Optional[AccessToken] = None
        self._current_credentials: Optional[ClientCredentials] = None
        # Track the scope key that was used when the token was fetched.
        # Cache hit comparison must use the requested scope key, not the
        # server-returned scope string (which may differ, e.g. "openid profile"
        # vs an empty requested set), to avoid spurious cache misses.
        self._current_scope_key: Optional[str] = None
        # HI-02: serialize concurrent get_valid_token() callers so two
        # parallel tool calls don't both miss the cache and double-fetch
        # against the token endpoint (which then rate-limits at 429).
        # Deferred to __aenter__ so that constructing TokenManager outside a
        # running event loop (e.g. in sync test setup) does not raise on
        # Python 3.9, which requires an active loop when asyncio.Lock() is
        # called in __init__.
        self._refresh_lock: Optional[asyncio.Lock] = None

    async def __aenter__(self):
        """Async context manager entry."""
        self.session = aiohttp.ClientSession()
        # Create the lock here (inside a running event loop) so that
        # constructing TokenManager synchronously (e.g. in test setUp) works
        # on Python 3.9, which requires an active loop for asyncio.Lock().
        self._refresh_lock = asyncio.Lock()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.session:
            await self.session.close()

    async def get_client_credentials_token(
        self,
        client_credentials: ClientCredentials,
        additional_scopes: Optional[List[str]] = None,
    ) -> AccessToken:
        """
        Obtain an access token using client credentials flow.

        Args:
            client_credentials: The client credentials to use for authentication
            additional_scopes: Optional list of additional scopes to request beyond default

        Returns:
            AccessToken: The obtained access token

        Raises:
            aiohttp.ClientError: If token request fails
            ValueError: If credentials are expired or response is invalid
        """
        if not self.session:
            raise RuntimeError("TokenManager must be used as async context manager")

        if client_credentials.is_expired():
            raise ValueError("Client credentials are expired")

        # Build scope string — client_credentials tokens should not include openid (OIDC user scopes).
        # Only include explicitly requested additional_scopes (e.g., ai_agent).
        scopes = list(additional_scopes) if additional_scopes else []
        scope_string = " ".join(scopes)

        token_data: Dict[str, str] = {
            "grant_type": "client_credentials",
        }
        if scope_string:
            token_data["scope"] = scope_string
        # Add resource indicator for audience binding when MCP_SERVER_RESOURCE_URI is configured
        # MCP_GW_RESOURCE_URI is the gateway audience (Phase 243). Fall back to
        # MCP_SERVER_RESOURCE_URI for backward compatibility.
        mcp_resource_uri = (
            self.config.pingone.mcp_gw_resource_uri
            or self.config.pingone.mcp_server_resource_uri
        )
        if mcp_resource_uri:
            token_data["resource"] = mcp_resource_uri
            logger.info(
                f"Agent token request includes resource indicator: {mcp_resource_uri}"
            )

        # Use HTTP Basic authentication with client credentials
        auth = aiohttp.BasicAuth(
            login=client_credentials.client_id,
            password=client_credentials.client_secret,
        )

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        }

        max_retries = self.config.security.max_retry_attempts
        backoff_seconds = self.config.security.retry_backoff_seconds

        for attempt in range(max_retries):
            try:
                logger.info(
                    f"Requesting client credentials token (attempt {attempt + 1}/{max_retries})"
                )

                async with self.session.post(
                    self.config.pingone.token_endpoint,
                    data=token_data,
                    auth=auth,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    if response.status == 200:
                        response_data = await response.json()
                        return self._parse_token_response(response_data)

                    elif response.status in [429, 500, 502, 503, 504]:
                        # Retryable errors
                        if attempt < max_retries - 1:
                            wait_time = backoff_seconds * (2**attempt)
                            logger.warning(
                                f"Token request failed with status {response.status}, retrying in {wait_time}s"
                            )
                            await asyncio.sleep(wait_time)
                            continue

                    # Non-retryable error or max retries reached
                    error_text = await response.text()
                    logger.error(
                        f"Token request failed with status {response.status}: {error_text}"
                    )
                    raise aiohttp.ClientResponseError(
                        request_info=response.request_info,
                        history=response.history,
                        status=response.status,
                        message=f"Token request failed: {error_text}",
                    )

            except aiohttp.ClientResponseError as e:
                # Don't retry client response errors (they already went through status code handling above)
                logger.error(f"Token request failed with client response error: {e}")
                raise
            except aiohttp.ClientError as e:
                # Retry other client errors (connection issues, timeouts, etc.)
                if attempt < max_retries - 1:
                    wait_time = backoff_seconds * (2**attempt)
                    logger.warning(
                        f"Token request failed: {e}, retrying in {wait_time}s"
                    )
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.error(
                        f"Token request failed after {max_retries} attempts: {e}"
                    )
                    raise

        raise RuntimeError("Token request failed after all retry attempts")

    def _parse_token_response(self, response_data: Dict[str, Any]) -> AccessToken:
        """
        Parse the token response from ForgeRock.

        Args:
            response_data: The JSON response from the token endpoint

        Returns:
            AccessToken: Parsed access token

        Raises:
            ValueError: If response format is invalid
        """
        try:
            access_token = response_data["access_token"]
            token_type = response_data.get("token_type", "Bearer")
            expires_in = int(response_data.get("expires_in", 3600))
            scope = response_data.get("scope", self.config.pingone.default_scope)

            token = AccessToken(
                token=access_token,
                token_type=token_type,
                expires_in=expires_in,
                scope=scope,
                issued_at=datetime.now(timezone.utc),
            )

            logger.info(
                f"Successfully obtained ForgeRock access token, expires in {expires_in} seconds"
            )
            return token

        except (KeyError, ValueError) as e:
            logger.error(f"Failed to parse ForgeRock token response: {e}")
            raise ValueError(f"Invalid token response format: {e}")

    async def get_valid_token(
        self,
        client_credentials: ClientCredentials,
        additional_scopes: Optional[List[str]] = None,
    ) -> AccessToken:
        """
        Get a valid access token, refreshing if necessary.

        Args:
            client_credentials: The client credentials to use for authentication
            additional_scopes: Optional list of additional scopes to request beyond default

        Returns:
            AccessToken: A valid access token

        Raises:
            aiohttp.ClientError: If token acquisition fails
            ValueError: If credentials are expired or response is invalid
        """
        # Same context-manager guard as the sibling methods: _refresh_lock is
        # only created in __aenter__, so using it here outside a context
        # manager would otherwise surface as an opaque TypeError.
        if not self.session or self._refresh_lock is None:
            raise RuntimeError("TokenManager must be used as async context manager")

        # Build scope key — client_credentials tokens should not include openid (OIDC user scopes).
        # Use only explicitly requested additional_scopes (e.g., ai_agent).
        scopes = list(additional_scopes) if additional_scopes else []
        scope_key = " ".join(sorted(scopes)) if scopes else ""

        # HI-02: take the refresh lock around the cache-check + refresh path.
        # Without this, two concurrent MCP tool calls both observe the cache
        # miss and both POST to the token endpoint. The lock keeps the
        # cache-hit fast path (it just compares fields) yet serializes the
        # rare cache miss to one in-flight grant.
        async with self._refresh_lock:
            # Re-check inside the lock — a second caller racing the first
            # should find the token already cached on second look.
            # Compare against _current_scope_key (the scope key used at fetch
            # time) rather than token.scope (the server-returned scope string),
            # so the cache hit is stable regardless of how the IdP normalises
            # the scope in its response.
            if (
                self._current_token
                and self._current_credentials
                and self._current_credentials.client_id == client_credentials.client_id
                and not self._is_token_near_expiry(self._current_token)
                and self._current_scope_key == scope_key
            ):
                logger.debug("Using cached access token")
                return self._current_token

            # Need to get a new token
            logger.info("Acquiring new access token")
            token = await self.get_client_credentials_token(
                client_credentials, additional_scopes
            )

            # Cache the token, credentials, and the scope key used to fetch it.
            self._current_token = token
            self._current_credentials = client_credentials
            self._current_scope_key = scope_key

            return token

    def _is_token_near_expiry(self, token: AccessToken) -> bool:
        """
        Check if token is near expiry (within the configured buffer time).

        Args:
            token: The access token to check

        Returns:
            bool: True if token is near expiry or expired
        """
        buffer_seconds = self.config.security.token_expiry_buffer_seconds
        return token.expires_in_seconds() <= buffer_seconds

    def clear_cached_token(self) -> None:
        """Clear any cached token and credentials."""
        self._current_token = None
        self._current_credentials = None
        self._current_scope_key = None
        logger.debug("Cleared cached access token")


class UserAuthorizationFacilitator:
    """
    Facilitates OAuth authorization code flow between users and MCP servers.

    This class handles the user authorization flow by:
    1. Generating authorization URLs when MCP servers request user auth
    2. Receiving authorization codes from OAuth redirects
    3. Passing authorization codes to requesting MCP servers

    Note: This class does NOT exchange authorization codes for tokens.
    That is handled by the MCP servers directly with the authorization server.
    """

    # WR-07: hard cap on tracked pending authorizations. A user who starts an
    # OAuth flow but never returns leaves a (10-min TTL) entry forever; without
    # a reaper the dict grows unbounded over uptime. The cap is generous
    # relative to realistic concurrent in-flight logins for a demo.
    _MAX_PENDING_AUTHORIZATIONS = 512

    def __init__(self, config=None):
        self.config = config or get_config()
        self._pending_authorizations: Dict[str, Dict[str, Any]] = {}

    def generate_authorization_url(
        self, client_id: str, scope: str, session_id: str, mcp_server_id: str
    ) -> str:
        """
        Generate authorization URL for user to visit.

        Args:
            client_id: The OAuth client ID (from registered client)
            scope: The OAuth scope requested by the MCP server
            session_id: The user session ID
            mcp_server_id: The ID of the MCP server requesting authorization

        Returns:
            str: The authorization URL for the user to visit
        """
        # WR-07: self-reap before adding a new entry. cleanup_expired_...()
        # only removes entries past their 10-minute expires_at, so a flow
        # still inside its valid auth window (and its PKCE code_verifier) is
        # never evicted. _enforce_pending_cap() then drops the OLDEST entries
        # if the dict is still over the hard cap (FIFO, like the gateway
        # tokenExchange cap) — bounding worst-case memory even under a flood
        # of unexpired requests.
        self.cleanup_expired_authorizations()
        self._enforce_pending_cap()

        # Generate cryptographically secure state parameter
        state = self._generate_state()

        # CR-05: PKCE S256 is mandatory for every authorization code flow
        # (RFC 9700 / OAuth 2.1; oauth-pingone skill §4c). Generate a fresh,
        # single-use code_verifier per authorization request and bind it to
        # the same `state` correlation key the CSRF check already uses, so it
        # survives until the code->token exchange. No new store is introduced.
        code_verifier, code_challenge = self._generate_pkce_pair()

        # Store authorization request information for callback handling
        self._pending_authorizations[state] = {
            "session_id": session_id,
            "mcp_server_id": mcp_server_id,
            "scope": scope,
            "client_id": client_id,
            "code_verifier": code_verifier,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        }

        # Build authorization URL
        auth_params = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": self.config.pingone.redirect_uri,
            "scope": scope,
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }

        auth_url = (
            f"{self.config.pingone.authorization_endpoint}?{urlencode(auth_params)}"
        )

        logger.info(
            f"Generated authorization URL for MCP server {mcp_server_id}, session {session_id}"
        )
        return auth_url

    def handle_authorization_callback(
        self,
        auth_code: str,
        state: str,
        session_id: str,
    ) -> Dict[str, Any]:
        """
        Handle authorization callback and prepare data for MCP server.

        Args:
            auth_code: The authorization code from the callback
            state: The state parameter from the callback
            session_id: Connection-bound session ID. REQUIRED. validate_state()
                enforces that the state was issued for this exact session,
                closing the CSRF/replay window flagged in BL-03.

        Returns:
            Dict containing authorization info for the MCP server

        Raises:
            ValueError: If session_id is missing/empty, or if state is
                invalid, expired, or doesn't match the issuing session.
        """
        # IN-06: session_id is mandatory. The prior `Optional[str] = None`
        # signature made BL-03 session-binding validation OPT-IN — any caller
        # that omitted session_id (or passed None) silently fell through to
        # existence+expiry only, i.e. zero CSRF protection on the public API.
        # Reject the no-session path outright rather than silent-passing it;
        # this is the same identity-hardening posture as Path A / WR-11.
        if not session_id:
            logger.error(
                "handle_authorization_callback called without a session_id — "
                "refusing (BL-03 session binding is mandatory)"
            )
            raise ValueError("session_id is required for authorization callback")

        # BL-03: run validate_state() FIRST so a mismatching session is
        # rejected before we even peek at the stored auth_info. validate_state
        # has the side-effect of deleting expired entries; calling it here
        # keeps that contract.
        if not self.validate_state(state, session_id):
            # Truncate the CSRF state in logs (same convention as auth_flow_logger).
            state_prefix = state[:8] + "..." if state and len(state) > 8 else state
            logger.error(
                f"State validation failed in callback "
                f"(state={state_prefix!r}, session={session_id!r})"
            )
            raise ValueError("Invalid, expired, or session-mismatched state parameter")

        # Validate state parameter
        if state not in self._pending_authorizations:
            state_prefix = state[:8] + "..." if state and len(state) > 8 else state
            logger.error(f"Invalid state parameter: {state_prefix}")
            raise ValueError("Invalid or expired state parameter")

        auth_info = self._pending_authorizations[state]

        # Check if state has expired
        if datetime.now(timezone.utc) > auth_info["expires_at"]:
            del self._pending_authorizations[state]
            logger.error(f"Expired state parameter: {state}")
            raise ValueError("State parameter has expired")

        # Prepare authorization data for MCP server.
        # CR-05: forward the PKCE code_verifier so the party performing the
        # code->token exchange can send it (RFC 7636 §4.5). The verifier is
        # single-use: the _pending_authorizations[state] entry is deleted
        # immediately below, so it cannot be replayed for another exchange.
        authorization_data = {
            "authorization_code": auth_code,
            "state": state,
            "session_id": auth_info["session_id"],
            "mcp_server_id": auth_info["mcp_server_id"],
            "scope": auth_info["scope"],
            "client_id": auth_info["client_id"],
            "code_verifier": auth_info.get("code_verifier"),
            "redirect_uri": self.config.pingone.redirect_uri,
            "received_at": datetime.now(timezone.utc),
        }

        # Clean up state
        del self._pending_authorizations[state]

        logger.info(
            f"Successfully received authorization code for MCP server {auth_info['mcp_server_id']}"
        )
        return authorization_data

    def validate_state(self, state: str, session_id: str) -> bool:
        """
        Validate state parameter for CSRF protection.

        Args:
            state: The state parameter to validate
            session_id: The expected session ID

        Returns:
            bool: True if state is valid, False otherwise
        """
        if state not in self._pending_authorizations:
            return False

        auth_info = self._pending_authorizations[state]

        # Check expiration
        if datetime.now(timezone.utc) > auth_info["expires_at"]:
            del self._pending_authorizations[state]
            return False

        # Check session ID match
        return auth_info["session_id"] == session_id

    def get_pending_authorization_info(self, state: str) -> Optional[Dict[str, Any]]:
        """
        Get information about a pending authorization request.

        Args:
            state: The state parameter

        Returns:
            Dict with authorization info or None if not found
        """
        return self._pending_authorizations.get(state)

    def _generate_state(self) -> str:
        """Generate a cryptographically secure state parameter."""
        alphabet = string.ascii_letters + string.digits + "-_"
        return "".join(secrets.choice(alphabet) for _ in range(32))

    @staticmethod
    def _generate_pkce_pair() -> tuple[str, str]:
        """
        Generate an RFC 7636 PKCE (code_verifier, code_challenge) pair using
        the S256 method — mandatory for every authorization code flow per
        RFC 9700 / OAuth 2.1 and the oauth-pingone skill (PingOne enforces
        ``pkceEnforcement=S256_REQUIRED``).

        The verifier mirrors the BFF's strength (``crypto.randomBytes(64).hex``
        = 128 hex chars / 512 bits of entropy): ``secrets.token_hex(64)`` is
        128 URL-safe hex characters, comfortably within RFC 7636 §4.1's
        43-128 character bound. The challenge is
        ``base64url(SHA256(verifier))`` with padding stripped, per §4.2.

        Returns:
            tuple[str, str]: (code_verifier, code_challenge)
        """
        code_verifier = secrets.token_hex(64)
        digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
        code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        return code_verifier, code_challenge

    def _enforce_pending_cap(self) -> None:
        """Drop the oldest pending authorizations if over the hard cap (WR-07).

        Called after cleanup_expired_authorizations() and BEFORE the caller
        inserts its new entry, so reap down to cap-1 to guarantee the dict is
        <= cap once that insert lands. Only fires when too many *unexpired*
        flows are in flight at once. Eviction is FIFO by created_at — the
        newest (most likely to still be completed) entries survive, mirroring
        the gateway tokenExchange FIFO cap pattern.
        """
        overflow = len(self._pending_authorizations) - (
            self._MAX_PENDING_AUTHORIZATIONS - 1
        )
        if overflow <= 0:
            return

        oldest_states = sorted(
            self._pending_authorizations,
            key=lambda s: self._pending_authorizations[s]["created_at"],
        )[:overflow]
        for state in oldest_states:
            del self._pending_authorizations[state]
        logger.warning(
            f"Pending-authorization cap ({self._MAX_PENDING_AUTHORIZATIONS}) "
            f"exceeded; evicted {len(oldest_states)} oldest entr"
            f"{'y' if len(oldest_states) == 1 else 'ies'}"
        )

    def cleanup_expired_authorizations(self) -> None:
        """Clean up expired authorization requests."""
        now = datetime.now(timezone.utc)
        expired_states = [
            state
            for state, info in self._pending_authorizations.items()
            if now > info["expires_at"]
        ]

        for state in expired_states:
            del self._pending_authorizations[state]

        if expired_states:
            logger.info(
                f"Cleaned up {len(expired_states)} expired authorization requests"
            )


class OAuthAuthenticationManager(AuthenticationProvider):
    """
    OAuth authentication manager for ForgeRock integration.

    This class handles:
    1. Agent authentication via client credentials flow
    2. User authorization facilitation for MCP servers
    3. Automatic client cleanup on context exit

    Note: User token exchange is handled by MCP servers, not this manager.
    """

    def __init__(
        self, config=None, auto_cleanup: bool = True, auto_register: bool = True
    ):
        """
        Initialize OAuth authentication manager.

        Args:
            config: Optional configuration object
            auto_cleanup: If True, automatically delete registered client on context exit
            auto_register: If True, automatically register client on context entry
        """
        self.config = config or get_config()
        self._client_registration = None
        self._token_manager = None
        self._user_auth_facilitator = None
        self._registered_credentials: Optional[ClientCredentials] = None
        self._auto_cleanup = auto_cleanup
        self._auto_register = auto_register

    async def __aenter__(self):
        """Async context manager entry."""
        self._client_registration = DynamicClientRegistration(self.config)
        self._token_manager = TokenManager(self.config)
        self._user_auth_facilitator = UserAuthorizationFacilitator(self.config)

        await self._client_registration.__aenter__()
        await self._token_manager.__aenter__()

        # Auto-register client if enabled
        if self._auto_register:
            logger.info("Auto-registering OAuth client on context entry")
            await self.register_client()

        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit with automatic client cleanup."""
        try:
            # Only delete DCR-registered clients. Pre-provisioned creds from
            # .env are owned by the bootstrap process and must NOT be deleted.
            dcr_enabled = self.config.pingone.agent_dcr_enabled
            if (
                self._auto_cleanup
                and dcr_enabled
                and self._registered_credentials
                and self._client_registration
            ):
                try:
                    logger.info("Auto-cleanup: Deleting registered OAuth client")
                    await self._client_registration.delete_client(
                        self._registered_credentials
                    )
                except Exception as cleanup_error:
                    logger.error(
                        f"Failed to auto-cleanup client {self._registered_credentials.client_id}: {cleanup_error}"
                    )
                    # Don't raise - we want to continue with other cleanup
        finally:
            # Always clean up session resources
            if self._client_registration:
                await self._client_registration.__aexit__(exc_type, exc_val, exc_tb)
            if self._token_manager:
                await self._token_manager.__aexit__(exc_type, exc_val, exc_tb)

    async def register_client(
        self, additional_scopes: Optional[List[str]] = None
    ) -> ClientCredentials:
        """
        Resolve OAuth client credentials.

        PingOne (the demo's identity provider) does not expose ForgeRock-style
        Dynamic Client Registration. Default behaviour: read pre-provisioned
        credentials from PINGONE_USER_CLIENT_ID / PINGONE_USER_CLIENT_SECRET
        (or AGENT_CLIENT_ID / AGENT_CLIENT_SECRET), which the repo's
        `npm run pingone:bootstrap` already provisions.

        Set AGENT_DCR_ENABLED=true to use the legacy ForgeRock DCR path
        instead. Required when running against a real ForgeRock tenant.
        """
        if not self._client_registration:
            raise RuntimeError(
                "OAuthAuthenticationManager must be used as async context manager"
            )

        dcr_enabled = self.config.pingone.agent_dcr_enabled
        if dcr_enabled:
            self._registered_credentials = (
                await self._client_registration.register_client(additional_scopes)
            )
            logger.info(
                "Successfully registered OAuth client (DCR): %s",
                self._registered_credentials.client_id,
            )
            return self._registered_credentials

        client_id = (
            self.config.pingone.user_client_id or self.config.pingone.agent_client_id
        )
        client_secret = (
            self.config.pingone.user_client_secret
            or self.config.pingone.agent_client_secret
        )
        if not client_id or not client_secret:
            raise RuntimeError(
                "No pre-provisioned OAuth client credentials found. Set "
                "PINGONE_USER_CLIENT_ID/PINGONE_USER_CLIENT_SECRET (or "
                "AGENT_CLIENT_ID/AGENT_CLIENT_SECRET) in the environment, "
                "or enable DCR with AGENT_DCR_ENABLED=true."
            )

        # Pre-provisioned credentials don't expire in the DCR sense — set
        # expires_at far in the future and use a synthetic registration_access_token
        # since these creds were created by the bootstrap process, not DCR.
        self._registered_credentials = ClientCredentials(
            client_id=client_id,
            client_secret=client_secret,
            registration_access_token="pre-provisioned",
            expires_at=datetime.now(timezone.utc) + timedelta(days=365 * 10),
        )
        logger.info(
            "Using pre-provisioned OAuth client: client_id=%s (DCR disabled)",
            client_id,
        )
        return self._registered_credentials

    async def delete_client(
        self, client_credentials: Optional[ClientCredentials] = None
    ) -> bool:
        """
        Delete a dynamically registered OAuth client.

        Args:
            client_credentials: Optional client credentials. If not provided, uses registered credentials.

        Returns:
            bool: True if deletion was successful

        Raises:
            ValueError: If no credentials available or missing registration_access_token
            RuntimeError: If manager not properly initialized
        """
        if not self._client_registration:
            raise RuntimeError(
                "OAuthAuthenticationManager must be used as async context manager"
            )

        credentials = client_credentials or self._registered_credentials
        if not credentials:
            raise ValueError("No client credentials available to delete")

        result = await self._client_registration.delete_client(credentials)

        # Clear registered credentials if we just deleted them
        if credentials == self._registered_credentials:
            self._registered_credentials = None
            self._token_manager.clear_cached_token()

        return result

    async def get_client_credentials_token(
        self,
        client_credentials: ClientCredentials = None,
        additional_scopes: Optional[List[str]] = None,
    ) -> AccessToken:
        """
        Obtain an access token using client credentials flow for agent authentication.

        Args:
            client_credentials: Optional client credentials. If not provided, uses registered credentials.
            additional_scopes: Optional list of additional scopes to request beyond default

        Returns:
            AccessToken: The obtained access token for the agent
        """
        if not self._token_manager:
            raise RuntimeError(
                "OAuthAuthenticationManager must be used as async context manager"
            )

        credentials = client_credentials or self._registered_credentials
        if not credentials:
            raise ValueError("No client credentials available. Register client first.")

        return await self._token_manager.get_valid_token(credentials, additional_scopes)

    async def refresh_token(self, refresh_token: str) -> AccessToken:
        """
        Refresh an expired access token.

        Note: ForgeRock client credentials flow doesn't use refresh tokens.
        This method is included for interface compatibility.

        Args:
            refresh_token: The refresh token (not used in client credentials flow)

        Returns:
            AccessToken: A new access token
        """
        if not self._registered_credentials:
            raise ValueError("No client credentials available. Register client first.")

        # For client credentials flow, we just get a new token
        return await self.get_client_credentials_token()

    def generate_user_authorization_url(
        self, scope: str, session_id: str, mcp_server_id: str
    ) -> str:
        """
        Generate authorization URL for user authorization when requested by MCP server.

        Args:
            scope: The OAuth scope requested by the MCP server
            session_id: The user session ID
            mcp_server_id: The ID of the MCP server requesting authorization

        Returns:
            str: The authorization URL for the user to visit
        """
        if not self._user_auth_facilitator or not self._registered_credentials:
            raise RuntimeError("OAuth manager not properly initialized")

        return self._user_auth_facilitator.generate_authorization_url(
            client_id=self._registered_credentials.client_id,
            scope=scope,
            session_id=session_id,
            mcp_server_id=mcp_server_id,
        )

    def handle_user_authorization_callback(
        self,
        auth_code: str,
        state: str,
        session_id: str,
    ) -> Dict[str, Any]:
        """
        Handle authorization callback and prepare data for MCP server.

        Args:
            auth_code: The authorization code from the callback
            state: The state parameter from the callback
            session_id: Connection-bound session ID. REQUIRED (IN-06).
                Forwarded to the facilitator so validate_state() enforces the
                BL-03 session-binding check; a missing session_id is rejected.

        Returns:
            Dict containing authorization info for the MCP server
        """
        if not self._user_auth_facilitator:
            raise RuntimeError(
                "OAuthAuthenticationManager must be used as async context manager"
            )

        return self._user_auth_facilitator.handle_authorization_callback(
            auth_code, state, session_id=session_id
        )

    def validate_authorization_state(self, state: str, session_id: str) -> bool:
        """
        Validate state parameter for CSRF protection.

        Args:
            state: The state parameter to validate
            session_id: The expected session ID

        Returns:
            bool: True if state is valid, False otherwise
        """
        if not self._user_auth_facilitator:
            raise RuntimeError(
                "OAuthAuthenticationManager must be used as async context manager"
            )

        return self._user_auth_facilitator.validate_state(state, session_id)

    def get_pending_authorization_info(self, state: str) -> Optional[Dict[str, Any]]:
        """
        Get information about a pending authorization request.

        Args:
            state: The state parameter

        Returns:
            Dict with authorization info or None if not found
        """
        if not self._user_auth_facilitator:
            raise RuntimeError(
                "OAuthAuthenticationManager must be used as async context manager"
            )

        return self._user_auth_facilitator.get_pending_authorization_info(state)

    # Legacy interface compatibility methods (deprecated)
    async def generate_authorization_url(
        self, client_id: str, scope: str, state: str
    ) -> str:
        """Legacy method for interface compatibility."""
        logger.warning(
            "generate_authorization_url is deprecated, use generate_user_authorization_url"
        )
        return self.generate_user_authorization_url(scope, state, "unknown_mcp_server")

    def cleanup_expired_states(self) -> None:
        """Clean up expired authorization requests."""
        if self._user_auth_facilitator:
            self._user_auth_facilitator.cleanup_expired_authorizations()

    def clear_cached_token(self) -> None:
        """Clear any cached agent tokens."""
        if self._token_manager:
            self._token_manager.clear_cached_token()

    @property
    def registered_credentials(self) -> Optional[ClientCredentials]:
        """Get the currently registered client credentials."""
        return self._registered_credentials
