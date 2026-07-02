# Design: Per-Request JWKS Local Token Validation Flag (MCP Gateway)

**Date:** 2026-07-02
**Status:** Approved (brainstorming session)

## Problem

The PingGateway MCP gateway validates every inbound bearer token by remote
introspection against PingOne (`TokenIntrospectionAccessTokenResolver` →
`PINGONE_INTROSPECTION_ENDPOINT`). We want a demo-visible feature flag that
switches token validation to local JWKS-based JWT verification, per request,
with no gateway restart — mirroring the existing `ff_authorize_simulated` /
`X-Authz-Simulated` live-switch pattern.

## Decisions Made

- **Switch type:** runtime, per-request (header-driven), not a boot-time env var.
- **Control surface:** full demo chain — UI toggle → BFF feature flag → header
  → gateway route selection.
- **Gateway mechanism:** custom Groovy validation script (approach C), chosen
  over native `StatelessAccessTokenResolver` because it supports **all flag
  combinations**: real PingOne RS256 tokens (JWKS) *and* mock
  `demo_authz_server` HS256 tokens (shared secret) when
  `ff_authorize_simulated=true`.

## Components

### 1. Feature flag (BFF + UI)

New flag `ff_mcp_gateway_jwks`, default `false` (introspection = current
behavior). Added exactly like `ff_authorize_simulated`:

- `FLAG_REGISTRY` entry in `demo_api_server/routes/featureFlags.js`
  (~line 56). Name: "Local JWKS Token Validation". Description must state the
  educational tradeoff: local validation is faster and offline but cannot
  detect revoked tokens; introspection round-trips to the authorization
  server on every request.
- `FIELD_DEFS` entry in `demo_api_server/services/configStore.js` (~line 264):
  `ff_mcp_gateway_jwks: { public: true, default: 'false' }`.
- **No UI component work** — `FeatureFlagsPage.js` renders whatever
  `GET /api/admin/feature-flags` returns from the registry.

### 2. BFF → gateway header

In `demo_api_server/services/mcpGatewayClient.js` (~lines 130–133), next to
the existing `X-Authz-Simulated` block (inside the same
`ff_mcp_gateway_pinggateway === 'true'` guard):

```js
const jwks = configStore.getEffective('ff_mcp_gateway_jwks') === 'true';
headers['X-Token-Validation'] = jwks ? 'jwks' : 'introspect';
```

### 3. Gateway: new route file, existing routes untouched

New route `ping-gateway/config/routes/00-mcp-olb-jwks.json`:

- File name sorts **before** `01-mcp-olb.json`; PingGateway selects the first
  matching route, so the existing route files stay byte-for-byte unchanged.
- Condition: `${find(request.uri.path, '^/mcp(?!/invest)') and
  request.headers['X-Token-Validation'][0] == 'jwks'}` (exact expression
  syntax verified on the live container).
- Chain copied from `01-mcp-olb.json` (`McpValidationFilter`,
  `p1az-decision.groovy`, `olb-token-exchange.groovy`,
  `ReverseProxyHandler`), with the introspection resource-server stage
  replaced by the new Groovy validator.
- **Scope: primary OLB route only for v1.** `/mcp/invest` keeps
  introspection; JWKS support there is a follow-up.

### 4. Groovy validator: `ping-gateway/scripts/groovy/jwks-token-validation.groovy`

Runs where the introspection RS filter sits today. Logic:

1. Extract bearer from `Authorization` header; missing/malformed → 401.
2. Decode the JWT header; branch on `alg`:
   - **RS256** — fetch JWKS from `PINGONE_JWKS_URI` (new env var, default
     `${PINGONE_ISSUER_URI}/jwks`), match `kid`, verify signature with
     `java.security` RSA. JWKS cached in-memory with ~5-minute TTL (no
     per-request fetch).
   - **HS256** — verify HMAC with `AUTHZ_JWT_SECRET` (mock-issued tokens;
     the secret must be added to the gateway container env in
     docker-compose / k8s manifests). Secret absent → fail closed (401).
   - Any other `alg` (including `none`) → 401.
3. Claim checks: `exp` / `nbf`; `aud` matches the gateway resource identity;
   `scope` contains `PG_INBOUND_SCOPE`. Issuer: the RS256 branch requires
   `iss == PINGONE_ISSUER_URI`; the HS256 branch checks `iss` against
   `AUTHZ_ISSUER_URI` only if that env var is set (possession of the shared
   secret is the trust anchor for mock tokens).
4. **On success:** put the claims map into `attributes['oauth2AccessToken']`.
   `p1az-decision.groovy` (~line 174) already falls back to exactly that
   attribute when no OAuth2Context exists, so the downstream authorize and
   token-exchange steps run unmodified. Also set response header
   `X-Token-Validation-Mode: jwks` for demo visibility.
5. **On failure:** 401 with JSON body
   `{"error":"invalid_token","validation":"jwks"}`, a `WWW-Authenticate`
   header, and a `logger.info` line naming the failed check (signature /
   expiry / issuer / audience / scope) — this log line is the demo
   money-shot.

### Flag interaction: `ff_authorize_simulated` × `ff_mcp_gateway_jwks`

| simulated | jwks | Inbound token | Validation path |
| --- | --- | --- | --- |
| false | false | PingOne RS256 | Introspection (unchanged, today's default) |
| false | true | PingOne RS256 | Local JWKS (RS256 branch) |
| true | false | Mock HS256 | Introspection at mock authz-server (unchanged) |
| true | true | Mock HS256 | Local HMAC (HS256 branch) |

## Open Verification Item

Whether `McpProtectionFilter` accepts a `ScriptableFilter` as its
`resourceServerFilter` reference:

- **If yes:** keep `McpProtectionFilter` on the JWKS route wrapping the
  Groovy validator — retains RFC 9728 protected-resource metadata and
  `WWW-Authenticate` challenge behavior.
- **If no:** the JWKS route drops `McpProtectionFilter`; the script's own
  `aud` check covers audience enforcement.

Checked on the live container during implementation; the design works either
way.

## Known Tradeoff (by design)

Local JWKS validation cannot detect revoked tokens — there is no round-trip
to the authorization server. This is inherent to local validation and is the
educational point of the toggle; it is stated in the flag's UI description.

## Success Criteria

Curl matrix against the gateway (`:3036/mcp`):

1. Real PingOne token + `X-Token-Validation: jwks` → 200, response header
   `X-Token-Validation-Mode: jwks`, gateway log shows local validation and
   **no** introspection call.
2. Tampered signature + `jwks` → 401 `invalid_token`.
3. Expired token + `jwks` → 401.
4. Wrong `aud` or missing `banking:mcp:invoke` scope + `jwks` → 401.
5. Mock HS256 token (simulated mode) + `jwks` → 200 via HMAC branch.
6. No header / `introspect` → existing introspection route, behavior
   identical to today.
7. UI: toggling the flag on FeatureFlagsPage flips the header on the next
   MCP tool call with no restarts.
8. Flag off → zero change to the current flow (route 01 untouched).
