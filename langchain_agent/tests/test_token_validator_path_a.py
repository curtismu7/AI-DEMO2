"""
Path A (CR-02/CR-04) — PingOne token validator + token-derived identity.

Covers the task's required cases:
  * valid token -> identity from `sub` (+ email claim)
  * client-supplied user_id with no token -> refused
  * user_id=victim + valid token for attacker -> bound to attacker
  * invalid / expired / wrong-aud token -> refused
"""
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from src.authentication.token_validator import (
    PingOneTokenValidator,
    TokenValidationError,
    _accepted_audiences,
    _derive_issuer,
)

AUD = "https://banking-langchain-agent.banking-demo.com"
ISS = "https://auth.pingone.test/env-1/as"
KID = "test-key-1"


@pytest.fixture(scope="module")
def rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def validator(rsa_key, monkeypatch):
    """A validator whose JWKS client returns our in-test public key."""
    v = PingOneTokenValidator(
        jwks_uri="https://example.invalid/as/jwks",
        accepted_audiences=[AUD],
        issuer=ISS,
    )

    class _FakeSigningKey:
        def __init__(self, key):
            self.key = key

    class _FakeJWKClient:
        def __init__(self, pub):
            self._pub = pub

        def get_signing_key_from_jwt(self, token):
            return _FakeSigningKey(self._pub)

    pub = rsa_key.public_key()
    monkeypatch.setattr(v, "_client", lambda: _FakeJWKClient(pub))
    return v


def _mint(rsa_key, *, sub, email=None, aud=AUD, iss=ISS, exp_delta=600, extra=None):
    claims = {"sub": sub, "aud": aud, "exp": int(time.time()) + exp_delta}
    if iss is not None:
        claims["iss"] = iss
    if email is not None:
        claims["email"] = email
    if extra:
        claims.update(extra)
    pem = rsa_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(claims, pem, algorithm="RS256", headers={"kid": KID})


def test_valid_token_identity_from_sub(validator, rsa_key):
    token = _mint(rsa_key, sub="ping-user-123", email="alice@example.com")
    identity = validator.validate(token)
    assert identity.sub == "ping-user-123"
    assert identity.email == "alice@example.com"
    assert AUD in identity.aud


def test_no_token_refused(validator):
    with pytest.raises(TokenValidationError):
        validator.validate("")
    with pytest.raises(TokenValidationError):
        validator.validate(None)  # type: ignore[arg-type]


def test_victim_user_id_bound_to_attacker_identity(validator, rsa_key):
    """A token minted for 'attacker' yields the attacker identity regardless of
    any client-supplied 'user_id' (which the validator never reads)."""
    token = _mint(rsa_key, sub="attacker-sub", email="attacker@example.com")
    identity = validator.validate(token)
    # Identity is derived ONLY from token claims — never from a claimed user_id.
    assert identity.sub == "attacker-sub"
    assert identity.email == "attacker@example.com"


def test_expired_token_refused(validator, rsa_key):
    token = _mint(rsa_key, sub="u1", email="u1@example.com", exp_delta=-3600)
    with pytest.raises(TokenValidationError):
        validator.validate(token)


def test_wrong_audience_refused(validator, rsa_key):
    token = _mint(
        rsa_key,
        sub="u1",
        email="u1@example.com",
        aud="https://some-other-resource.example.com",
    )
    with pytest.raises(TokenValidationError):
        validator.validate(token)


def test_tampered_signature_refused(validator, rsa_key):
    token = _mint(rsa_key, sub="u1", email="u1@example.com")
    tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    with pytest.raises(TokenValidationError):
        validator.validate(tampered)


def test_missing_sub_refused(validator, rsa_key):
    # jwt.decode with options.require=['sub'] rejects a token without sub.
    pem = rsa_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    token = jwt.encode(
        {"aud": AUD, "iss": ISS, "exp": int(time.time()) + 600, "email": "x@example.com"},
        pem,
        algorithm="RS256",
        headers={"kid": KID},
    )
    with pytest.raises(TokenValidationError):
        validator.validate(token)


def test_wrong_issuer_refused(validator, rsa_key):
    token = _mint(rsa_key, sub="u1", iss="https://evil.example.com/as")
    with pytest.raises(TokenValidationError):
        validator.validate(token)


def test_missing_issuer_refused(validator, rsa_key):
    """`iss` is ALWAYS verified — a token without an iss claim is refused."""
    token = _mint(rsa_key, sub="u1", iss=None)
    with pytest.raises(TokenValidationError):
        validator.validate(token)


def test_no_configured_audience_raises_at_construction():
    """Fail-loud: no audience config -> ValueError, no hardcoded fallback."""
    pingone = SimpleNamespace(resource_langchain_agent_uri="", accepted_audiences="")
    with pytest.raises(ValueError, match="No accepted audience"):
        _accepted_audiences(pingone)


def test_issuer_derived_from_pingone_token_endpoint():
    pingone = SimpleNamespace(
        issuer="", token_endpoint="https://auth.pingone.com/env-1/as/token"
    )
    assert _derive_issuer(pingone) == "https://auth.pingone.com/env-1/as"


def test_issuer_underivable_raises():
    pingone = SimpleNamespace(issuer="", token_endpoint="")
    with pytest.raises(ValueError, match="Cannot derive token issuer"):
        _derive_issuer(pingone)
