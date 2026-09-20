import json
from unittest.mock import MagicMock

import jwt
import pytest

from src.authentication.federated_token_validator import (
    FederatedTenantRegistry,
    FederatedTokenValidator,
    TenantTrustRecord,
    TokenValidationError,
)


def _token(claims):
    return jwt.encode(claims, "unused", algorithm="HS256")


def _registry():
    return FederatedTenantRegistry.from_json(json.dumps({
        "customer-a": {
            "issuer": "https://idp.a.example",
            "jwks_uri": "https://idp.a.example/jwks",
            "audiences": ["langchain-agent"],
            "metadata_url": "https://idp.a.example/.well-known/openid-configuration",
            "scopes": ["agent:invoke"],
        },
        "customer-b": {
            "issuer": "https://idp.b.example",
            "jwks_uri": "https://idp.b.example/jwks",
            "audiences": ["langchain-agent"],
            "metadata_url": "https://idp.b.example/.well-known/openid-configuration",
            "scopes": ["agent:invoke"],
        },
    }))


def test_registry_rejects_duplicate_issuers():
    with pytest.raises(ValueError, match="duplicate issuer"):
        FederatedTenantRegistry.from_json(json.dumps({
            "one": {"issuer": "https://same.example", "jwks_uri": "https://same.example/jwks", "audiences": ["a"], "scopes": ["agent:invoke"]},
            "two": {"issuer": "https://same.example", "jwks_uri": "https://same.example/jwks", "audiences": ["a"], "scopes": ["agent:invoke"]},
        }))


def test_validator_uses_validated_issuer_and_tenant_identity(monkeypatch):
    registry = _registry()
    validator = FederatedTokenValidator(registry, jwks_client_factory=lambda _uri: MagicMock())
    claims = {
        "iss": "https://idp.b.example",
        "sub": "user-42",
        "aud": "langchain-agent",
        "scope": "agent:invoke",
        "exp": 4102444800,
        "email": "user@example.test",
    }
    monkeypatch.setattr(validator, "_signing_key", lambda _record, _token: "unused")
    monkeypatch.setattr(jwt, "decode", lambda *args, **kwargs: claims)

    identity = validator.validate(_token(claims))

    assert identity.tenant_id == "customer-b"
    assert identity.sub == "user-42"
    assert identity.email == "user@example.test"
    assert identity.scopes == ("agent:invoke",)


def test_validator_rejects_unknown_issuer(monkeypatch):
    validator = FederatedTokenValidator(_registry(), jwks_client_factory=lambda _uri: MagicMock())
    claims = {"iss": "https://unknown.example", "sub": "u", "aud": "langchain-agent", "exp": 4102444800}
    monkeypatch.setattr(jwt, "decode", lambda *args, **kwargs: claims)

    with pytest.raises(TokenValidationError, match="issuer is not allowlisted"):
        validator.validate(_token(claims))


def test_validator_rejects_missing_scope(monkeypatch):
    validator = FederatedTokenValidator(_registry(), jwks_client_factory=lambda _uri: MagicMock())
    claims = {"iss": "https://idp.a.example", "sub": "u", "aud": "langchain-agent", "scope": "profile", "exp": 4102444800}
    monkeypatch.setattr(validator, "_signing_key", lambda _record, _token: "unused")
    monkeypatch.setattr(jwt, "decode", lambda *args, **kwargs: claims)

    with pytest.raises(TokenValidationError, match="required scope"):
        validator.validate(_token(claims))
