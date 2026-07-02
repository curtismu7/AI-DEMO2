# RFC 9470 Step-Up Authentication Challenge — Design Spec

**Date:** 2026-07-02
**Status:** Approved design, pending implementation plan
**Feature flag:** `ff_rfc9470_challenge` (default OFF)

## Background

The demo already implements step-up authentication, but with a proprietary wire
format: the banking step-up gate returns **HTTP 428** with a JSON body
(`error: "step_up_required"`, `step_up_acr`, `step_up_method`, `step_up_url`).
[RFC 9470](https://datatracker.ietf.org/doc/rfc9470/) standardizes this
signaling as **HTTP 401** with a `WWW-Authenticate: Bearer` challenge:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="insufficient_user_authentication",
  error_description="A different authentication level is required",
  acr_values="Multi_Factor",
  max_age="0"
```

The client re-runs the authorization code flow passing `acr_values` /
`max_age` through as standard OIDC parameters, and the resource server
verifies satisfaction via the `acr` and `auth_time` token claims.

This project adds a spec-compliant mode behind a feature flag, plus in-app
education, and closes one compliance gap in the existing gate (`auth_time`
freshness is not enforced server-side today).

## Decisions made during brainstorming

| Question | Decision |
| --- | --- |
| Relationship to existing 428 flow | **Mode switch**: one flag; OFF = today's 428+JSON, ON = RFC 9470 401+header. Same gate logic, different wire format, live-toggleable for demos. |
| Scope | **Banking step-up gate only**, implemented at the shared service layer so every vertical flowing through the gate behaves correctly. No agent/MCP path changes. |
| Education | **In-app**: scenario copy, raw challenge display in the token flow inspector, flag description. |
| Approach | **B — small challenge builder/parser modules** (over inline branching or generic middleware). |

## Current state (verified seams)

- Step-up body built in `buildStepUpBody()` —
  `demo_api_server/services/transactionAuthorizationService.js:34`; blocks
  carry `status: 428`.
- Blocks emitted generically at `demo_api_server/routes/transactions.js:590`
  (`res.status(authz.block.status).json(body)`).
- Re-auth route `GET /api/auth/oauth/user/stepup` already sends
  `acr_values` + `max_age=0` to PingOne
  (`demo_api_server/routes/oauthUser.js:703`).
- Token validation extracts `acr`/`amr`/`auth_time`
  (`demo_api_server/middleware/auth.js`); the gate checks `acr` only —
  `auth_time` freshness is never validated.
- UI consumes the 428 body in
  `demo_api_ui/src/components/UserDashboardPing2026.js` (~line 1077,
  `step_up_method` / `step_up_acr` fields) and routes into OTP/CIBA/passkey
  modals.
- Feature-flag registry: `demo_api_server/routes/featureFlags.js` +
  `demo_api_server/config/runtimeSettings.js`; flags read via
  `configStore.getEffective()`.
- Vite dev proxy makes UI→BFF same-origin; `cors()` at
  `demo_api_server/server.js:285` governs any cross-origin access.

## Design

### 1. Feature flag

`ff_rfc9470_challenge`, default **OFF**, registered in `featureFlags.js`
under the existing "Step-Up Auth" category, read via
`configStore.getEffective()`. OFF preserves byte-identical current behavior.
Toggleable live from the admin feature-flags UI.

### 2. Backend — challenge module + gate wiring

New `demo_api_server/services/rfc9470.js` with two pure functions:

- `buildChallengeHeader({ acrValues, maxAge, errorDescription })` → the
  header value string `Bearer error="insufficient_user_authentication",
  error_description="...", acr_values="...", max_age="..."`. Handles quoting
  and space-separated multiple ACR values.
- `parseChallengeHeader(str)` → inverse; used for round-trip tests.

Step-up block construction in `transactionAuthorizationService.js` becomes
flag-aware (note: `buildStepUpBody()` returns only the body; `status` is
attached at the block construction sites, e.g. lines 176/229/335): when ON,
the block is
`{ status: 401, headers: { 'WWW-Authenticate': <built header> }, body }`.
The JSON body is **kept in both modes** (it carries demo conveniences:
`step_up_url`, `step_up_method`, `authorize_engine`), but in RFC mode the
header is the normative signal and the UI parses it. The emission point in
`transactions.js` gains one addition: apply `block.headers` when present.

Gate decision logic, thresholds, transaction types, and vertical behavior
are unchanged.

Rider (small, scoped): add `exposedHeaders: ['WWW-Authenticate']` to the
existing `cors()` config in `server.js` so the header remains readable
cross-origin (dev is same-origin via the Vite proxy; this is belt-and-braces).

### 3. Backend — `auth_time` freshness enforcement

New runtime setting `stepUpMaxAge` (seconds, default `0` = disabled,
preserving current behavior). When > 0:

- The gate additionally requires `now − auth_time ≤ stepUpMaxAge`, even when
  the `acr` claim is sufficient.
- The emitted challenge's `max_age` reflects the configured value instead of
  the hard-coded `0`.

Applies in both flag modes (policy fix, not wire format).

### 4. Frontend — parser + normalized handling

New `demo_api_ui/src/utils/wwwAuthenticate.js`: parses a
`WWW-Authenticate` value into
`{ scheme, error, error_description, acr_values: [], max_age }`.

In the transaction error handling in `UserDashboardPing2026.js`: a 401 whose
`WWW-Authenticate` parses to `error="insufficient_user_authentication"` is
normalized into the same shape the 428 body produces today and fed into the
existing step-up entry point (`beginStepUp()`,
`UserDashboardPing2026.js:1078`), reusing the OTP/CIBA/
passkey modals and the `/api/auth/oauth/user/stepup` return flow unchanged.

**Ordering constraint:** the UI treats generic 401 as "session expired →
sign in." On this call path the step-up discriminator (header error code)
MUST be checked before any generic 401 handling. This gets a dedicated test.

**Fallback:** malformed or missing header in RFC mode → read the JSON body
fields instead, with a console warning (demo resilience over hard failure).

### 5. In-app education

- **Scenario copy** (`demo_api_ui/src/config/architecture-sim-scenarios.js`,
  `step-up-mfa` scenario): explain both modes — 428+body as the
  pre-standard/proprietary pattern, 401 + `WWW-Authenticate:
  error="insufficient_user_authentication"` as the RFC 9470 standard — and
  why standardization matters (any conforming client interoperates).
- **Raw challenge visibility** (scope reduced during implementation —
  recorded deviation): the raw `WWW-Authenticate` header is shown on the
  step-up toast (Ping2026 skin) and appears in the API traffic inspector
  via the existing response-header capture. The originally specified
  per-parameter breakdown in the token flow inspector step details was
  not implemented; the `acr_values`/`max_age` semantics are taught in the
  step-up scenario copy instead.
- **Flag description** in the admin UI doubles as micro-education
  ("RFC 9470 standard challenge vs legacy 428").

## Error handling summary

| Failure | Behavior |
| --- | --- |
| Malformed challenge header (UI) | Fall back to JSON body fields; console warning |
| Generic 401 (no step-up challenge) | Existing session-expired handling, unchanged |
| Stale `auth_time` with sufficient `acr` (when `stepUpMaxAge` > 0) | Challenge emitted with configured `max_age` |
| Flag OFF | All paths byte-identical to today |

## Testing / success criteria

- **Unit:** header builder + parser round-trip (quoting, multi-ACR, missing
  params, malformed input).
- **Gate:** extend `demo_api_server/src/__tests__/step-up-gate.test.js` —
  flag OFF: existing assertions unchanged; flag ON: 401 status, spec-exact
  header, body still present; `stepUpMaxAge` enforced against stale
  `auth_time`.
- **UI:** 401-with-challenge opens the step-up modal (not the login
  redirect); malformed header falls back to body.
- **Done means:** with the flag OFF all existing tests pass untouched; with
  the flag ON a ≥$250 transfer with a single-factor token yields the
  spec-exact 401 challenge, the existing MFA modal flow completes, and the
  retried transfer succeeds with the elevated token visible in the inspector.

## Out of scope

- Agent/MCP tool path challenges (future candidate — the challenge builder
  is reusable when that day comes).
- CIBA wire-format changes.
- Generic `requireStepUp()` middleware.
- Any PingOne policy/configuration changes (the existing `Multi_Factor` ACR
  setup is reused as-is).
