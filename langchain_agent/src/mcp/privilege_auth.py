"""
OAuth 2.0 Authorization Code + PKCE flow for the PingOne Privilege Cloud MCP
Gateway (agentless mode). Used by external_client.py to obtain a bearer token
as a standalone CLI, outside the BFF-mediated user-authorization flow that
authentication/oauth_manager.py's UserAuthorizationFacilitator implements —
that class expects a running web app to catch the redirect and hands the code
off to an MCP server for exchange; this module does both itself, in-process,
since there is no running app here.

Nothing here is persisted to disk. The access token lives only in the
returned AccessToken object, for the calling process's lifetime.
"""
import asyncio
import logging
import secrets
import string
import time
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Dict, Optional
from urllib.parse import urlencode, urlparse, parse_qs

import httpx

from src.authentication.oauth_manager import UserAuthorizationFacilitator
from src.config.settings import PrivilegeConfig
from src.models.auth import AccessToken

logger = logging.getLogger(__name__)


class PrivilegeAuthError(Exception):
    """Raised when the Privilege PKCE flow fails at any stage."""


def generate_state() -> str:
    """Generate a cryptographically secure, URL-safe state parameter."""
    alphabet = string.ascii_letters + string.digits + "-_"
    return "".join(secrets.choice(alphabet) for _ in range(32))


def build_authorize_url(config: PrivilegeConfig, state: str, code_challenge: str) -> str:
    """Build the PingOne Privilege authorize URL for the browser to open."""
    params = {
        "response_type": "code",
        "client_id": config.client_id,
        "redirect_uri": config.redirect_uri,
        "scope": config.scope,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{config.authorize_url}?{urlencode(params)}"


class _CallbackHandler(BaseHTTPRequestHandler):
    """Catches the OAuth redirect GET and stores code/state on the server.

    Ignores requests to any other path (browser prefetch, stray probes on the
    loopback port) instead of treating them as the callback — handle_request()
    only processes one request per call, so an unrelated hit would otherwise
    consume that slot and mask the real callback as a timeout.
    """

    def do_GET(self):  # noqa: N802 - stdlib method name
        parsed = urlparse(self.path)
        if parsed.path != self.server.callback_path:
            self.send_response(404)
            self.end_headers()
            return

        qs = parse_qs(parsed.query)
        self.server.captured_code = qs.get("code", [None])[0]
        self.server.captured_state = qs.get("state", [None])[0]
        self.server.captured_error = qs.get("error", [None])[0]
        self.server.callback_matched = True

        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(
            b"<html><body>Sign-in complete. You may close this window.</body></html>"
        )

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        # Silence the default stderr access log; privilege_auth's own logger
        # already records the outcome.
        pass


def _run_callback_server(
    port: int, timeout_seconds: float, callback_path: str
) -> "tuple[Optional[str], Optional[str]]":
    """Block until a GET hits the configured callback path, or the deadline passes.

    Runs synchronously — the caller is expected to invoke this via
    loop.run_in_executor so it doesn't block the event loop. Loops over
    handle_request() (one request per call) rather than calling it once, so a
    stray unrelated request doesn't consume the single slot and starve the
    real callback.
    """
    server = HTTPServer(("127.0.0.1", port), _CallbackHandler)
    server.callback_path = callback_path
    server.captured_code = None
    server.captured_state = None
    server.captured_error = None
    server.callback_matched = False

    deadline = time.monotonic() + timeout_seconds
    while not server.callback_matched:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        server.timeout = remaining
        server.handle_request()
    server.server_close()

    if not server.callback_matched:
        raise PrivilegeAuthError(
            f"No callback received within {timeout_seconds}s — authorization timed out"
        )
    if server.captured_error:
        raise PrivilegeAuthError(f"Authorization server returned error: {server.captured_error}")
    if not server.captured_code:
        raise PrivilegeAuthError("Callback received but no authorization code present")
    return server.captured_code, server.captured_state


async def authorize_and_get_token(
    config: PrivilegeConfig, timeout_seconds: float = 120.0
) -> AccessToken:
    """Run the full Privilege OAuth Authorization Code + PKCE flow.

    Opens the system browser to PingOne Privilege's authorize endpoint,
    waits for the redirect on a local loopback server, then exchanges the
    code for a token via client_secret_basic. Raises PrivilegeAuthError on
    any failure (timeout, state mismatch, AS error, non-200 token response).

    Checks that the required PrivilegeConfig fields are populated before
    doing anything else — an unconfigured door would otherwise open a
    browser to a scheme-less URL and hang for the full timeout, misdiagnosing
    a missing-config problem as a network/timing one.
    """
    _required = {
        "client_id": config.client_id,
        "client_secret": config.client_secret,
        "authorize_url": config.authorize_url,
        "token_url": config.token_url,
        "redirect_uri": config.redirect_uri,
    }
    _missing = [name for name, value in _required.items() if not value]
    if _missing:
        _env_names = ", ".join(f"PRIVILEGE_MCP_{name.upper()}" for name in _missing)
        raise PrivilegeAuthError(
            f"Privilege MCP client is not configured — missing env var(s): {_env_names}"
        )

    code_verifier, code_challenge = UserAuthorizationFacilitator._generate_pkce_pair()
    state = generate_state()
    authorize_url = build_authorize_url(config, state=state, code_challenge=code_challenge)

    logger.info(f"Opening browser for Privilege authorization: {authorize_url}")
    webbrowser.open(authorize_url)

    callback_path = urlparse(config.redirect_uri).path or "/"
    loop = asyncio.get_event_loop()
    code, returned_state = await loop.run_in_executor(
        None, _run_callback_server, config.callback_port, timeout_seconds, callback_path
    )

    if returned_state != state:
        raise PrivilegeAuthError(
            f"OAuth state mismatch: expected {state!r}, got {returned_state!r}"
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            config.token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": config.redirect_uri,
                "code_verifier": code_verifier,
            },
            auth=(config.client_id, config.client_secret),
        )

    if response.status_code != 200:
        raise PrivilegeAuthError(
            f"Token exchange failed with HTTP {response.status_code}: {response.text}"
        )

    body = response.json()
    return AccessToken(
        token=body["access_token"],
        token_type=body.get("token_type", "Bearer"),
        expires_in=int(body.get("expires_in", 3600)),
        scope=body.get("scope", config.scope),
        issued_at=datetime.now(timezone.utc),
    )
