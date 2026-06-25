# Runtime-switchable token validation mode (introspection vs. JWT)

**Status:** accepted

## Context

The BFF validates every incoming request token using one of two strategies:

- **Introspection mode** (RFC 7662) — calls PingOne's `/as/introspect` endpoint on each request. Detects revoked tokens within the introspection cache TTL. Requires a live PingOne connection per request.
- **JWT mode** (RFC 7519) — validates the token's signature and claims locally using a cached JWKS. Fast and offline-capable, but cannot detect revocation until the token expires.

A learning demo needs to let instructors switch modes live to illustrate the tradeoff: "what happens when a token is revoked but the server only checks the signature?"

## Decision

`tokenValidationService.js` reads `configStore.getEffective('token_validation_mode')` on every call rather than at startup. The admin Config UI (and `POST /api/config/validation-mode`) can flip the mode without restarting the server.

## Consequences

**Why this is safe for a learning app:** The mode toggle is the *point* — learners are meant to observe the difference. Showing a revoked token still passing JWT validation is the demonstration, not a bug.

**Why this would be risky in production:** Any admin session can silently weaken validation. A production deployment should lock the mode via a `FORCE_INTROSPECTION=true` env var that the API cannot override, and log all mode changes to an append-only audit trail.

## Trade-offs

| | Introspection | JWT |
|---|---|---|
| Revocation detection | Within cache TTL | Never (until exp) |
| Latency | +1 PingOne RTT per request | Local verify only |
| PingOne dependency | Required per request | JWKS fetch only (cached) |
| Demo teaching value | Shows "token is alive" check | Shows "signature proves origin" |
