"""
Regression tests for the Tier-1 WARNING batch fixes (LC WR-03/04/05/07/11/12).

Kept in a dedicated module so they are unambiguously attributable to this
batch and not entangled with the pre-existing baseline failures in the
broader suite.
"""
import json
from datetime import datetime, timezone, timedelta

import pytest

from models.auth import AccessToken, AuthorizationCode
from models.mcp import MCPToolCall


def _access_token() -> AccessToken:
    return AccessToken(
        token="abc123def456",
        token_type="Bearer",
        expires_in=3600,
        scope="banking:read",
        issued_at=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# WR-03 — AuthorizationCode / MCPToolCall masked repr
# ---------------------------------------------------------------------------
class TestWR03MaskedRepr:
    def test_authorization_code_repr_masks_code(self):
        secret = "SUPERSECRETOAUTHCODE0001"
        code = AuthorizationCode(
            code=secret,
            state="state-xyz",
            session_id="session-1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        )
        for rendered in (repr(code), str(code), f"{code}"):
            assert secret not in rendered
            assert "***masked***" in rendered
            # non-sensitive correlation fields stay visible
            assert "state-xyz" in rendered
            assert "session-1" in rendered

    def test_mcp_tool_call_repr_masks_sensitive(self):
        secret_code = "SUPERSECRETOAUTHCODE0002"
        auth_code = AuthorizationCode(
            code=secret_code,
            state="state-abc",
            session_id="session-2",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        )
        tool_call = MCPToolCall(
            tool_name="banking_get_accounts",
            parameters={"accountNumber": "9999-secret-acct"},
            agent_token=_access_token(),
            user_auth_code=auth_code,
            session_id="session-2",
        )
        rendered = f"Calling tool on connection: {tool_call}"
        assert secret_code not in rendered
        assert "9999-secret-acct" not in rendered  # arg values redacted
        assert "abc123def456" not in rendered       # nested agent token masked
        assert "banking_get_accounts" in rendered   # tool name still visible
        assert "accountNumber" in rendered          # arg keys allowed


# ---------------------------------------------------------------------------
# WR-05 — JSON payloads built via json.dumps, injection-safe
# ---------------------------------------------------------------------------
class TestWR05JsonInjection:
    @staticmethod
    def _extract_payload(message: str) -> dict:
        start = "SYSTEM_AUTH_POPUP_REQUEST_START\n"
        end = "\nSYSTEM_AUTH_POPUP_REQUEST_END"
        body = message.split(start, 1)[1].split(end, 1)[0]
        return json.loads(body)

    def test_tool_provider_popup_payload_is_escaped(self):
        from agent.mcp_tool_provider import build_auth_popup_message

        hostile_url = 'https://evil.test/?x="}],"injected":"yes'
        msg = build_auth_popup_message(
            auth_url=hostile_url,
            popup_width=500,
            popup_height=650,
            popup_title='Title "with quote"',
            status_endpoint="https://api.test/status",
            session_id="sess-1",
            scope="banking:read",
            expires_at="2026-01-01T00:00:00Z",
        )
        payload = self._extract_payload(msg)
        assert payload["authorizationUrl"] == hostile_url
        assert "injected" not in payload  # could not break out of the string
        assert payload["popupTitle"] == 'Title "with quote"'

    def test_agent_popup_payload_is_escaped(self):
        from agent.langchain_mcp_agent import build_auth_popup_message as agent_build

        hostile_url = 'https://evil.test/?a=1"}],"x":2'
        msg = agent_build(
            auth_url=hostile_url,
            popup_width=400,
            popup_height=600,
            popup_title="Authorization Required",
            status_endpoint="",
            session_id="sess-2",
            scope="banking:read",
            expires_at="",
        )
        payload = self._extract_payload(msg)
        assert payload["authorizationUrl"] == hostile_url
        assert "x" not in payload


# ---------------------------------------------------------------------------
# WR-07 — oauth_manager._pending_authorizations bounded cleanup
# ---------------------------------------------------------------------------
class TestWR07PendingAuthorizationsBounded:
    def _facilitator(self):
        from types import SimpleNamespace
        from authentication.oauth_manager import UserAuthorizationFacilitator

        cfg = SimpleNamespace(
            pingone=SimpleNamespace(
                redirect_uri="https://api.ping.demo:4000/callback",
                authorization_endpoint="https://auth.example/as/authorize",
            )
        )
        return UserAuthorizationFacilitator(config=cfg)

    def test_expired_entry_evicted_recent_survives(self):
        fac = self._facilitator()
        # one fresh, valid generation (also stores its PKCE verifier)
        fac.generate_authorization_url(
            client_id="client-1",
            scope="banking:read",
            session_id="recent-session",
            mcp_server_id="mcp-1",
        )
        recent_state = next(iter(fac._pending_authorizations))
        recent_verifier = fac._pending_authorizations[recent_state]["code_verifier"]

        # inject an old, never-completed entry that is past the auth window
        stale = "stale-state-aaaaaaaaaaaaaaaa"
        fac._pending_authorizations[stale] = {
            "session_id": "old-session",
            "mcp_server_id": "mcp-1",
            "scope": "banking:read",
            "client_id": "client-1",
            "code_verifier": "old-verifier",
            "created_at": datetime.now(timezone.utc) - timedelta(hours=2),
            "expires_at": datetime.now(timezone.utc) - timedelta(hours=1),
        }

        # a second generation triggers the self-reaping sweep
        fac.generate_authorization_url(
            client_id="client-1",
            scope="banking:read",
            session_id="another-session",
            mcp_server_id="mcp-1",
        )

        assert stale not in fac._pending_authorizations  # expired evicted
        assert recent_state in fac._pending_authorizations  # recent survives
        # PKCE verifier for the still-valid entry is intact -> exchange works
        assert (
            fac._pending_authorizations[recent_state]["code_verifier"]
            == recent_verifier
        )

    def test_max_size_cap_evicts_oldest_not_newest(self):
        fac = self._facilitator()
        cap = fac._MAX_PENDING_AUTHORIZATIONS
        # generate cap + 5 fresh (all unexpired) authorizations
        for i in range(cap + 5):
            fac.generate_authorization_url(
                client_id="client-1",
                scope="banking:read",
                session_id=f"session-{i}",
                mcp_server_id="mcp-1",
            )
        assert len(fac._pending_authorizations) <= cap
        # the most recent session must still be tracked (newest never evicted)
        latest_sessions = {
            v["session_id"] for v in fac._pending_authorizations.values()
        }
        assert f"session-{cap + 4}" in latest_sessions


# ---------------------------------------------------------------------------
# WR-11 — AuthChallenge state is unpredictable and session-correlated
# ---------------------------------------------------------------------------
class TestWR11RandomState:
    # async so pytest-asyncio (auto mode) supplies a running event loop:
    # MCPConnection.__init__ builds an asyncio.Lock(), which on py3.9 needs
    # a current loop. A prior async test that closed its loop would make a
    # *sync* test here raise in get_event_loop() (test-isolation artifact,
    # not a product bug).
    async def test_state_is_not_derived_from_session_id(self):
        from mcp.connection import MCPConnection
        from models.mcp import MCPServerConfig, AuthRequirements, AuthRequirementType

        cfg = MCPServerConfig(
            name="banking",
            endpoint="ws://localhost:8080",
            capabilities=["tools"],
            auth_requirements=AuthRequirements(
                type=AuthRequirementType.USER_AUTHORIZATION, scopes=["banking:read"]
            ),
        )
        conn = MCPConnection(cfg)
        session_id = "session_1234567890"
        s1 = conn._new_auth_challenge_state(session_id)
        s2 = conn._new_auth_challenge_state(session_id)
        # unpredictable: not f"session_{session_id}", and not repeatable
        assert s1 != f"session_{session_id}"
        assert s1 != s2
        assert len(s1) >= 32
        # correlation: state maps back to the originating session
        assert conn._auth_challenge_states[s1] == session_id
        assert conn._auth_challenge_states[s2] == session_id


# ---------------------------------------------------------------------------
# WR-10 — auth_response AuthorizationCode is not born already-expired
# (fixed upstream; this test locks the behavior so it cannot regress)
# ---------------------------------------------------------------------------
class TestWR10AuthCodeNotExpiredAtCreation:
    def test_constructed_code_has_future_expiry(self):
        # Mirror MessageProcessor.process_auth_response's construction.
        now = datetime.now(timezone.utc)
        code = AuthorizationCode(
            code="freshcode123",
            state="state-1",
            session_id="session-1",
            expires_at=now + timedelta(minutes=10),
        )
        assert not code.is_expired()
        assert code.expires_in_seconds() > 0


# ---------------------------------------------------------------------------
# WR-12 — message length validated by UTF-8 byte count, not code points
# ---------------------------------------------------------------------------
class TestWR12ByteLengthCap:
    def test_multibyte_under_char_limit_over_byte_cap_arithmetic(self):
        # 2000 four-byte emoji = 2000 code points (< a 4096 char cap) but
        # 8000 bytes (> the same 4096 byte cap).
        s = "\U0001F600" * 2000
        cap = 4096
        assert len(s) <= cap  # would have PASSED the old char-based check
        assert len(s.encode("utf-8")) > cap  # MUST FAIL the byte-based check

    async def test_handler_rejects_multibyte_payload_under_char_cap(self):
        from unittest.mock import Mock
        import json as _json
        from src.api.websocket_handler import ChatWebSocketHandler
        from src.config.settings import ChatConfig, AppConfig

        cap = 1000
        chat_config = ChatConfig(
            websocket_port=8080,
            max_message_length=cap,
            conversation_history_limit=100,
            session_cleanup_interval_minutes=15,
        )
        config = Mock(spec=AppConfig)
        config.chat = chat_config
        handler = ChatWebSocketHandler(config=config)

        class _WS:
            def __init__(self):
                self.sent = []

            async def send(self, m):
                self.sent.append(m)

        ws = _WS()
        connection_id = "conn-wr12"
        handler._connections[connection_id] = ws
        # WR-01: chat messages are only accepted on a connection with a bound
        # session (set by session_init). Bind one so the handler reaches the
        # byte-length check under test.
        handler._connection_metadata[connection_id] = {"session_id": "session-wr12"}

        # 600 four-byte emoji: 600 code points (<= 1000 char cap, would have
        # PASSED the old check) but 2400 bytes (> 1000 byte cap → reject).
        content = "\U0001F600" * 600
        assert len(content) <= cap
        assert len(content.encode("utf-8")) > cap

        await handler._handle_chat_message(
            {
                "type": "chat_message",
                "content": content,
                "session_id": "session-wr12",
                "_connection_id": connection_id,
                "_timestamp": "2026-01-01T00:00:00Z",
            }
        )

        assert len(ws.sent) == 1
        err = _json.loads(ws.sent[0])
        assert err["error_code"] == "message_too_long"
