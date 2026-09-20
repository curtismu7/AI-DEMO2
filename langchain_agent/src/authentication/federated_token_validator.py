"""Allowlisted multi-issuer bearer validation for direct A2A calls."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Callable, Dict, Mapping, Optional, Tuple

import jwt
from jwt import InvalidTokenError, PyJWKClient


class TokenValidationError(Exception):
    """Raised when a customer bearer token cannot be trusted for A2A."""


@dataclass(frozen=True)
class TenantTrustRecord:
    tenant_id: str
    issuer: str
    jwks_uri: str
    audiences: Tuple[str, ...]
    scopes: Tuple[str, ...]
    metadata_url: str = ""


@dataclass(frozen=True)
class FederatedCaller:
    tenant_id: str
    sub: str
    email: Optional[str]
    scopes: Tuple[str, ...]


class FederatedTenantRegistry:
    def __init__(self, records: Mapping[str, TenantTrustRecord]):
        self.records: Dict[str, TenantTrustRecord] = dict(records)
        self.by_issuer: Dict[str, TenantTrustRecord] = {}
        for record in self.records.values():
            if record.issuer in self.by_issuer:
                raise ValueError(f"duplicate issuer: {record.issuer}")
            self.by_issuer[record.issuer] = record

    @classmethod
    def from_json(cls, raw: str) -> "FederatedTenantRegistry":
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError as exc:
            raise ValueError("A2A tenant registry must be valid JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("A2A tenant registry must be a JSON object")

        records = {}
        for tenant_id, value in payload.items():
            if not isinstance(tenant_id, str) or not tenant_id.strip():
                raise ValueError("A2A tenant ids must be non-empty strings")
            if not isinstance(value, dict):
                raise ValueError(f"tenant {tenant_id!r} must be an object")
            issuer = value.get("issuer")
            jwks_uri = value.get("jwks_uri")
            audiences = value.get("audiences")
            scopes = value.get("scopes")
            if not isinstance(issuer, str) or not issuer.startswith("https://"):
                raise ValueError(f"tenant {tenant_id!r} issuer must use https://")
            if not isinstance(jwks_uri, str) or not jwks_uri.startswith("https://"):
                raise ValueError(f"tenant {tenant_id!r} jwks_uri must use https://")
            if not isinstance(audiences, list) or not audiences or not all(isinstance(v, str) and v for v in audiences):
                raise ValueError(f"tenant {tenant_id!r} audiences must be a non-empty list")
            if not isinstance(scopes, list) or not scopes or not all(isinstance(v, str) and v for v in scopes):
                raise ValueError(f"tenant {tenant_id!r} scopes must be a non-empty list")
            metadata_url = value.get("metadata_url", "")
            if metadata_url and (not isinstance(metadata_url, str) or not metadata_url.startswith("https://")):
                raise ValueError(f"tenant {tenant_id!r} metadata_url must use https://")
            records[tenant_id] = TenantTrustRecord(
                tenant_id=tenant_id,
                issuer=issuer,
                jwks_uri=jwks_uri,
                audiences=tuple(audiences),
                scopes=tuple(scopes),
                metadata_url=metadata_url,
            )
        return cls(records)


class FederatedTokenValidator:
    def __init__(
        self,
        registry: FederatedTenantRegistry,
        *,
        leeway_seconds: int = 60,
        jwks_client_factory: Optional[Callable[[str], object]] = None,
    ):
        if not registry.records:
            raise ValueError("A2A federated tenant registry must not be empty")
        self.registry = registry
        self.leeway_seconds = leeway_seconds
        self._jwks_client_factory = jwks_client_factory or (lambda uri: PyJWKClient(uri, cache_keys=True))
        self._clients: Dict[str, object] = {}

    def _client(self, record: TenantTrustRecord) -> object:
        if record.issuer not in self._clients:
            self._clients[record.issuer] = self._jwks_client_factory(record.jwks_uri)
        return self._clients[record.issuer]

    def _signing_key(self, record: TenantTrustRecord, token: str):
        return self._client(record).get_signing_key_from_jwt(token).key

    def validate(self, token: str) -> FederatedCaller:
        if not token or not isinstance(token, str):
            raise TokenValidationError("Bearer token required")
        try:
            unverified = jwt.decode(token, options={"verify_signature": False})
            issuer = unverified.get("iss")
            record = self.registry.by_issuer.get(issuer)
            if record is None:
                raise TokenValidationError("issuer is not allowlisted")
            claims = jwt.decode(
                token,
                self._signing_key(record, token),
                algorithms=["RS256"],
                issuer=record.issuer,
                audience=list(record.audiences),
                leeway=self.leeway_seconds,
                options={"require": ["exp", "sub"]},
            )
        except TokenValidationError:
            raise
        except InvalidTokenError as exc:
            raise TokenValidationError("bearer token rejected") from exc
        except Exception as exc:
            raise TokenValidationError("bearer token validation failed") from exc

        raw_scope = claims.get("scope", "")
        scopes = tuple(raw_scope.split()) if isinstance(raw_scope, str) else tuple(raw_scope or ())
        missing = [scope for scope in record.scopes if scope not in scopes]
        if missing:
            raise TokenValidationError(f"required scope missing: {missing[0]}")
        return FederatedCaller(
            tenant_id=record.tenant_id,
            sub=str(claims["sub"]),
            email=next((str(claims[key]) for key in ("email", "preferred_username", "username") if claims.get(key)), None),
            scopes=scopes,
        )
