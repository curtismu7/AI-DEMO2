# PingOne Admin group gate — real P1AZ enforcement (take 2)

**Date:** 2026-08-10
**Status:** Design, approved in brainstorming. Not yet planned or implemented.
**Scope:** `services/pingOneAdminAccessService.js#checkAccess` and the two call
sites in `routes/adminAgentRoutes.js` (lines 49, 120). Supersedes the reverted
`docs/superpowers/specs/2026-08-10-pingone-admin-p1az-group-gate-design.md`.

## Problem, and why the first attempt failed

`checkAccess` decides `pingone-admin` vertical access in JS
(`groups.includes(requiredGroup)`) after a live PingOne directory read — real,
demoable, but not a PingOne Authorize decision. A first attempt (PR #1548)
routed the decision through `pingOneAuthorizeService.evaluateMcpToolDelegation`
but omitted `TokenAudience`/`McpResourceUri` (this call site had no MCP bearer
token). Live-verify caught it within minutes: the deployed "McpFirstTool"
policy runs an unconditional audience/actor-chain check *before* its group
rule, so every admin — member or not — was `DENY`'d with `"Token audience
'none' or actor chain validation failed"`. Reverted same day (PR #1550);
documented in `REGRESSION_PLAN.md` §4 (2026-08-10, two entries).

This spec closes the actual gap: give this call site a **real**
`TokenAudience` instead of omitting one.

## What was live-verified this session (not assumed)

Before writing this spec, the missing piece was tested directly against the
live environment (in-container `node -e`, no code changes):

1. `resolveExpectedMcpResourceUri()` resolves to `mcpgateway.ping.demo` in
   this deployment — the same audience banking's real exchanged MCP tokens
   carry.
2. The admin dashboard session already holds a real OAuth access token
   (`routes/oauth.js`'s PKCE login, exposed at `req.agentContext.accessToken`
   — confirmed present at both `adminAgentRoutes.js` call sites already,
   lines 45 and 116) — audienced `enduser.ping.demo`, not MCP.
3. Exchanging that access token via `oauthService.performTokenExchangeAs(
   accessToken, null, exchangerClientId, exchangerClientSecret,
   'mcpgateway.ping.demo', ['read'], 'post')` — the explicit `'post'` method
   matters: the function defaults to `'basic'`, which this exchanger app's
   token-endpoint auth method rejects with `401 invalid_client` (hit and
   fixed live this session before the successful exchange below) — using
   the **already-provisioned**
   "Demo AI App - Token Exchanger" client's own identity as the exchanging
   party (`configStore` keys `pingone_mcp_token_exchanger_client_id` /
   `_secret`, the exact same ones `agentMcpTokenService.js` already uses for
   banking) — succeeded and returned a real token with
   `aud: ["mcpgateway.ping.demo"]`.

**No PingOne console changes are required.** The exchanger client already has
every `mcpgateway.ping.demo` scope granted (verified via the Management API:
`read`, `mcp:invoke`, and 19 others). This reuses infrastructure banking
already fully provisioned; it does not touch or depend on the Admin app
(`Demo AI App - Admin Login`) having any resource grant of its own — earlier
attempts down that path (granting the resource to the Admin app directly, or
exchanging using the Admin app's own identity) either required console
changes or silently returned the wrong audience. Exchanging **as** the
Token Exchanger app, with the admin's token as the subject, is what worked.

## Design

**Architecture.** `requirePingOneAdminGroup` (`adminAgentRoutes.js:18`) passes
the already-in-scope `accessToken` (from `req.agentContext`, destructured at
both call sites) into `checkAccess()` as a new parameter. `checkAccess`
exchanges it for an `mcpgateway.ping.demo`-audienced token, decodes that
token's real `aud` claim, and passes it to `evaluateMcpToolDelegation` as
`tokenAudience` alongside `mcpResourceUri: resolveExpectedMcpResourceUri()` —
both populated this time, so the deployed policy's audience-chain rule
passes instead of denying everyone, and its group rule (Scenario 1,
`RequiredGroup`/`InRequiredGroup`, already reused unmodified from the first
attempt) makes the actual decision.

**Data flow.**
1. `requirePingOneAdminGroup` passes `accessToken` into `checkAccess()` —
   only new wiring in `adminAgentRoutes.js`; both call sites already
   destructure `accessToken` from `req.agentContext` one line above their
   existing `requirePingOneAdminGroup(...)` call.
2. `checkAccess` resolves `requiredGroup` + live `groups` + `inRequiredGroup`
   — unchanged from today.
3. **New, first check:** if `accessToken` is falsy → fail closed immediately,
   `503 pingone_admin_group_lookup_unavailable` (same code as the existing
   "can't verify" branches). Never proceeds with a missing audience — the
   exact failure mode that broke #1548.
4. Exchange: `oauthService.performTokenExchangeAs(accessToken, null,
   exchangerClientId, exchangerClientSecret, mcpResourceUri, ['read'],
   'post')` — `'post'` explicit, not the function's `'basic'` default (see
   above). `exchangerClientId`/`exchangerClientSecret` come from
   `configStore.getEffective('pingone_mcp_token_exchanger_client_id')` /
   `('pingone_mcp_token_exchanger_client_secret')` and `mcpResourceUri` from
   `resolveExpectedMcpResourceUri()` (`mcpToolAuthorizationService.js:86`) —
   never a hardcoded string. Throws (expired session token, network,
   PingOne error) → same `503`.
5. Decode the exchanged token's `aud` claim (first element if array) →
   `tokenAudience`. This is the token's *actual* audience, not just an echo
   of what was requested — protects against a future silent mismatch.
6. Call `evaluateMcpToolDelegation({ userId: pingOneUserId, toolName:
   'pingone_admin_access', verticalId: 'pingone-admin', requiredGroup,
   inRequiredGroup, tokenAudience, mcpResourceUri })`.
7. Map `decision`/`policyNotFound`/throw exactly as the reverted design did —
   that mapping was never the defect, only the missing audience was:
   - `PERMIT` → `{ allowed: true, status: 200 }`
   - `DENY` / `INDETERMINATE` → `{ allowed: false, error:
     'pingone_admin_group_required', status: 403 }`
   - `policyNotFound` → `503 pingone_admin_group_lookup_unavailable` (not a
     member-facing 403 — the deployed policy doesn't recognize the call,
     which is a config-drift signal, not a group-membership fact)
   - thrown/transport error from the P1AZ call itself → same `503`

**Caching — deliberately not doing it.** Considered and rejected: caching the
exchanged token would only save the exchange round-trip, not the P1AZ
decision call itself (that must run fresh every request — "live directory
read / live decision at request time, no stale cache" is the property this
gate exists to demonstrate, per the flagship story in
`docs/superpowers/specs/2026-08-10-admin-demo-stories-design.md`). Banking's
own code never caches its exchanged MCP tokens either (confirmed by
investigation: no LMDB or in-memory MCP-token cache exists anywhere in this
codebase — it re-mints per tool call). Adding a cache here would be new
invalidation surface (TTL tracking, revoke-on-logout, mid-session expiry)
for a pattern nothing else uses, to save latency on a demo console click.
Two round trips per admin action, matching the rest of the codebase exactly.

**Stated tradeoff.** `checkAccess` now depends on the admin session's base
access token being fresh — previously it needed no token at all. An expired
session token now fails closed at `503` (via the exchange throwing) rather
than silently degrading. This is a genuinely new failure mode versus today's
JS-only check, and is accepted as fail-closed-correct, not treated as a
regression to hide.

## Error handling

- Missing `accessToken` → `503` immediately, no exchange attempted.
- Exchange throws → `503`.
- `policyNotFound` → `503` (config-drift signal, not a membership fact).
- `DENY` / `INDETERMINATE` → `403 pingone_admin_group_required` (fail-closed,
  unchanged from the reverted design).
- `PERMIT` → `200`.

## Testing

- Unit (`tests/pingOneAdminAccessService.test.js`): mock
  `oauthService.performTokenExchangeAs` and
  `pingOneAuthorizeService.evaluateMcpToolDelegation` for: missing
  `accessToken` → 503; exchange throws → 503; `PERMIT` → 200; `DENY` → 403
  for a real member (proves the PDP decision is authoritative, not the JS
  group check — same test shape the reverted design already had);
  `INDETERMINATE` → 403 for a real member; `policyNotFound` → 503.
- **Live-verify BEFORE merge, not after** (the actual lesson from today,
  not a repeated mistake): run the exact `node -e` probe already proven live
  this session — real member → real `PERMIT` via the real exchange and real
  decision endpoint (not mocks); remove from the required group → real
  `DENY`. Only merge once both directions are confirmed against the live
  environment. Check `docker logs ai-demo-api-server` for the `[BFF→P1AZ]`
  and `[TokenExchange...]` log lines to confirm the real audience flowed
  through, not an omitted one.

## Deferred / out of scope

- Actor-chain propagation (`act` claim) — the live-tested exchange omits the
  actor token (`performTokenExchangeAs(..., actorToken: null, ...)`) since
  this gate only needs a real `TokenAudience`, not a full RFC 8693 actor
  chain. Adding actor delegation here is a separate concern if ever needed.
- Token caching — see above, deliberately rejected for this design.
