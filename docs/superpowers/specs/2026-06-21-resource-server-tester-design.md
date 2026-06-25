# Interactive Resource Server Tester — Design

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation plan
**Page:** `/resource-server` (UI port 4000) → [ResourceServerPage.jsx](../../../demo_api_ui/src/components/ResourceServerPage.jsx)

## Problem

The OIDC Resource Server page is read-only: it decodes the *current user's session
token* (no signature check) and displays the claims. There is no way to interactively
submit a token and see whether a real resource server would accept or reject it. Users
expected a "test/poke" capability and it does not exist.

## Goal

Add an interactive tester, on the existing page, that lets a logged-in user submit a
token (their own session token OR an arbitrary pasted JWT) and see the result through
three lenses:

1. **Real RS validation** — JWKS signature verification + per-rule `aud`/`exp`/`nbf`/`scope` breakdown → PERMIT/REJECT.
2. **Live request probe** — a real HTTP call to a whitelisted protected endpoint with the token as the bearer → actual `200/401/403` + body.
3. **Decode + policy check** — decode only (no signature), evaluate the same policy rules → WOULD PASS / WOULD REJECT.

All three are in scope. Token source supports both "pick a session token" and "paste a JWT".

## Non-Goals (YAGNI)

- No saved-token history / persistence.
- No token editor or re-signer.
- No arbitrary-URL probe (whitelist only).
- No new auth modes beyond the three above.

## Architecture

### Backend

**New files:**
- `demo_api_server/services/resourceServerTesterService.js` — all logic.
- `demo_api_server/routes/resourceServerTester.js` — thin route handlers.

**Mounting:** the three routes are added to the **existing** `/api/resource-server`
router surface (already session-gated by `authenticateToken` at
[server.js:1050](../../../demo_api_server/server.js#L1050)). Concretely, the new router
is mounted at `/api/resource-server/test` with the same `authenticateToken` guard, OR
its handlers are registered on the existing resourceServer router — implementation plan
to pick the lower-diff option. Either way: **session-authenticated**.

**Endpoints** (all `POST`, JSON body):

| Path | Mode | Request body | Response |
|---|---|---|---|
| `/test/validate` | Real RS validation | `{ tokenRef? , tokenRaw? }` | `{ decision:'PERMIT'\|'REJECT', rules:[{ name, pass, detail }], claims }` |
| `/test/decode` | Decode + policy | `{ tokenRef? , tokenRaw? }` | `{ decision:'WOULD_PASS'\|'WOULD_REJECT', rules:[...], claims }` |
| `/test/probe` | Live request probe | `{ tokenRef? , tokenRaw? , targetPath }` | `{ status, statusText, headers, body }` |

**Token resolution** (shared helper in the service):
- `tokenRef` ∈ `{ 'access', 'id', 'exchanged' }` → read from `req.session.oauthTokens.*`
  server-side. Raw session tokens are **never** returned to the browser — the SPA sends
  only the identifier. Preserves BFF token custody.
- `tokenRaw` → the pasted JWT string from the request body.
- Exactly one of `tokenRef` / `tokenRaw` required; 400 otherwise.

**Validation rules** (`/test/validate` and `/test/decode` share the rule set; validate
additionally runs signature first):
1. `signature` (validate-only) — verify via `jwksService` / the JWKS+PEM path already in
   [tokenValidationService.validateToken](../../../demo_api_server/services/tokenValidationService.js#L94).
   Evaluate signature independently of aud/exp so the per-rule breakdown is meaningful.
2. `exp` — not expired.
3. `nbf` — not-before satisfied (if present).
4. `aud` — token `aud` includes the RS target audience
   (`configStore.getEffective('pingone_resource_mcp_server_uri')`, same source the page
   already uses at [resourceServer.js:54](../../../demo_api_server/routes/resourceServer.js#L54)).
5. `scope` — token carries the scope(s) the RS requires (at minimum `read`).

`decision` = PERMIT only if **all** rules pass (validate) / WOULD_PASS if all
non-signature rules pass (decode).

**Probe:** `targetPath` validated against a **fixed whitelist** (e.g.
`/api/resource-server/accounts`, `/api/accounts`). The BFF makes a server-side HTTP
request to itself with `Authorization: Bearer <resolved token>` and returns the real
status/headers(subset)/body — faithfully exercising `authenticateToken`. Non-whitelisted
`targetPath` → 400. No arbitrary URL → no SSRF.

### Security guards (load-bearing)

- Tester requires an authenticated session (only logged-in users; the page already gates on login).
- Probe target is a whitelist, never an arbitrary URL.
- Raw/pasted tokens are **never logged** (`jwtScrubber`) and **never persisted**.
- Responses pass through `scrubRawJwts` ([jwtScrubber](../../../demo_api_server/services/jwtScrubber.js)) so the raw token is never echoed back. Decoded **claims of the token-under-test** are intentionally returned — that is the teaching payload.

### Frontend

**File:** extend [ResourceServerPage.jsx](../../../demo_api_ui/src/components/ResourceServerPage.jsx)
with a new **collapsible** `🧪 Test this Resource Server` section appended below the
existing grid. New styles in `ResourceServerPage.css`.

**Layout:**
- **Shared token-source control** (top of section): radio `Session token` (dropdown:
  Access / ID / exchanged-if-present) vs `Paste JWT` (textarea).
- **Three independently collapsible sub-panels**, one per mode, each with a Run button:
  - **Validate** → per-rule ✅/❌ list + PERMIT/REJECT verdict.
  - **Decode** → claims + WOULD-PASS/REJECT.
  - **Probe** → target-path picker (whitelist) + real HTTP status/body.
- Each sub-panel collapses/expands independently (per requirement "make them collapsible").
- JSON rendered with the shared **JsonHighlight** component (not raw `<pre>`); toggles
  use the existing `.ctl-*` control standard.
- Calls go through `bffAxios.post(...)` (cookie-only, no raw tokens in the SPA except a
  user's own pasted value).

## Data Flow

```
SPA (token-source control)
  │  bffAxios.post('/api/resource-server/test/{validate|decode|probe}', { tokenRef|tokenRaw, targetPath? })
  ▼
routes/resourceServerTester.js  (authenticateToken — session gate)
  ▼
services/resourceServerTesterService.js
  ├─ resolveToken(tokenRef → session.oauthTokens.* | tokenRaw → body)
  ├─ validate:  jwksService sig verify → per-rule aud/exp/nbf/scope → decision
  ├─ decode:    decodeJwtClaims → per-rule (no sig) → decision
  └─ probe:     server-side HTTP to whitelisted path w/ Bearer → real status/body
  ▼
scrubRawJwts(response)  → SPA renders verdict + claims (never the raw token)
```

## Error Handling

- Missing/both token inputs → 400 `invalid_request`.
- Malformed JWT (decode/validate) → 400 with a friendly `reason`, never a 500 stack.
- JWKS fetch failure (validate) → the `signature` rule reports `pass:false` with detail, decision REJECT (no crash).
- Non-whitelisted `targetPath` (probe) → 400.
- Probe upstream non-2xx is **not** an error — it is the result (return status/body as-is).
- Unauthenticated session → 401 (existing middleware).

## Testing

- **Unit** (`demo_api_server/src/__tests__/`): validate/decode against a locally-signed
  RSA token with a **mocked** `jwksService` — deterministic PERMIT for a valid token,
  REJECT for expired and for wrong-audience, graceful 400 for a malformed JWT.
- **Probe** (real/integration): 401 for a deliberately bad token, 200 for the live
  session token against a whitelisted path.
- **UI build gate:** `cd demo_api_ui && npm run build` must pass (0 errors).

## Reuse Summary

| Need | Existing piece |
|---|---|
| JWKS signature verification | [tokenValidationService.js](../../../demo_api_server/services/tokenValidationService.js), [jwksService.js](../../../demo_api_server/services/jwksService.js) |
| Decode claims | `decodeJwtClaims` ([agentMcpTokenService.js:221](../../../demo_api_server/services/agentMcpTokenService.js#L221)) |
| RS target audience | `configStore.getEffective('pingone_resource_mcp_server_uri')` |
| Strip raw JWTs from responses | `scrubRawJwts` ([jwtScrubber.js](../../../demo_api_server/services/jwtScrubber.js)) |
| Shared JSON rendering | `JsonHighlight` component |
| Control toggles | `.ctl-*` control standard |
