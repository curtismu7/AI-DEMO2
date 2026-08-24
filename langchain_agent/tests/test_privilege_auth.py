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
             "src.mcp.privilege_auth._create_callback_server",
             return_value=MagicMock(),
         ) as mock_create, \
         patch(
             "src.mcp.privilege_auth._wait_for_callback",
             return_value=("auth-code-xyz", "matching-state"),
         ) as mock_wait, \
         patch("src.mcp.privilege_auth.generate_state", return_value="matching-state"), \
         patch("httpx.AsyncClient", return_value=mock_client):
        token = await authorize_and_get_token(config, timeout_seconds=5.0)

    assert token.token == "privilege-access-token"
    assert token.token_type == "Bearer"
    assert token.scope == "mcp.read mcp.write"
    mock_create.assert_called_once()
    mock_wait.assert_called_once()

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
         patch("src.mcp.privilege_auth._create_callback_server", return_value=MagicMock()), \
         patch(
             "src.mcp.privilege_auth._wait_for_callback",
             return_value=("auth-code-xyz", "WRONG-state"),
         ), \
         patch("src.mcp.privilege_auth.generate_state", return_value="matching-state"):
        with pytest.raises(PrivilegeAuthError, match="state mismatch"):
            await authorize_and_get_token(config, timeout_seconds=5.0)


@pytest.mark.asyncio
async def test_authorize_and_get_token_binds_callback_server_before_opening_browser():
    """Regression test for a race Greptile flagged: opening the browser
    before the callback listener exists let a fast redirect (existing
    PingOne session, automated flow) hit a connection-refused port. The
    listener must be bound synchronously first."""
    from src.mcp.privilege_auth import authorize_and_get_token

    config = _config()
    call_order = []

    def _record_create(*args, **kwargs):
        call_order.append("create_callback_server")
        return MagicMock()

    def _record_open(*args, **kwargs):
        call_order.append("webbrowser.open")
        return True

    mock_token_response = MagicMock()
    mock_token_response.status_code = 200
    mock_token_response.json.return_value = {"access_token": "tok", "expires_in": 3600}
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_token_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("src.mcp.privilege_auth.webbrowser.open", side_effect=_record_open), \
         patch("src.mcp.privilege_auth._create_callback_server", side_effect=_record_create), \
         patch(
             "src.mcp.privilege_auth._wait_for_callback",
             return_value=("auth-code-xyz", "matching-state"),
         ), \
         patch("src.mcp.privilege_auth.generate_state", return_value="matching-state"), \
         patch("httpx.AsyncClient", return_value=mock_client):
        await authorize_and_get_token(config, timeout_seconds=5.0)

    assert call_order == ["create_callback_server", "webbrowser.open"]


def test_callback_server_ignores_unrelated_path_and_catches_real_callback():
    """An unrelated GET (browser prefetch, stray probe) must not consume the
    one-shot handle_request() slot and mask the real OAuth redirect as a
    timeout — regression test for the callback-path guard."""
    from src.mcp.privilege_auth import _create_callback_server, _wait_for_callback

    port = 8768
    server = _create_callback_server(port, callback_path="/callback")
    result = {}

    def _wait():
        result["value"] = _wait_for_callback(server, timeout_seconds=5.0)

    thread = threading.Thread(target=_wait, daemon=True)
    thread.start()

    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/favicon.ico", timeout=2)
    assert exc.value.code == 404

    urllib.request.urlopen(
        f"http://127.0.0.1:{port}/callback?code=real-code&state=real-state", timeout=2
    )
    thread.join(timeout=5)
    assert result["value"] == ("real-code", "real-state")


def test_callback_server_queues_a_request_that_arrives_before_waiting_starts():
    """Regression test for the create/wait split: _create_callback_server
    binds and listens immediately, so a redirect whose connection lands
    before _wait_for_callback's loop starts must still be served from the
    OS accept backlog — not dropped as connection-refused. The client
    request runs on its own thread since it blocks on the response, which
    only arrives once _wait_for_callback actually processes it."""
    from src.mcp.privilege_auth import _create_callback_server, _wait_for_callback

    port = 8770
    server = _create_callback_server(port, callback_path="/callback")

    client_result = {}

    def _client():
        resp = urllib.request.urlopen(
            f"http://127.0.0.1:{port}/callback?code=early-code&state=early-state", timeout=5
        )
        client_result["status"] = resp.status

    client_thread = threading.Thread(target=_client, daemon=True)
    client_thread.start()
    time.sleep(0.2)  # let the connection land in the accept backlog, unprocessed

    # Only now start waiting — the connection above should already be queued.
    result = _wait_for_callback(server, timeout_seconds=5.0)
    client_thread.join(timeout=5)

    assert result == ("early-code", "early-state")
    assert client_result["status"] == 200
