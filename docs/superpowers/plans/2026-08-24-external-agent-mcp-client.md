# External-Agent MCP Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `langchain_agent` a standalone external MCP client (`external_client.py`) that can reach both the Agent Gateway and the Privilege (agentless) front doors, proving the connection with a real tool call through each.

**Architecture:** Reuse the two connection classes that already exist in `langchain_agent/src/mcp/connection.py` (`MCPConnection` for WebSocket, `StreamableHttpMCPConnection` for HTTP) exactly as they are — both already accept an externally-supplied bearer token per call via `MCPToolCall.agent_token`. The only genuinely new code is (1) a small OAuth Authorization Code + PKCE flow for the Privilege door (`privilege_auth.py`), reusing this codebase's existing `UserAuthorizationFacilitator._generate_pkce_pair()` rather than reimplementing PKCE, and (2) the thin CLI itself (`external_client.py`) that picks a door, gets a token the right way for that door, and drives the connection.

**Tech Stack:** Python 3.11, `httpx` (already a dependency, used by `StreamableHttpMCPConnection`), stdlib `http.server` for the local OAuth callback, `webbrowser` to launch the authorize URL, pytest + `unittest.mock` (existing test conventions in `langchain_agent/tests/test_mcp_streamable_http.py`).

**Spec:** `docs/superpowers/specs/2026-08-24-external-agent-mcp-client-design.md`

## Deviations from the spec (found while reading the real code — see rationale inline)

1. **No new `PrivilegeMCPConnection` class.** `StreamableHttpMCPConnection` already takes its bearer token from `MCPToolCall.agent_token` at call time (`connection.py:1021-1022`) — it doesn't care how that token was obtained. Reusing it for Privilege needs zero new connection code, only a way to obtain the token (Task 3) and prime it before the first call (Task 4). Note this priming uses a **different attribute per class** — `MCPConnection` (WS) reads `self._agent_token` at `connect()` time (`connection.py:130,190-191`), `StreamableHttpMCPConnection` reads `self._authorization_header` on every POST (`connection.py:1139-1140`) — both already set directly by the existing test suite (`test_mcp_connection.py`, `test_mcp_streamable_http.py:236`), so no new public setter is needed, just the right name per class (Task 4 gets this wrong on a first pass if you don't check — see Task 4's inline comment).
2. **The production URL-scheme allowlist gets `https://` added generally, not one specific Privilege host.** The check at `settings.py:592` exists because a plaintext `ws://` puts the bearer token on the wire in clear text (see the HI-04 comment at `settings.py:579-581`). `https://` is already TLS-encrypted — the same protection `wss://` provides — so the check was simply written before any HTTP-transport server existed in production config, not deliberately excluding HTTPS. Extending it to `wss://`/`https://`/`local://` closes that gap correctly instead of special-casing one hostname, and covers the Agent Gateway's own HTTP mode too, not just Privilege.
3. **Agent Gateway token acquisition reuses `OAuthAuthenticationManager`** (`langchain_agent/src/authentication/oauth_manager.py:878`), the actual live mechanism the agent already uses for client-credentials tokens (see `mcp_tool_provider.py:910`) — not `TokenManager` directly, which the spec didn't name and which turned out to need a `ClientCredentials` object `OAuthAuthenticationManager` already knows how to obtain via DCR.
4. **`MCP_FRONT_DOOR` (spec §4) becomes a `--server {agent_gateway,privilege}` CLI flag reading per-server endpoint config**, not a single global env var. This repo already has a generic per-server config mechanism (`MCP_SERVER_{NAME}_ENDPOINT`, `get_mcp_server_configs()` in `settings.py:575-615`) built for exactly this — registering both doors as two named servers (`MCP_SERVER_AGENT_GATEWAY_ENDPOINT`, `MCP_SERVER_PRIVILEGE_ENDPOINT`) and picking one via `--server` fits that existing convention instead of introducing a parallel, single-purpose switch. Functionally equivalent to the spec's intent (one client, pick a door via config), just expressed the way this codebase already expresses "which server."
5. **No separate token-cache object for the Privilege flow (spec §5.1's "reuses the cached token if still valid").** `external_client.py`'s `run()` calls `authorize_and_get_token()` at most once per process (one CLI invocation = one door, one optional tool call) — there is no code path where it would be called twice in the same process, so there's nothing to cache. This satisfies the spec's actual intent (don't re-run the browser flow needlessly within a process) without adding cache/expiry code that would never execute a second branch.

## Global Constraints

- Python 3.11 (`langchain_agent/CLAUDE.md`); tests via `bash scripts/run-pytest.sh`.
- No persistent token storage — Privilege's token lives in memory for the process lifetime only (spec §1 non-goals).
- No new dependencies — `httpx`, `http.server`, `webbrowser`, `secrets`, `hashlib`, `base64` are all already available (stdlib or existing project deps).
- Don't touch `MCPConnection` (WS), `StreamableHttpMCPConnection`'s existing methods, or any existing test file's assertions — only add.
- Follow existing docstring/logging conventions (`logger = logging.getLogger(__name__)`, module docstring at top of file).

---

## Task 1: `PrivilegeConfig` + scheme allowlist fix

**Files:**
- Modify: `langchain_agent/src/config/settings.py:56-67` (add `PrivilegeConfig` dataclass near `MCPConfig`), `:164-173` (`AppConfig`), `:397-419` (build block, add alongside `pingone_config`), `:524-533` (`AppConfig(...)` call), `:553-557` (`save_config_to_file` secret redaction), `:592-596` (scheme allowlist)
- Test: `langchain_agent/tests/test_privilege_config.py` (new)

**Interfaces:**
- Produces: `PrivilegeConfig` dataclass with fields `client_id: str = ""`, `client_secret: str = ""`, `authorize_url: str = ""`, `token_url: str = ""`, `redirect_uri: str = ""`, `scope: str = "openid"`, `callback_port: int = 8765`. Exposed as `AppConfig.privilege`.

- [ ] **Step 1: Write the failing test**

```python
# langchain_agent/tests/test_privilege_config.py
"""
Unit tests for PrivilegeConfig wiring and the production URL-scheme allowlist.
"""
import os
from unittest.mock import patch

import pytest


def _base_env():
    return {
        "PINGONE_BASE_URL": "http://localhost",
        "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "http://localhost/reg",
        "PINGONE_TOKEN_ENDPOINT": "http://localhost/token",
        "PINGONE_AUTHORIZATION_ENDPOINT": "http://localhost/auth",
        "PINGONE_REDIRECT_URI": "http://localhost/callback",
    }


def test_privilege_config_defaults_blank():
    import src.config.settings as settings_mod
    with patch.dict(os.environ, _base_env(), clear=True):
        mgr = settings_mod.ConfigManager()
        config = mgr.load_config("development")
    assert config.privilege.client_id == ""
    assert config.privilege.callback_port == 8765


def test_privilege_config_env_override():
    import src.config.settings as settings_mod
    env = {
        **_base_env(),
        "PRIVILEGE_MCP_CLIENT_ID": "libre-client",
        "PRIVILEGE_MCP_CLIENT_SECRET": "s3cret",
        "PRIVILEGE_MCP_AUTHORIZE_URL": "https://privilege.example/authorize",
        "PRIVILEGE_MCP_TOKEN_URL": "https://privilege.example/token",
        "PRIVILEGE_MCP_REDIRECT_URI": "http://127.0.0.1:8765/callback",
        "PRIVILEGE_MCP_SCOPE": "mcp.read mcp.write",
        "PRIVILEGE_MCP_CALLBACK_PORT": "9999",
    }
    with patch.dict(os.environ, env, clear=True):
        import src.config.settings as settings_mod
        mgr = settings_mod.ConfigManager()
        config = mgr.load_config("development")
    assert config.privilege.client_id == "libre-client"
    assert config.privilege.callback_port == 9999


def test_save_config_redacts_privilege_secret(tmp_path):
    import src.config.settings as settings_mod
    env = {**_base_env(), "PRIVILEGE_MCP_CLIENT_SECRET": "s3cret"}
    with patch.dict(os.environ, env, clear=True):
        mgr = settings_mod.ConfigManager()
        config = mgr.load_config("development")
    out = tmp_path / "config.json"
    mgr.save_config_to_file(config, out)
    body = out.read_text()
    assert "s3cret" not in body


def _production_env(**overrides):
    # ProductionConfig.validate_config() (settings.py:267-276) additionally
    # requires HTTPS PingOne base_url and a WARNING+ log level — set both
    # explicitly so these tests fail (or pass) for the scheme-check reason
    # being tested, not an unrelated production-validation error.
    env = {
        **_base_env(),
        "PINGONE_BASE_URL": "https://pingone.example",
        "ENVIRONMENT": "production",
        "DEBUG": "false",
        "LOG_LEVEL": "WARNING",
    }
    env.update(overrides)
    return env


def test_mcp_server_endpoint_https_allowed_in_production():
    import src.config.settings as settings_mod
    env = _production_env(
        MCP_SERVER_PRIVILEGE_ENDPOINT="https://cmuir-agentless-mcpgw.ping-devops.com/app/mcp",
    )
    with patch.dict(os.environ, env, clear=True):
        mgr = settings_mod.ConfigManager()
        configs = mgr.get_mcp_server_configs()
    assert configs["privilege"]["endpoint"].startswith("https://")


def test_mcp_server_endpoint_plain_http_rejected_in_production():
    import src.config.settings as settings_mod
    env = _production_env(
        MCP_SERVER_PRIVILEGE_ENDPOINT="http://cmuir-agentless-mcpgw.ping-devops.com/app/mcp",
    )
    with patch.dict(os.environ, env, clear=True):
        mgr = settings_mod.ConfigManager()
        with pytest.raises(ValueError, match="wss://, https://, or local://"):
            mgr.get_mcp_server_configs()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash scripts/run-pytest.sh tests/test_privilege_config.py -v`
Expected: FAIL — `AttributeError: 'AppConfig' object has no attribute 'privilege'` (and the https/http tests fail because `get_mcp_server_configs` doesn't accept `https://` yet).

- [ ] **Step 3: Add `PrivilegeConfig` dataclass**

In `langchain_agent/src/config/settings.py`, immediately after the `MCPConfig` class (after line 67, before the `LangChainConfig` class):

```python
@dataclass
class PrivilegeConfig:
    """Configuration for the PingOne Privilege Cloud MCP Gateway (agentless mode).

    All fields default blank/off — Privilege is opt-in. Only required when
    external_client.py is run with --server privilege.
    """
    client_id: str = ""  # PRIVILEGE_MCP_CLIENT_ID
    client_secret: str = ""  # PRIVILEGE_MCP_CLIENT_SECRET
    authorize_url: str = ""  # PRIVILEGE_MCP_AUTHORIZE_URL
    token_url: str = ""  # PRIVILEGE_MCP_TOKEN_URL
    redirect_uri: str = ""  # PRIVILEGE_MCP_REDIRECT_URI
    scope: str = "openid"  # PRIVILEGE_MCP_SCOPE
    callback_port: int = 8765  # PRIVILEGE_MCP_CALLBACK_PORT — local loopback OAuth callback
```

- [ ] **Step 4: Wire `PrivilegeConfig` into `AppConfig`**

In `AppConfig` (around line 164-173), add the field:

```python
class AppConfig:
    """Main application configuration."""
    environment: str
    debug: bool
    log_level: str
    pingone: PingOneConfig
    security: SecurityConfig
    mcp: MCPConfig
    chat: ChatConfig
    langchain: LangChainConfig
    privilege: PrivilegeConfig
```

- [ ] **Step 5: Build `privilege_config` in `load_config()` and pass it through**

Immediately after the `mcp_config` block (after line 441, before the `# LangChain configuration` comment):

```python
        # Privilege Cloud MCP Gateway configuration (opt-in, agentless mode)
        privilege_config = PrivilegeConfig(
            client_id=get_env_value("PRIVILEGE_MCP_CLIENT_ID", ""),
            client_secret=get_env_value("PRIVILEGE_MCP_CLIENT_SECRET", ""),
            authorize_url=get_env_value("PRIVILEGE_MCP_AUTHORIZE_URL", ""),
            token_url=get_env_value("PRIVILEGE_MCP_TOKEN_URL", ""),
            redirect_uri=get_env_value("PRIVILEGE_MCP_REDIRECT_URI", ""),
            scope=get_env_value("PRIVILEGE_MCP_SCOPE", "openid"),
            callback_port=int(get_env_value("PRIVILEGE_MCP_CALLBACK_PORT", "8765")),
        )
```

Then in the `AppConfig(...)` call (line 524-533), add `privilege=privilege_config,`:

```python
        config = AppConfig(
            environment=env_name,
            debug=get_env_value("DEBUG", "false").lower() == "true",
            log_level=get_env_value("LOG_LEVEL", "INFO"),
            pingone=pingone_config,
            security=security_config,
            mcp=mcp_config,
            chat=chat_config,
            langchain=langchain_config,
            privilege=privilege_config,
        )
```

- [ ] **Step 6: Redact the new secret in `save_config_to_file`**

In `save_config_to_file` (around line 553-557), add a third redaction alongside the existing two:

```python
        if 'pingone' in config_dict:
            if config_dict['pingone'].get('user_client_secret'):
                config_dict['pingone']['user_client_secret'] = "[REDACTED]"
            if config_dict['pingone'].get('agent_client_secret'):
                config_dict['pingone']['agent_client_secret'] = "[REDACTED]"
        if 'privilege' in config_dict and config_dict['privilege'].get('client_secret'):
            config_dict['privilege']['client_secret'] = "[REDACTED]"
```

- [ ] **Step 7: Fix the production scheme allowlist**

In `get_mcp_server_configs()` (lines 579-596), change the check and its error message:

```python
        # HI-04: in production, agent bearer tokens travel via Authorization
        # header. Plain ws:// or http:// puts them on the wire in clear text.
        # wss:// and https:// are both TLS-encrypted (same protection), and
        # local:// never leaves the host — accept all three, reject only the
        # two plaintext schemes, so the misconfiguration is loud, not silent.
        environment = (os.getenv("ENVIRONMENT") or "development").lower()
        is_production = environment == "production"

        # Look for MCP server configurations in format: MCP_SERVER_{NAME}_ENDPOINT
        for key, value in os.environ.items():
            if key.startswith("MCP_SERVER_") and key.endswith("_ENDPOINT"):
                # Extract server name from environment variable
                server_name = key.replace("MCP_SERVER_", "").replace("_ENDPOINT", "").lower()

                _allowed_prod_schemes = ("wss://", "https://", "local://")
                if is_production and not value.startswith(_allowed_prod_schemes):
                    raise ValueError(
                        f"MCP server '{server_name}' endpoint must use "
                        f"wss://, https://, or local:// in production "
                        f"(got {value.split('://')[0]}://...)"
                    )
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bash scripts/run-pytest.sh tests/test_privilege_config.py -v`
Expected: PASS (5 tests)

- [ ] **Step 9: Run the full existing settings/connection suite to confirm no regression**

Run: `bash scripts/run-pytest.sh tests/test_mcp_streamable_http.py tests/test_mcp_connection.py -v`
Expected: PASS — unchanged, since this task only added fields and widened (never narrowed) the allowlist.

- [ ] **Step 10: Commit**

```bash
git add langchain_agent/src/config/settings.py langchain_agent/tests/test_privilege_config.py
git commit -m "feat(langchain_agent): add PrivilegeConfig and allow https:// in production MCP endpoints"
```

---

## Task 2: `privilege_auth.py` — PKCE and state helpers

**Files:**
- Create: `langchain_agent/src/mcp/privilege_auth.py`
- Test: `langchain_agent/tests/test_privilege_auth.py` (new)

**Interfaces:**
- Consumes: `UserAuthorizationFacilitator._generate_pkce_pair()` (static method, `langchain_agent/src/authentication/oauth_manager.py:810-830`) — returns `tuple[str, str]` = `(code_verifier, code_challenge)`.
- Produces: `generate_state() -> str`, `build_authorize_url(config: PrivilegeConfig, state: str, code_challenge: str) -> str`. Both consumed by Task 3.

- [ ] **Step 1: Write the failing test**

```python
# langchain_agent/tests/test_privilege_auth.py
"""
Unit tests for the Privilege OAuth PKCE flow (langchain_agent/src/mcp/privilege_auth.py).
"""
import re
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash scripts/run-pytest.sh tests/test_privilege_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.mcp.privilege_auth'`

- [ ] **Step 3: Write the minimal implementation**

```python
# langchain_agent/src/mcp/privilege_auth.py
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
import logging
import secrets
import string
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash scripts/run-pytest.sh tests/test_privilege_auth.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/mcp/privilege_auth.py langchain_agent/tests/test_privilege_auth.py
git commit -m "feat(langchain_agent): add Privilege PKCE state/authorize-URL helpers"
```

---

## Task 3: `privilege_auth.py` — callback server and token exchange

**Files:**
- Modify: `langchain_agent/src/mcp/privilege_auth.py` (append to the file from Task 2)
- Test: `langchain_agent/tests/test_privilege_auth.py` (append)

**Interfaces:**
- Consumes: `generate_state()`, `build_authorize_url()` (Task 2); `UserAuthorizationFacilitator._generate_pkce_pair()` (existing).
- Produces: `async def authorize_and_get_token(config: PrivilegeConfig, timeout_seconds: float = 120.0) -> AccessToken` — the entry point Task 4's CLI calls for `--server privilege`.

- [ ] **Step 1: Write the failing test**

Append to `langchain_agent/tests/test_privilege_auth.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash scripts/run-pytest.sh tests/test_privilege_auth.py -v`
Expected: FAIL — `ImportError: cannot import name 'authorize_and_get_token'`

- [ ] **Step 3: Write the minimal implementation**

Append to `langchain_agent/src/mcp/privilege_auth.py`:

```python
class _CallbackHandler(BaseHTTPRequestHandler):
    """Catches the single OAuth redirect GET and stores code/state on the server."""

    def do_GET(self):  # noqa: N802 - stdlib method name
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        self.server.captured_code = qs.get("code", [None])[0]
        self.server.captured_state = qs.get("state", [None])[0]
        self.server.captured_error = qs.get("error", [None])[0]

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


def _run_callback_server(port: int, timeout_seconds: float) -> "tuple[Optional[str], Optional[str]]":
    """Block until one GET hits the loopback callback, or timeout. Returns (code, state).

    Runs synchronously — the caller is expected to invoke this via
    loop.run_in_executor so it doesn't block the event loop.
    """
    server = HTTPServer(("127.0.0.1", port), _CallbackHandler)
    server.timeout = timeout_seconds
    server.captured_code = None
    server.captured_state = None
    server.captured_error = None
    server.handle_request()  # blocks for at most `timeout` seconds, then returns
    server.server_close()

    if server.captured_error:
        raise PrivilegeAuthError(f"Authorization server returned error: {server.captured_error}")
    if not server.captured_code:
        raise PrivilegeAuthError(
            f"No callback received within {timeout_seconds}s — authorization timed out"
        )
    return server.captured_code, server.captured_state


async def authorize_and_get_token(
    config: PrivilegeConfig, timeout_seconds: float = 120.0
) -> AccessToken:
    """Run the full Privilege OAuth Authorization Code + PKCE flow.

    Opens the system browser to PingOne Privilege's authorize endpoint,
    waits for the redirect on a local loopback server, then exchanges the
    code for a token via client_secret_basic. Raises PrivilegeAuthError on
    any failure (timeout, state mismatch, AS error, non-200 token response).
    """
    code_verifier, code_challenge = UserAuthorizationFacilitator._generate_pkce_pair()
    state = generate_state()
    authorize_url = build_authorize_url(config, state=state, code_challenge=code_challenge)

    logger.info(f"Opening browser for Privilege authorization: {authorize_url}")
    webbrowser.open(authorize_url)

    loop = __import__("asyncio").get_event_loop()
    code, returned_state = await loop.run_in_executor(
        None, _run_callback_server, config.callback_port, timeout_seconds
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
```

Add `import asyncio` to the top-level imports (replacing the inline `__import__("asyncio")` above — write it properly):

```python
import asyncio
import logging
import secrets
import string
import webbrowser
```

And change the body to `loop = asyncio.get_event_loop()` instead of the `__import__` form.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash scripts/run-pytest.sh tests/test_privilege_auth.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/mcp/privilege_auth.py langchain_agent/tests/test_privilege_auth.py
git commit -m "feat(langchain_agent): add Privilege OAuth PKCE callback server and token exchange"
```

---

## Task 4: `external_client.py` — the standalone CLI

**Files:**
- Create: `langchain_agent/src/mcp/external_client.py`
- Test: `langchain_agent/tests/test_external_client.py` (new)

**Interfaces:**
- Consumes: `MCPConnection`, `StreamableHttpMCPConnection` (`connection.py`); `authorize_and_get_token` (Task 3); `OAuthAuthenticationManager` (`authentication/oauth_manager.py:878`); `get_config`, `get_mcp_server_configs` (`config/settings.py`); `MCPServerConfig`, `AuthRequirements`, `AuthRequirementType`, `MCPToolCall` (`models/mcp.py`); `AccessToken` (`models/auth.py`).
- Produces: `async def run(server_name: str, tool_name: Optional[str], tool_args: Optional[dict]) -> dict` — the testable core (CLI `main()` is a thin argparse wrapper around it).

- [ ] **Step 1: Write the failing test**

```python
# langchain_agent/tests/test_external_client.py
"""
Unit tests for external_client.py's door-selection and connection wiring.
Both doors are exercised with mocked connections — no live network calls.
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _access_token(tok="test-token"):
    from src.models.auth import AccessToken
    return AccessToken(
        token=tok, token_type="Bearer", expires_in=3600,
        scope="read", issued_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_run_agent_gateway_uses_oauth_authentication_manager():
    from src.mcp import external_client

    mock_server_config = MagicMock()
    mock_server_config.endpoint = "ws://localhost:8080/mcp"

    mock_conn = AsyncMock()
    mock_conn.list_tools = AsyncMock(return_value=["get_my_accounts"])
    mock_conn.call_tool = AsyncMock(return_value={"accounts": ["chk-1"]})

    mock_auth_manager = AsyncMock()
    mock_auth_manager.get_client_credentials_token = AsyncMock(return_value=_access_token("gw-token"))
    mock_auth_manager.__aenter__ = AsyncMock(return_value=mock_auth_manager)
    mock_auth_manager.__aexit__ = AsyncMock(return_value=False)

    with patch.object(external_client, "_build_server_config", return_value=mock_server_config), \
         patch.object(external_client, "MCPConnection", return_value=mock_conn), \
         patch.object(external_client, "OAuthAuthenticationManager", return_value=mock_auth_manager):
        result = await external_client.run(
            server_name="agent_gateway", tool_name="get_my_accounts", tool_args={}
        )

    assert result == {"accounts": ["chk-1"]}
    mock_conn.call_tool.assert_called_once()
    # MCPConnection (WS) reads _agent_token, NOT _authorization_header —
    # the two connection classes use different attribute names (see
    # connection.py:130 vs :933). Assert the WS-specific one so a future
    # regression that sets the wrong attribute (silently sending no
    # Authorization header over WS) fails this test instead of shipping.
    assert mock_conn._agent_token == "gw-token"


@pytest.mark.asyncio
async def test_run_privilege_uses_pkce_flow():
    from src.mcp import external_client

    mock_server_config = MagicMock()
    mock_server_config.endpoint = "https://cmuir-agentless-mcpgw.ping-devops.com/app/mcp"

    mock_conn = AsyncMock()
    mock_conn.list_tools = AsyncMock(return_value=["get_my_accounts"])
    mock_conn.call_tool = AsyncMock(return_value={"accounts": ["chk-1"]})

    with patch.object(external_client, "_build_server_config", return_value=mock_server_config), \
         patch.object(external_client, "StreamableHttpMCPConnection", return_value=mock_conn), \
         patch.object(
             external_client, "authorize_and_get_token",
             new=AsyncMock(return_value=_access_token("priv-token")),
         ):
        result = await external_client.run(
            server_name="privilege", tool_name="get_my_accounts", tool_args={}
        )

    assert result == {"accounts": ["chk-1"]}
    assert mock_conn._authorization_header == "priv-token"


@pytest.mark.asyncio
async def test_run_list_tools_only_when_no_tool_name():
    from src.mcp import external_client

    mock_server_config = MagicMock()
    mock_server_config.endpoint = "ws://localhost:8080/mcp"

    mock_conn = AsyncMock()
    mock_conn.list_tools = AsyncMock(return_value=["get_my_accounts", "get_transactions"])

    mock_auth_manager = AsyncMock()
    mock_auth_manager.get_client_credentials_token = AsyncMock(return_value=_access_token())
    mock_auth_manager.__aenter__ = AsyncMock(return_value=mock_auth_manager)
    mock_auth_manager.__aexit__ = AsyncMock(return_value=False)

    with patch.object(external_client, "_build_server_config", return_value=mock_server_config), \
         patch.object(external_client, "MCPConnection", return_value=mock_conn), \
         patch.object(external_client, "OAuthAuthenticationManager", return_value=mock_auth_manager):
        result = await external_client.run(server_name="agent_gateway", tool_name=None, tool_args=None)

    assert result == {"tools": ["get_my_accounts", "get_transactions"]}
    mock_conn.call_tool.assert_not_called()


def test_invalid_server_name_raises_before_any_connection():
    from src.mcp import external_client
    import asyncio
    with pytest.raises(ValueError, match="server_name must be one of"):
        asyncio.get_event_loop().run_until_complete(
            external_client.run(server_name="bogus", tool_name=None, tool_args=None)
        )
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash scripts/run-pytest.sh tests/test_external_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.mcp.external_client'`

- [ ] **Step 3: Write the minimal implementation**

```python
# langchain_agent/src/mcp/external_client.py
"""
Standalone external MCP client — the "external agent" a person runs to reach
either front door (Agent Gateway or Privilege-agentless) and call a real
banking tool. Not part of the live LangGraph agent request path; a proof
harness and a usable minimal client in one.

Usage:
    python -m src.mcp.external_client --server agent_gateway
    python -m src.mcp.external_client --server privilege --call get_my_accounts '{}'
"""
import argparse
import asyncio
import json
import logging
import sys
import uuid
from typing import Any, Dict, Optional

from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.config.settings import get_config, get_mcp_server_configs
from src.mcp.connection import MCPConnection, StreamableHttpMCPConnection
from src.mcp.privilege_auth import authorize_and_get_token
from src.models.mcp import AuthRequirements, AuthRequirementType, MCPServerConfig, MCPToolCall

logger = logging.getLogger(__name__)

_VALID_SERVERS = ("agent_gateway", "privilege")


def _build_server_config(server_name: str) -> MCPServerConfig:
    """Look up MCP_SERVER_{NAME}_ENDPOINT for the given door and build a MCPServerConfig."""
    configured = get_mcp_server_configs()
    raw = configured.get(server_name)
    if not raw:
        raise ValueError(
            f"No MCP_SERVER_{server_name.upper()}_ENDPOINT configured for door {server_name!r}"
        )
    return MCPServerConfig(
        name=server_name,
        endpoint=raw["endpoint"],
        capabilities=raw.get("capabilities", []),
        auth_requirements=AuthRequirements(type=AuthRequirementType.AGENT_TOKEN, scopes=["read", "write"]),
    )


async def _get_agent_gateway_token(scopes: Optional[list] = None):
    """Reuse the live agent's own client-credentials mechanism (DCR + token fetch)."""
    async with OAuthAuthenticationManager() as auth_manager:
        return await auth_manager.get_client_credentials_token(additional_scopes=scopes)


async def run(
    server_name: str, tool_name: Optional[str], tool_args: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Connect to the named door, list tools, and optionally call one. Returns the result."""
    if server_name not in _VALID_SERVERS:
        raise ValueError(f"server_name must be one of {_VALID_SERVERS}, got {server_name!r}")

    server_config = _build_server_config(server_name)
    session_id = str(uuid.uuid4())

    if server_name == "agent_gateway":
        token = await _get_agent_gateway_token()
        connection_cls = StreamableHttpMCPConnection if server_config.endpoint.startswith(
            ("http://", "https://")
        ) else MCPConnection
    else:  # privilege
        token = await authorize_and_get_token(get_config().privilege)
        connection_cls = StreamableHttpMCPConnection

    conn = connection_cls(server_config)
    # Prime the bearer token before the first connect()/list_tools() call.
    # The two connection classes use DIFFERENT private attributes for this —
    # MCPConnection (WS) reads self._agent_token at connect() to set the
    # WebSocket handshake's Authorization header (connection.py:130,190-191);
    # StreamableHttpMCPConnection reads self._authorization_header on every
    # POST (connection.py:1139-1140). Both are already set the same way by
    # the existing test suite (test_mcp_connection.py, test_mcp_streamable_http.py:236)
    # — no new public setter needed, just the right attribute per class.
    if connection_cls is MCPConnection:
        conn._agent_token = token.token
    else:
        conn._authorization_header = token.token

    if tool_name is None:
        tools = await conn.list_tools()
        return {"tools": tools}

    tool_call = MCPToolCall(
        tool_name=tool_name,
        parameters=tool_args or {},
        agent_token=token,
        user_auth_code=None,
        session_id=session_id,
    )
    return await conn.call_tool(tool_call)


def _parse_args(argv):
    parser = argparse.ArgumentParser(description="External MCP client — reach either front door")
    parser.add_argument("--server", required=True, choices=_VALID_SERVERS, help="Which front door to use")
    parser.add_argument("--call", nargs=2, metavar=("TOOL_NAME", "JSON_ARGS"), default=None,
                         help="Tool to call and its JSON arguments, e.g. --call get_my_accounts '{}'")
    return parser.parse_args(argv)


async def main_async(argv):
    args = _parse_args(argv)
    tool_name, tool_args = None, None
    if args.call:
        tool_name, raw_args = args.call
        tool_args = json.loads(raw_args)

    result = await run(server_name=args.server, tool_name=tool_name, tool_args=tool_args)
    print(json.dumps(result, indent=2))


def main():
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main_async(sys.argv[1:]))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bash scripts/run-pytest.sh tests/test_external_client.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full new-file suite plus the existing MCP suite together**

Run: `bash scripts/run-pytest.sh tests/test_privilege_config.py tests/test_privilege_auth.py tests/test_external_client.py tests/test_mcp_streamable_http.py tests/test_mcp_connection.py -v`
Expected: PASS — all green, existing tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add langchain_agent/src/mcp/external_client.py langchain_agent/tests/test_external_client.py
git commit -m "feat(langchain_agent): add external_client.py CLI for both MCP front doors"
```

---

## Task 5: Manual end-to-end proof (Agent Gateway) and Privilege registration handoff

This task is **not automated** — it's the phase-1 "done" criterion from the spec, run against the live demo stack, plus the concrete handoff needed to unblock Privilege.

- [ ] **Step 1: Confirm `.env` has an Agent Gateway server endpoint configured**

Check `langchain_agent/.env` (or `.env.example` for the variable name) has `MCP_SERVER_AGENT_GATEWAY_ENDPOINT` (or whatever name matches the running `demo_mcp_gateway` instance — confirm against `langchain_agent/.env.example` and the live `./run.sh` / `run-docker.sh` config, since the exact server name in `MCP_SERVER_{NAME}_ENDPOINT` must match what `--server agent_gateway` looks up).

- [ ] **Step 2: Run the CLI against the live stack**

```bash
cd langchain_agent
python -m src.mcp.external_client --server agent_gateway --call get_my_accounts '{}'
```

Expected: JSON output containing real Super Sports account data (per this repo's default-vertical convention), proving the token + connection path end to end. If `MCP_TRANSPORT=streamable_http` is set, this exercises `StreamableHttpMCPConnection`; if unset (default `websocket`), it exercises `MCPConnection` over WS — both are covered by `_build_server_config`'s endpoint-scheme check.

- [ ] **Step 3: Hand off the Privilege registration requirement**

Privilege agentless needs a new PingOne OAuth client registered before `--server privilege` can run live. Per this plan's `PrivilegeConfig`, the registration needs:
- **redirect_uri**: `http://127.0.0.1:8765/callback` (or whatever `PRIVILEGE_MCP_CALLBACK_PORT` is set to in `.env`)
- **grant type**: Authorization Code
- **PKCE**: S256 required
- **token endpoint auth method**: `client_secret_basic`

Once registered, set `PRIVILEGE_MCP_CLIENT_ID`, `PRIVILEGE_MCP_CLIENT_SECRET`, `PRIVILEGE_MCP_AUTHORIZE_URL`, `PRIVILEGE_MCP_TOKEN_URL`, `PRIVILEGE_MCP_REDIRECT_URI`, and `MCP_SERVER_PRIVILEGE_ENDPOINT` (the agentless `/mcp` URL) in `langchain_agent/.env`, then run:

```bash
python -m src.mcp.external_client --server privilege --call get_my_accounts '{}'
```

Expected: a browser window opens for PingOne sign-in, then the same real account data comes back — proving the Privilege door.

- [ ] **Step 4: No commit for this task** — it's verification, not code. If step 2 fails, that's a bug in Tasks 1-4 to fix (re-open the relevant task, don't patch around it here).
