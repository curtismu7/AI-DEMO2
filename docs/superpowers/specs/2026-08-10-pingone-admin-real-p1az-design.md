# PingOne Admin group gate — real P1AZ enforcement (take 2)

**Date:** 2026-08-10
**Status:** Design, approved in brainstorming (revised after a second
live-verify round found the single-hop exchange insufficient). Not yet
planned or implemented against this revision.
**Scope:** `services/pingOneAdminAccessService.js#checkAccess` and the two call
sites in `routes/adminAgentRoutes.js` (lines 49, 120). Supersedes the reverted
`docs/superpowers/specs/2026-08-10-pingone-admin-p1az-group-gate-design.md`.

## Problem, and why the first two attempts failed

`checkAccess` decides `pingone-admin` vertical access in JS
(`groups.includes(requiredGroup)`) after a live PingOne directory read — real,
demoable, but not a PingOne Authorize decision.

**Attempt 1 (PR #1548, reverted same day as #1550):** routed the decision
through `pingOneAuthorizeService.evaluateMcpToolDelegation` but omitted
`TokenAudience`/`McpResourceUri` (this call site had no MCP bearer token).
Live-verify caught it within minutes: the deployed "McpFirstTool" policy runs
an unconditional audience check *before* its group rule, so every admin was
`DENY`'d with `"Token audience 'none' or actor chain validation failed"`.
Documented in `REGRESSION_PLAN.md` §4 (2026-08-10, two entries).

**Attempt 2, round 1 (this spec's first draft, implemented on a worktree
branch but never merged):** fixed the audience by exchanging the admin's
session token for a real `mcpgateway.ping.demo`-audienced one via a single
RFC 8693 hop. Live-verified before merge this time (the actual process fix)
— and that live-verify caught a **second**, independent gate: the same
policy statement's other half, `"or actor chain validation failed"`, fires
separately. With a correct audience but an empty `ActClientId`, PingOne
returned a distinct `"MCP Denied — Invalid Actor Chain"` statement:
`"Actor client ID '' is not a registered actor in the RFC 8693 delegation
chain."` Adding an `actor_token` parameter to the same single-hop exchange
did not help — the resource's own `act` attribute mapping doesn't derive
from the request's `actor_token` parameter at all (see below).

This revision closes that second gap with the same reused, already-live
infrastructure banking depends on: a genuine **two-hop** exchange, not a
single one.

## What was live-verified this session (not assumed)

All of the following was tested directly against the live environment
(in-container `node -e`, Management API reads, no code changes) before
writing this revision:

1. `resolveExpectedMcpResourceUri()` resolves to `mcpgateway.ping.demo` — the
   same audience banking's real exchanged MCP tokens carry.
2. The admin dashboard session already holds a real OAuth access token
   (`routes/oauth.js`'s PKCE login, exposed at `req.agentContext.accessToken`
   — confirmed present at both `adminAgentRoutes.js` call sites, lines 45 and
   116) — audienced `enduser.ping.demo`, not MCP.
3. A single-hop exchange via `oauthService.performTokenExchangeAs(accessToken,
   null, exchangerClientId, exchangerClientSecret, 'mcpgateway.ping.demo',
   ['read'], 'post')` (using the already-provisioned "Demo AI App - Token
   Exchanger" client's own identity, `'post'` auth method explicit — the
   function's `'basic'` default gets `401 invalid_client` for this client)
   correctly returns `aud: ["mcpgateway.ping.demo"]` — but `act` is always
   absent, no matter what `actor_token` is passed alongside it.
4. **Root cause of the missing `act`, found by reading the resources' actual
   attribute mappings via the Management API** (`GET
   /resources/{id}/attributes` — not visible in full from the console's
   truncated display):
   - `Demo MCP Gateway` (`mcpgateway.ping.demo`, id `b773bc8e-...`): its `act`
     attribute is `${#root.context.requestData.subjectToken.act}` — it
     **propagates** whatever `act` was already on the token being exchanged.
     It never constructs `act` from an `actor_token` parameter.
   - `Demo Agent Gateway` (`agentgateway.ping.demo`, id `9654d118-...`,
     already the "intermediate" resource banking's own two-exchange code
     targets — `configStore` key `ai_agent_intermediate_audience`): its `act`
     attribute is `${#root.context.requestData.subjectToken.may_act}` — it
     **constructs** `act` from the subject token's `may_act` claim.
   - `enduser.ping.demo` (the admin's own base token audience, id
     `4a536256-...`): its `may_act` attribute is `${user.mayAct}` — a
     per-user PingOne profile attribute. The signed-in demo admin
     (`85abea5b-...`) has `mayAct: {"sub": "71e878ea-2d79-4760-b570-
     66f00cbeffe7"}` set on their user record — naming "Demo AI App - AI
     Agent Actor" as the permitted actor.
5. **This is banking's real two-exchange chain, confirmed by direct resource
   inspection, not just by reading banking's code.** Live-tested end to end:
   - **Hop 1:** `performTokenExchangeAs(adminAccessToken, null,
     aiAgentActorClientId, aiAgentActorClientSecret, 'agentgateway.ping.demo',
     ['read'], 'post')` — exchanging **as** the AI Agent Actor client
     (`71e878ea-...`, the same client named in the admin's own `mayAct`)
     produces a token with `act: {"sub":"71e878ea-..."}` (constructed from
     the admin's `may_act`) and `may_act: {"sub":"f4dd707d-..."}` (the
     Token Exchanger, statically configured on this resource — sets up the
     *next* hop's permission).
   - **Hop 2:** `performTokenExchangeAs(hop1Token, null,
     exchangerClientId, exchangerClientSecret, 'mcpgateway.ping.demo',
     ['read'], 'post')` — exchanging **as** the Token Exchanger client
     (now permitted, per hop 1's `may_act`) produces the final token:
     `aud: ["mcpgateway.ping.demo"]`, `act: {"sub":"71e878ea-..."}`
     (propagated forward from hop 1, per this resource's `subjectToken.act`
     mapping).
   - Feeding this final token's real `aud` and `act.sub` into
     `evaluateMcpToolDelegation` (`tokenAudience`, `mcpResourceUri`,
     `actClientId`) returned a genuine live `PERMIT`:
     `{"name":"MCP Tool Authorized", "authorized": true, ...}`.

**No PingOne console changes are required for any of this.** Every client
and resource involved (Admin Login, AI Agent Actor, Token Exchanger, all
three resources) is already fully provisioned for banking's own use; this
design only calls existing, already-granted exchange paths in a new order.

## Design

**Architecture.** `requirePingOneAdminGroup` (`adminAgentRoutes.js:18`) passes
the already-in-scope `accessToken` into `checkAccess()` as a new parameter
(unchanged from the first draft of this spec). `checkAccess` now performs
**two** sequential RFC 8693 exchanges — mirroring banking's own two-exchange
pattern, not a single hop — to arrive at a token that carries both a real
`aud` and a real `act`, then passes both to `evaluateMcpToolDelegation`
alongside `actClientId`. This satisfies both halves of the deployed policy's
combined audience-and-actor-chain check, which single-hop attempt 2 round 1
did not.

**Data flow.**
1. `requirePingOneAdminGroup` passes `accessToken` into `checkAccess()` —
   unchanged one-line addition from the first draft.
2. `checkAccess` resolves `requiredGroup` + live `groups` + `inRequiredGroup`
   — unchanged from today.
3. If `accessToken` is falsy → fail closed immediately, `503
   pingone_admin_group_lookup_unavailable`. Never proceeds with an
   incomplete chain.
4. **Hop 1 (intermediate):** `oauthService.performTokenExchangeAs(
   accessToken, null, aiAgentActorClientId, aiAgentActorClientSecret,
   intermediateAud, ['read'], 'post')`, where `aiAgentActorClientId`/
   `Secret` come from `configStore.getEffective('pingone_ai_agent_actor_client_id')`
   / `('pingone_ai_agent_actor_client_secret')` and `intermediateAud` from
   `configStore.getEffective('ai_agent_intermediate_audience')` (resolves to
   `agentgateway.ping.demo` live). Throws → `503`.
5. **Hop 2 (final):** `oauthService.performTokenExchangeAs(hop1Token, null,
   exchangerClientId, exchangerClientSecret, mcpResourceUri, ['read'],
   'post')` — same exchanger client/config as the first draft.
   `mcpResourceUri` from `resolveExpectedMcpResourceUri()`. Throws → `503`.
6. Decode hop 2's result (`decodeJwt`, `utils/tokenUtils.js`): `tokenAudience`
   from `claims.aud` (first element if array), `actClientId` from
   `claims.act?.sub`. If `tokenAudience` is falsy → fail closed `503` (same
   as the first draft's guard, still needed — a malformed/unexpected hop 2
   result must not silently proceed). `actClientId` may legitimately be
   absent in principle, but is expected present given hop 1's construction —
   it is passed through as-is (`null`/`undefined` if absent) rather than
   separately gated, since the policy itself is what validates it.
7. Call `evaluateMcpToolDelegation({ userId: pingOneUserId, toolName:
   'pingone_admin_access', verticalId: 'pingone-admin', requiredGroup,
   inRequiredGroup, tokenAudience, mcpResourceUri, actClientId })`.
8. Map `decision`/`policyNotFound`/throw exactly as before — this mapping was
   never the defect in either failed attempt:
   - `PERMIT` → `{ allowed: true, status: 200 }`
   - `DENY` / `INDETERMINATE` → `{ allowed: false, error:
     'pingone_admin_group_required', status: 403 }`
   - `policyNotFound` → `503 pingone_admin_group_lookup_unavailable`
   - thrown/transport error from the P1AZ call itself → same `503`

**Why two hops, not one with an actor token attached.** This was tried and
live-tested first (see "What was live-verified," item 3): passing an
`actor_token` on a single call to `performTokenExchangeAs` targeting
`mcpgateway.ping.demo` directly does nothing, because that resource's `act`
mapping only ever reads `subjectToken.act` — it has no expression that
constructs a NEW `act` from a request-supplied `actor_token`. Only the
intermediate resource (`agentgateway.ping.demo`) has a mapping
(`subjectToken.may_act`) that constructs `act` fresh, and it constructs it
from the **subject's** `may_act` claim, not from any actor token supplied in
that same request either. The two-hop shape is not a stylistic choice
mirroring banking for its own sake — it is the only path through these two
resources' actual, inspected attribute mappings that produces a populated
`act` on the final token.

**Caching — deliberately not doing it.** Unchanged from the first draft:
caching would only save the exchange round-trips, not the P1AZ decision
call itself, which must run fresh every request. Now **three** round trips
per admin action (two exchanges + one decision), up from two in the first
draft — an explicitly accepted cost, not hidden.

**Stated tradeoff.** Same as the first draft: `checkAccess` now depends on
the admin session's base access token being fresh. Additionally, it now
depends on **two** separate client credentials (`pingone_ai_agent_actor_*`
and `pingone_mcp_token_exchanger_*`) being configured and each exchange
succeeding — a config-completeness dependency this vertical did not have
before. Any failure at either hop fails closed at `503`, never partially
proceeds.

## Error handling

- Missing `accessToken` → `503` immediately, no exchange attempted.
- Hop 1 throws → `503`.
- Hop 2 throws → `503`.
- Decoded `tokenAudience` falsy after hop 2 → `503` (malformed/unexpected
  result, not assumed safe to omit).
- `policyNotFound` → `503` (config-drift signal, not a membership fact).
- `DENY` / `INDETERMINATE` → `403 pingone_admin_group_required`.
- `PERMIT` → `200`.

## Testing

- Unit (`tests/pingOneAdminAccessService.test.js`): mock
  `oauthService.performTokenExchangeAs` (now called twice per successful
  path — tests must configure both call results, e.g. via
  `.mockResolvedValueOnce` for hop 1 then hop 2, or a single
  implementation keyed on which client id was passed) and
  `pingOneAuthorizeService.evaluateMcpToolDelegation` for: missing
  `accessToken` → 503 (neither exchange called); hop 1 throws → 503 (hop 2
  and the PDP never called); hop 2 throws → 503; `PERMIT` → 200; `DENY` → 403
  for a real member; `INDETERMINATE` → 403 for a real member;
  `policyNotFound` → 503; hop 2 result with no `aud` claim → 503 (PDP never
  called).
- **Live-verify BEFORE merge** (unchanged process lesson, now proven twice
  necessary in the same feature): run the exact two-hop `node -e` probe
  already proven live this session — real member → real `PERMIT` via the
  real two-hop exchange and real decision endpoint; remove from the required
  group → real `DENY`. Only merge once both directions are confirmed. Check
  `docker logs ai-demo-api-server` for both `[Exchange-As]` lines (one per
  hop) and the `[BFF→P1AZ]` lines to confirm `TokenAudience` and
  `ActClientId` both arrive populated, not empty.

## Deferred / out of scope

- Token caching — see above, deliberately rejected for this design.
- Generalizing this two-hop pattern into a reusable helper shared with
  banking's `agentMcpTokenService.js`. That module's own two-exchange
  function is deeply coupled to banking-specific concerns (tool-scope
  resolution, transaction context) and extracting a shared primitive is a
  separate refactor, not required to ship this gate.
