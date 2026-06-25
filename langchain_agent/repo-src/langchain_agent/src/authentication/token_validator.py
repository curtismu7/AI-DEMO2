"""
PingOne access-token validator (langchain_agent).

CR-02 / CR-04 (Path A): the langchain chat agent must derive user identity ONLY
from a cryptographically validated, PingOne-issued access token delivered by the
BFF proxy in the `session_init` message — never from a client-supplied
`user_id` / `userEmail` string.

This module is the minimal-but-correct validator the prior investigation said
did not exist:

  - fetches the PingOne JWKS (cached, refreshed on unknown `kid`),
  - verifies the JWT signature (RS256),
  - checks `exp` (with a small leeway) and ALWAYS verifies `iss`,
  - enforces `aud` against this agent's accepted audience list (T-5: every hop
    validates its own audience; a token minted for another audience does NOT
    cascade here).

No fallback to unauthenticated identity. A missing / invalid / expired /
wrong-audience token is a hard refusal (`TokenValidationError`).

Fail-loud policy: a validator with no configured audience or no derivable
issuer raises ValueError at construction — never a silent hardcoded fallback.
All configuration is read from the settings SSOT (config.settings.get_config),
not directly from os.environ.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx
import jwt
from jwt import PyJWKClient, InvalidTokenError

from config.settings import get_config

logger = logging.getLogger(__name__)


class TokenValidationError(Exception):
    """Raised when an access token cannot be validated. No identity is derived."""


@dataclass(frozen=True)
class ValidatedIdentity:
    """Identity derived strictly from validated token claims."""

    sub: str
    email: Optional[str]
    aud: List[str]
    raw_claims: Dict[str, Any]

    def __repr__(self) -> str:  # pragma: no cover - trivial, avoid leaking claims
        return f"ValidatedIdentity(sub={self.sub!r}, email={self.email!r})"


def _derive_jwks_uri(pingone) -> str:
    """
    Resolve the PingOne JWKS URI from the config SSOT.

    Priority:
      1. config.pingone.jwks_uri (LANGCHAIN_JWKS_URI / PINGONE_JWKS_URI override)
      2. Derived from config.pingone.token_endpoint by swapping the token path
         segment for the JWKS one (PingOne `/as/token` -> `/as/jwks`; ForgeRock
         `/access_token` -> `/connect/jwk_uri`).
    """
    if pingone.jwks_uri:
        return pingone.jwks_uri

    token_endpoint = pingone.token_endpoint or ""
    if not token_endpoint:
        raise ValueError(
            "Cannot resolve JWKS URI: set LANGCHAIN_JWKS_URI/PINGONE_JWKS_URI "
            "or PINGONE_TOKEN_ENDPOINT"
        )

    if token_endpoint.endswith("/as/token"):
        return token_endpoint[: -len("/as/token")] + "/as/jwks"
    if token_endpoint.endswith("/access_token"):
        return token_endpoint[: -len("/access_token")] + "/connect/jwk_uri"
    # Last resort: sibling 'jwks' path.
    return token_endpoint.rsplit("/", 1)[0] + "/jwks"


def _accepted_audiences(pingone) -> List[str]:
    """
    Audiences this agent will accept (T-5: validated as *its own* resource).

    Primary: config.pingone.resource_langchain_agent_uri
    (PINGONE_RESOURCE_LANGCHAIN_AGENT_URI — the dedicated langchain audience
    the BFF requests via RFC 8693).

    config.pingone.accepted_audiences (LANGCHAIN_ACCEPTED_AUDIENCES,
    comma-separated) may add extra accepted audiences. This exists ONLY so the
    demo is not dead while the dedicated PingOne resource server is being
    provisioned (see REGRESSION_PLAN §4 / REVIEW-FIX summary). It is an
    explicit, documented opt-in — not a silent cascade.

    Fail-loud: no configured audience raises ValueError — there is NO
    hardcoded fallback audience.
    """
    auds: List[str] = []
    primary = pingone.resource_langchain_agent_uri
    if primary:
        auds.append(primary)
    for a in (pingone.accepted_audiences or "").split(","):
        a = a.strip()
        if a and a not in auds:
            auds.append(a)
    if not auds:
        raise ValueError(
            "No accepted audience configured: set "
            "PINGONE_RESOURCE_LANGCHAIN_AGENT_URI (and optionally "
            "LANGCHAIN_ACCEPTED_AUDIENCES) — refusing to start with no audience check"
        )
    return auds


def _derive_issuer(pingone) -> str:
    """
    Resolve the token issuer from the config SSOT.

    Priority:
      1. config.pingone.issuer (PINGONE_ISSUER explicit override)
      2. Derived from config.pingone.token_endpoint: the issuer is the base of
         the token endpoint (PingOne `https://auth.pingone.com/<envId>/as/token`
         -> `https://auth.pingone.com/<envId>/as`; ForgeRock `/access_token`
         is stripped the same way).

    Fail-loud: raises ValueError when the issuer cannot be derived — `iss` is
    ALWAYS verified, never skipped.
    """
    if pingone.issuer:
        return pingone.issuer

    token_endpoint = pingone.token_endpoint or ""
    if token_endpoint.endswith("/as/token"):
        return token_endpoint[: -len("/token")]
    if token_endpoint.endswith("/access_token"):
        return token_endpoint[: -len("/access_token")]
    if "/" in token_endpoint.rstrip("/"):
        base = token_endpoint.rstrip("/").rsplit("/", 1)[0]
        if base.startswith(("http://", "https://")) and base not in ("http:/", "https:/"):
            return base
    raise ValueError(
        "Cannot derive token issuer: set PINGONE_ISSUER or a valid "
        "PINGONE_TOKEN_ENDPOINT — refusing to start without `iss` verification"
    )


class PingOneTokenValidator:
    """
    Validates PingOne-issued JWT access tokens against the PingOne JWKS.

    Thread-safe; the underlying PyJWKClient maintains its own keyset cache and
    re-fetches on an unknown `kid`.
    """

    def __init__(
        self,
        jwks_uri: Optional[str] = None,
        accepted_audiences: Optional[List[str]] = None,
        issuer: Optional[str] = None,
        leeway_seconds: int = 60,
    ) -> None:
        # Config SSOT is consulted only for pieces not explicitly provided.
        pingone = None
        if not (jwks_uri and accepted_audiences and issuer):
            pingone = get_config().pingone
        self._jwks_uri = jwks_uri or _derive_jwks_uri(pingone)
        self._accepted_audiences = accepted_audiences or _accepted_audiences(pingone)
        # `iss` is ALWAYS verified — construction fails when no issuer can be
        # resolved (PINGONE_ISSUER or derived from the token endpoint).
        self._issuer = issuer or _derive_issuer(pingone)
        self._leeway = leeway_seconds
        self._lock = threading.Lock()
        self._jwk_client: Optional[PyJWKClient] = None
        logger.info(
            "PingOneTokenValidator initialised (jwks_uri=%s, audiences=%s, issuer=%s)",
            self._jwks_uri,
            self._accepted_audiences,
            self._issuer,
        )

    def _client(self) -> PyJWKClient:
        with self._lock:
            if self._jwk_client is None:
                self._jwk_client = PyJWKClient(self._jwks_uri, cache_keys=True)
            return self._jwk_client

    def validate(self, token: str) -> ValidatedIdentity:
        """
        Validate a bearer token and return the identity derived from its claims.

        Raises TokenValidationError on any failure. Never returns a partial /
        unverified identity.
        """
        if not token or not isinstance(token, str):
            raise TokenValidationError("No token supplied")

        try:
            signing_key = self._client().get_signing_key_from_jwt(token)
        except Exception as exc:  # noqa: BLE001 - normalise to our error type
            raise TokenValidationError(f"Could not resolve signing key: {exc}") from exc

        decode_kwargs: Dict[str, Any] = {
            "algorithms": ["RS256"],
            "audience": self._accepted_audiences,
            "issuer": self._issuer,
            "leeway": self._leeway,
            "options": {"require": ["exp", "sub"]},
        }

        try:
            claims = jwt.decode(token, signing_key.key, **decode_kwargs)
        except InvalidTokenError as exc:
            raise TokenValidationError(f"Token rejected: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            raise TokenValidationError(f"Token validation failed: {exc}") from exc

        sub = claims.get("sub")
        if not sub:
            raise TokenValidationError("Token has no 'sub' claim")

        aud_claim = claims.get("aud")
        aud_list = aud_claim if isinstance(aud_claim, list) else ([aud_claim] if aud_claim else [])

        # Identity comes ONLY from the validated token. Prefer standard OIDC
        # email claim; fall back to PingOne profile claim names.
        email = (
            claims.get("email")
            or claims.get("preferred_username")
            or claims.get("username")
        )

        logger.info("Token validated for sub=%s (aud=%s)", sub, aud_list)
        return ValidatedIdentity(
            sub=str(sub),
            email=str(email) if email else None,
            aud=[str(a) for a in aud_list],
            raw_claims=claims,
        )


# Module-level singleton (lazy) so the JWKS keyset cache is shared.
_validator_singleton: Optional[PingOneTokenValidator] = None
_singleton_lock = threading.Lock()


def get_token_validator() -> PingOneTokenValidator:
    """Return the process-wide validator, constructing it on first use."""
    global _validator_singleton
    if _validator_singleton is None:
        with _singleton_lock:
            if _validator_singleton is None:
                _validator_singleton = PingOneTokenValidator()
    return _validator_singleton
