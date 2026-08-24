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
