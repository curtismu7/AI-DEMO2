"""JWKS URL allowlist. The LLM picks jwksUri / uri, so the verifier must only
fetch from PingOne's own JWKS host (docs/superpowers/plans/
2026-09-11-user-token-custody.md, gap 4).

Run: python test_jwks_allowlist.py   (pytest also collects it)
"""

import os

os.environ.setdefault("PINGONE_JWKS_URI", "https://auth.pingone.com/env-1/as/jwks")
os.environ.setdefault("PINGONE_ISSUER", "https://auth.pingone.com/env-1/as")
os.environ.setdefault("MCP_JWTVERIFIER_RESOURCE_URI", "mcp-jwt-verifier.ping.demo")

import server  # noqa: E402

TOKEN = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJ1In0.c2ln"  # gitleaks:allow — fake test JWT, not a credential


def _tool(t):
    return getattr(t, "fn", t)


def test_pingone_jwks_host_is_allowed():
    assert server._jwks_uri_allowed("https://auth.pingone.com/env-1/as/jwks")


def test_other_hosts_and_plain_http_are_refused():
    for uri in (
        "http://169.254.169.254/latest/meta-data",
        "https://evil.example/jwks",
        "http://auth.pingone.com/env-1/as/jwks",
        "https://auth.pingone.com.evil.example/jwks",
    ):
        assert not server._jwks_uri_allowed(uri), uri


def test_verify_signature_refuses_before_fetching():
    out = _tool(server.jwt_verify_signature)(token=TOKEN, jwksUri="http://169.254.169.254/")
    assert out == {"valid": False, "error": "jwks_uri_not_allowed"}, out


def test_fetch_jwks_refuses_before_fetching():
    try:
        _tool(server.jwt_fetch_jwks)(uri="http://169.254.169.254/")
    except ValueError as err:
        assert "jwks_uri_not_allowed" in str(err)
    else:
        raise AssertionError("expected ValueError")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
