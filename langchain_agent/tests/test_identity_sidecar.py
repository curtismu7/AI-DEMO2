"""ff_agent_identity_sidecar: the agent's token comes from the sidecar when the
request carries the flag, and from the existing client_credentials path when not.

Pins: the flag is per-request (a ContextVar), OFF changes nothing, ON has no
silent fallback, and the sidecar API key never reaches an error message.
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import aiohttp
import pytest

from src.authentication import identity_sidecar as sc
from src.authentication.oauth_manager import OAuthAuthenticationManager

API_KEY = "sidecar-key-do-not-leak"


class FakeResp:
    def __init__(self, status, body):
        self.status = status
        self._body = body

    async def json(self, content_type=None):
        return self._body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    """Records the POST; `result` is a FakeResp or an exception to raise."""

    def __init__(self, result):
        self.result = result
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@pytest.fixture(autouse=True)
def sidecar_env(monkeypatch):
    monkeypatch.setenv("AGENT_IDENTITY_SIDECAR_API_KEY", API_KEY)
    monkeypatch.delenv("AGENT_IDENTITY_SIDECAR_URL", raising=False)
    monkeypatch.delenv("AGENT_IDENTITY_SIDECAR_TARGET", raising=False)
    monkeypatch.delenv("AGENT_IDENTITY_SIDECAR_ONLY", raising=False)


async def test_fetch_returns_access_token_and_names_the_target():
    session = FakeSession(
        FakeResp(200, {"access_token": "tok-1", "token_type": "Bearer", "expires_in": 300, "scope": "ai_agent"})
    )
    token = await sc.fetch_sidecar_token(session)

    assert token.token == "tok-1"
    assert token.scope == "ai_agent"
    url, kwargs = session.calls[0]
    assert url == "http://agent-identity-sidecar:8097/v1/token"
    assert kwargs["json"] == {"target": "mcp-gateway"}
    assert kwargs["headers"] == {"x-api-key": API_KEY}


async def test_non_200_raises_without_leaking_the_api_key():
    session = FakeSession(FakeResp(400, {"error": "unknown_target"}))
    with pytest.raises(sc.IdentitySidecarError) as exc:
        await sc.fetch_sidecar_token(session, "nope")
    assert "unknown_target" in str(exc.value)
    assert API_KEY not in str(exc.value)


@pytest.mark.parametrize("failure", [aiohttp.ClientConnectionError("refused"), asyncio.TimeoutError()])
async def test_unreachable_sidecar_raises_a_clear_error(failure):
    with pytest.raises(sc.IdentitySidecarError, match="unreachable"):
        await sc.fetch_sidecar_token(FakeSession(failure))


async def test_missing_api_key_fails_before_any_network_call(monkeypatch):
    monkeypatch.delenv("AGENT_IDENTITY_SIDECAR_API_KEY")
    session = FakeSession(FakeResp(200, {}))
    with pytest.raises(sc.IdentitySidecarError, match="API_KEY"):
        await sc.fetch_sidecar_token(session)
    assert session.calls == []


def _manager(token_manager):
    mgr = OAuthAuthenticationManager.__new__(OAuthAuthenticationManager)
    mgr._token_manager = token_manager
    mgr._registered_credentials = MagicMock()
    return mgr


async def test_flag_on_uses_the_sidecar_and_never_the_local_credentials():
    token_manager = MagicMock()
    token_manager.session = FakeSession(FakeResp(200, {"access_token": "from-sidecar", "expires_in": 300}))
    token_manager.get_valid_token = AsyncMock()
    mgr = _manager(token_manager)

    reset = sc.sidecar_requested.set(True)
    try:
        token = await mgr.get_client_credentials_token(additional_scopes=["ai_agent"])
    finally:
        sc.sidecar_requested.reset(reset)

    assert token.token == "from-sidecar"
    token_manager.get_valid_token.assert_not_called()


async def test_flag_off_is_the_unchanged_client_credentials_path():
    token_manager = MagicMock()
    token_manager.session = FakeSession(RuntimeError("sidecar must not be called"))
    token_manager.get_valid_token = AsyncMock(return_value="local-token")
    mgr = _manager(token_manager)

    assert sc.sidecar_requested.get() is False
    token = await mgr.get_client_credentials_token(additional_scopes=["ai_agent"])

    assert token == "local-token"
    assert token_manager.session.calls == []


async def test_flag_on_with_a_down_sidecar_fails_instead_of_falling_back():
    token_manager = MagicMock()
    token_manager.session = FakeSession(aiohttp.ClientConnectionError("refused"))
    token_manager.get_valid_token = AsyncMock(return_value="local-token")
    mgr = _manager(token_manager)

    reset = sc.sidecar_requested.set(True)
    try:
        with pytest.raises(sc.IdentitySidecarError):
            await mgr.get_client_credentials_token(additional_scopes=["ai_agent"])
    finally:
        sc.sidecar_requested.reset(reset)
    token_manager.get_valid_token.assert_not_called()


async def test_flag_is_per_request_context_not_global():
    async def read_in_new_task():
        return sc.sidecar_requested.get()

    reset = sc.sidecar_requested.set(True)
    try:
        assert await asyncio.create_task(read_in_new_task()) is True  # tasks inherit it
    finally:
        sc.sidecar_requested.reset(reset)
    assert await asyncio.create_task(read_in_new_task()) is False


def test_credentials_optional_is_opt_in(monkeypatch):
    assert sc.credentials_optional() is False
    monkeypatch.setenv("AGENT_IDENTITY_SIDECAR_ONLY", "true")
    assert sc.credentials_optional() is True
