"""
Unit tests for the Privilege OAuth PKCE flow (langchain_agent/src/mcp/privilege_auth.py).
"""
import re
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse, parse_qs

import pytest


def _config():
    from src.config.settings import PrivilegeConfig
    return PrivilegeConfig(
        client_id="libre-client",
        client_secret="s3cret",
        authorize_url="https://privilege.example/authorize",
        token_url="https://privilege.example/token",
        redirect_uri="http://127.0.0.1:8765/callback",
        scope="mcp.read mcp.write",
        callback_port=8765,
    )


def test_generate_state_is_url_safe_and_unique():
    from src.mcp.privilege_auth import generate_state
    s1 = generate_state()
    s2 = generate_state()
    assert re.match(r'^[A-Za-z0-9\-_]+$', s1)
    assert len(s1) >= 32
    assert s1 != s2


def test_build_authorize_url_contains_pkce_and_state():
    from src.mcp.privilege_auth import build_authorize_url
    url = build_authorize_url(_config(), state="abc123", code_challenge="chal456")
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    assert parsed.scheme == "https"
    assert parsed.netloc == "privilege.example"
    assert qs["response_type"] == ["code"]
    assert qs["client_id"] == ["libre-client"]
    assert qs["redirect_uri"] == ["http://127.0.0.1:8765/callback"]
    assert qs["scope"] == ["mcp.read mcp.write"]
    assert qs["state"] == ["abc123"]
    assert qs["code_challenge"] == ["chal456"]
    assert qs["code_challenge_method"] == ["S256"]


import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


class _FakeCallbackResult:
    """Mimics what _run_callback_server returns: the query params it caught."""
    def __init__(self, code: str, state: str):
        self.code = code
        self.state = state


@pytest.mark.asyncio
async def test_authorize_and_get_token_exchanges_code_for_token():
    from src.mcp.privilege_auth import authorize_and_get_token

    config = _config()

    mock_token_response = MagicMock()
    mock_token_response.status_code = 200
    mock_token_response.json.return_value = {
        "access_token": "privilege-access-token",
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": "mcp.read mcp.write",
    }

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_token_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("src.mcp.privilege_auth.webbrowser.open", return_value=True), \
         patch(
             "src.mcp.privilege_auth._run_callback_server",
             return_value=("auth-code-xyz", "matching-state"),
         ) as mock_server, \
         patch("src.mcp.privilege_auth.generate_state", return_value="matching-state"), \
         patch("httpx.AsyncClient", return_value=mock_client):
        token = await authorize_and_get_token(config, timeout_seconds=5.0)

    assert token.token == "privilege-access-token"
    assert token.token_type == "Bearer"
    assert token.scope == "mcp.read mcp.write"
    mock_server.assert_called_once()

    # Token exchange must have sent the PKCE code_verifier and used
    # client_secret_basic (HTTP Basic auth), not a bearer/body secret.
    _, kwargs = mock_client.post.call_args
    assert kwargs["data"]["grant_type"] == "authorization_code"
    assert kwargs["data"]["code"] == "auth-code-xyz"
    assert "code_verifier" in kwargs["data"]
    assert kwargs["auth"] == (config.client_id, config.client_secret)


@pytest.mark.asyncio
async def test_authorize_and_get_token_state_mismatch_raises():
    from src.mcp.privilege_auth import authorize_and_get_token, PrivilegeAuthError

    config = _config()
    with patch("src.mcp.privilege_auth.webbrowser.open", return_value=True), \
         patch(
             "src.mcp.privilege_auth._run_callback_server",
             return_value=("auth-code-xyz", "WRONG-state"),
         ), \
         patch("src.mcp.privilege_auth.generate_state", return_value="matching-state"):
        with pytest.raises(PrivilegeAuthError, match="state mismatch"):
            await authorize_and_get_token(config, timeout_seconds=5.0)


def test_run_callback_server_ignores_unrelated_path_and_catches_real_callback():
    """An unrelated GET (browser prefetch, stray probe) must not consume the
    one-shot handle_request() slot and mask the real OAuth redirect as a
    timeout — regression test for the callback-path guard."""
    from src.mcp.privilege_auth import _run_callback_server

    port = 8768
    result = {}

    def _server():
        result["value"] = _run_callback_server(port, timeout_seconds=5.0, callback_path="/callback")

    thread = threading.Thread(target=_server, daemon=True)
    thread.start()

    # Poll for the listening socket instead of a fixed sleep — a blind delay
    # was flaky under pytest's thread scheduling (observed timeout when other
    # tests' event-loop/executor threads were still winding down).
    import socket
    deadline = time.monotonic() + 5.0
    while True:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.1).close()
            break
        except OSError:
            if time.monotonic() > deadline:
                raise
            time.sleep(0.02)

    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/favicon.ico", timeout=2)
    assert exc.value.code == 404

    urllib.request.urlopen(
        f"http://127.0.0.1:{port}/callback?code=real-code&state=real-state", timeout=2
    )
    thread.join(timeout=5)
    assert result["value"] == ("real-code", "real-state")
