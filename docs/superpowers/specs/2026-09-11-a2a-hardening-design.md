# A2A hop hardening — design

**Date:** 2026-09-11
**Status:** approved design, not yet implemented
**Scope:** the A2A wire hop between the generalist agent and a vertical specialist
(UC2 / UC2.5). Identity-layer RFC 8693 exchanges are restructured, not replaced.

## Goal

Make the A2A hop carry real delegated identity and enforce it, so the demo's A2A
story holds up against the A2A v1.0 specification and against the OAuth RFCs it
relies on, without claiming protections the PingOne platform cannot provide.

### Success criteria

1. The A2A hop carries a token whose subject is the **user** and whose actor is
   the **generalist** — not a bare machine token.
2. Every inbound A2A request is authenticated **and** authorized on both the
   in-process and the HTTP path. No code path skips the check.
3. A token minted for specialist A is rejected by specialist B.
4. No token appears in any A2A message payload or reply, in either direction.
5. Agent Cards are signed, and the generalist verifies the signature before
   trusting a card.
6. Each check has a test that fails when the check is removed.
7. The existing locked behaviours still hold: gateway-PERMIT-gated local serve,
   token-custody rules, and the unchanged `executeA2aDelegation` output shape.

## Decisions

Four decisions were taken during design; each closes an alternative deliberately.

| Decision | Chosen | Why not the alternative |
|---|---|---|
| Hop boundary | **In-process, with the HTTP path's full checks** | A real HTTPS hop needs the loopback TLS problem solved first (the reason the in-process path exists) and slows every UC2 run. The spec's "authenticate every request" is satisfiable in-process by running the same validator. |
| Token on the hop | **The Exchange #1 delegated token** (subject = user, `act` = generalist, audience = this specialist) | A separate client_credentials bearer never carries the user, so the hop proves only "some agent called". |
| Who runs the tool | **The specialist** | The alternative is returning the nested-act token to the generalist, which puts a credential in a message payload (the spec sends credentials out-of-band) and lets the generalist act under the specialist's identity. |
| Rollout | **Hard cutover, no feature flag** | A flag keeps the weaker path reachable and doubles the A2A test matrix. Rollback is a PR revert. |

## Current state

Measured against the A2A v1.0 specification (§7 security, §8.4 card signing) and
`@a2a-js/sdk` 1.0.1 as vendored.

| Requirement | Today | |
|---|---|---|
| Server MUST authenticate every request | The HTTP path validates. The default in-process path discards the bearer (`a2aProtocolClient.js:137` `void bearer`) and fabricates an authenticated user from its claims | ❌ |
| Server MUST authorize; MUST NOT reveal unauthorized resources | Signature and issuer only — no audience, scope, actor or skill check | ❌ |
| Production MUST use TLS | Public card URLs are HTTPS; the forced-HTTP client defaults to `http://127.0.0.1` | ⚠️ |
| Agent Card MAY be signed; clients SHOULD verify | `signatures: []`, no verification | ❌ |
| Credentials out-of-band, not in payloads | Message body carries subtask text and metadata only | ✅ |
| Delegated identity across the hop | The user's identity never crosses; the BFF runs Exchange #2 using the specialist's secret | ⚠️ |
| Credentials SHOULD be bound to the requesting agent | PingOne issues neither DPoP nor mTLS-bound tokens (`docs/SPIFFE_PLAN.md:53`, `:232`) | platform ceiling |

Two facts make this tractable: each specialist already has its own PingOne client
(`pingone_<appKey>_agent_client_id`) and its own audience resource with a unique
`agent:invoke:<appKey>` scope (`config/a2aSpecialists.js`, provisioning step
37a-A2A). Audience binding needs no new provisioning.

## Target flow

1. **Generalist** runs Exchange #1 only: user token + generalist actor token →
   `tAgent1` (subject = user, `act` = generalist, audience = this specialist's
   intermediate resource, scope `agent:invoke:<appKey>`).
2. **Generalist** fetches the specialist's Agent Card and verifies its signature.
3. **Generalist → specialist**: A2A `SendMessage` with `Authorization: Bearer
   tAgent1` and `A2A-Version: 1.0`. The body carries the subtask and the
   requested skill name. No token in the body.
4. **Specialist** runs `verifyA2aBearer` (below). Failure ends the hop.
5. **Specialist** runs Exchange #2 itself: `tAgent1` + its own actor token →
   nested-act token (`act:{specialist, act:{generalist}}`, subject still the
   user). This is the only code path that reads the specialist's client secret.
6. **Specialist** calls the tool with that token via `executeBffToolWithToken`,
   including the gateway-PERMIT-gated local-serve fallback, moved here unchanged.
7. **Specialist → generalist** reply: the tool result as a data part, with
   `actChainDepth`, `scopes` and `toolError` as metadata. No token.
8. **Generalist** maps the reply into today's unchanged JSON contract.

## Components

### `verifyA2aBearer(token, specialist)` — new, `middleware/a2aPingOneBearer.js`

One function, called by the HTTP middleware **and** by the in-process client
before `handler.sendMessage`. Checks in order:

1. RS256 signature against PingOne's JWKS, plus issuer, `exp`, `nbf` — the
   existing `services/tokenValidationService.js` `validateToken` does this.
2. `aud` includes **this** specialist's `intermediateAud`, from
   `resolveA2aConfig()` (RFC 8707 audience binding).
3. `scope` contains `agent:invoke:<appKey>`.
4. `act` is present and exactly one level deep. This rejects a bare
   client_credentials token (no user behind it) and an Exchange #2 token
   replayed into the hop.
5. The actor is the generalist: `act.client_id || act.sub` equals
   `pingone_ai_agent_client_id`. The `client_id`-then-`sub` order is PingOne's,
   already used at `services/mcpToolAuthorizationService.js:533`.
6. The requested skill is in `specialist.tools`.

Returns the validated claims; the server-side user is built from them (subject =
user, actor = generalist) instead of being fabricated from a client ID.

### Failure responses

| Failing check | Status | Header |
|---|---|---|
| 1, 2, 4, 5 | 401 | `WWW-Authenticate: Bearer error="invalid_token"` |
| 3 | 403 | `WWW-Authenticate: Bearer error="insufficient_scope", scope="agent:invoke:<appKey>"` |
| 6 | 403 | `WWW-Authenticate: Bearer error="insufficient_scope"` |

Plain RFC 6750 challenges. `routes/mcpFacade.js` `rewriteChallenge` is not reused:
it appends an RFC 9728 resource-metadata URL, and the A2A discovery document is
the Agent Card. Bodies stay generic and keep the repo's `{ error }` shape; the
specific reason goes to the server log only (spec: MUST NOT reveal). On the
in-process path the same failures throw the SDK's unauthorized error.

### `a2aDelegationService.js` split

- `exchangeAsGeneralist(req, { specialist, ... })` — Exchange #1, returns
  `tAgent1` and its token-chain events.
- `exchangeAsSpecialist(tAgent1, { specialist, ... })` — Exchange #2, returns the
  nested-act token and its events. The Verified Trust assertion moves here, since
  it asserts that *this specialist* acts for the user. It stays soft-fail.
- `delegateToSpecialist()` remains as the composition of both, used only by
  `routes/groupMembership.js:164`, which probes the policy decision point with a
  delegated token. That is a diagnostic, not an agent hop.

In-process, the specialist writes its events to the same shared `tokenEvents`
array, so the Token Chain UI still shows every step in order.

### Specialist executor — `services/a2aProtocolServer.js`

`makeSpecialistExecutor` stops returning an acknowledgement string and instead:
calls `exchangeAsSpecialist`, then `executeBffToolWithToken`, then the
local-serve fallback — still only on `error === 'mcp_error'` **and**
`gatewayDecision === 'PERMIT'`, and only when the vertical plugin owns the tool
(REGRESSION_PLAN §1 locked, `src/__tests__/a2aExecution.test.js`). It publishes
the tool result as a data part plus metadata. Per-call context (`req`,
`tokenEvents`, `sessionId`) reaches the executor through the closure in
`createSpecialistProtocolHandler`, which `sendInProcess` already builds per call.

### Agent Card signing — `services/a2aAgentCardService.js`

- A **dedicated** process-wide Ed25519 key, created with `node:crypto`, separate
  from `dpopKeyService.js`'s Web Bot Auth key (one key, one purpose). The SDK
  accepts a Node `KeyObject`, so nothing new is declared in `package.json`
  (`jose` 6.2.8 arrives with the SDK and is not imported directly).
- Cards are signed with the SDK's `generateAgentCardSignature` — JWS over the
  SDK's RFC 8785 canonicalization, which excludes `signatures` — with
  `alg: 'EdDSA'`, `kid` = the RFC 7638 thumbprint, `typ: 'JOSE'`, and `jku` in
  the **protected** header so it is integrity-protected.
- Public key published at `GET /a2a/specialists/.well-known/jwks.json`,
  unauthenticated, alongside the already-public cards.
- The generalist verifies with `verifyAgentCardSignature(retrievePublicKey)`.
  `retrievePublicKey` accepts a `jku` **only** when its origin equals
  `publicApiBase()`, and never fetches an arbitrary URL — this blocks key
  substitution and SSRF. In-process it resolves the local key directly. A failed
  verification fails the hop.
- `capabilities.extendedAgentCard` stays `false`; there are no private skills.

### `a2aProtocolClient.js`

Drops the `getAiAgentClientCredentialsToken()` wire-bearer mint. Sends `tAgent1`.
Verifies the card. Runs `verifyA2aBearer` before the in-process `sendMessage`, so
the in-process path is not a way around the gate. The forced-HTTP loopback
default changes from `http://` to `https://` (the BFF listens only on HTTPS at
3001, so the old default never worked). The hop no longer soft-fails: a failure
returns `delegated: false`.

## Error handling

Hop failures surface as `delegated: false` with a specific code —
`a2a_unauthorized`, `a2a_card_signature`, `a2a_exchange2_failed` — plus a failure
row on the token chain so the UI narrates the failure instead of going quiet.
Tool-level failures keep today's `toolError` shape, so a gateway DENY still reads
as a DENY and not as a broken hop.

## Standards mapping

| Requirement | Mechanism | Test |
|---|---|---|
| MUST authenticate every request (§7.3–7.4) | `verifyA2aBearer` on both paths | `a2aBearerValidation.test.js`; in-process invalid-bearer case in `a2aExecution.test.js` |
| MUST authorize (§7.5, §13.1) | scope, actor and skill checks | `a2aBearerValidation.test.js` |
| MUST NOT reveal unauthorized resources (§3.3.2) | generic bodies, reasons to log only | `a2aBearerValidation.test.js` |
| Audience restriction (RFC 8707) | per-specialist `intermediateAud` | wrong-audience case |
| Delegation semantics (RFC 8693 §4.1) | `act` depth 1 inbound, nested depth 2 after Exchange #2 | existing `a2aDelegationService.test.js` plus depth cases |
| Card signing (§8.4, RFC 7515 + 8785) | SDK sign/verify, own-origin `jku` | `a2aProtocolCards.test.js` |
| Credentials out-of-band (§7.6) | no token in any body or reply | assertion in the protocol-client test |
| TLS (§7.1) | HTTPS card URLs; HTTPS loopback default | covered by the client test's URL assertion |
| Sender-constrained credentials (§7.6 SHOULD) | **not met** — platform ceiling | recorded in TECH_DEBT |

## Tests

All jest, in `demo_api_server`:

- **New `tests/a2aBearerValidation.test.js`** — one case per rejection (bad
  signature, wrong audience, missing scope, absent `act`, two-deep `act`, wrong
  actor, unknown skill) plus the happy path. Each must fail with its check
  removed.
- **`src/__tests__/a2aProtocolCards.test.js`** — signed card verifies; tampered
  card fails; foreign-origin `jku` refused.
- **`src/__tests__/a2aExecution.test.js`** — mock seam moves to the specialist
  path; both locked local-serve cases (PERMIT serves, no-PERMIT does not) still
  pass; new case: an invalid bearer runs no tool.
- **`src/__tests__/a2aProtocolClient.test.js`** — the bearer is `tAgent1`; no
  client_credentials mint; no token in the payload.
- **`src/__tests__/a2aDelegationService.test.js`** — the split functions still
  compose for the policy-probe path.

### Verification commands

```bash
# scoped first (npx pulls the wrong jest in this service)
cd demo_api_server && CI=true ./node_modules/.bin/jest \
  tests/a2aBearerValidation src/__tests__/a2a --forceExit

# full BFF suite once — this touches auth middleware and more than three files
cd demo_api_server && CI=true npm test -- --forceExit

# UI, because the Learning Hub copy changes
cd demo_api_ui && npm run test:unit && npm run build
```

## Docs to update in the same PR

- **`REGRESSION_PLAN.md` §1** — a locked row: the six validator checks, the actor
  pin, card verification, no token in any payload, hard-fail on hop failure.
- **`TECH_DEBT.md`** — three entries: the proof-of-possession ceiling (PingOne
  issues no DPoP or mTLS-bound tokens; fix path is native `cnf` if PingOne adds
  it, or PingFederate/AIC); the restart-ephemeral card-signing key; the
  external-caller break below.
- **`demo_api_ui/src/components/education/A2ADelegationPanel.js`** — copy must
  keep the wire protocol distinct from RFC 8693 identity, and say plainly that
  the hop token is not sender-constrained.
- **`.claude/skills/a2a-protocol/SKILL.md`** — hard rule 3 currently says the
  wire hop uses a generalist client_credentials token. This change makes that
  false; correct it.

## Known limits

- **No proof-of-possession.** PingOne issues neither DPoP nor certificate-bound
  tokens, so a leaked hop token is limited only by its lifetime, audience and
  scope. Not simulated: with an in-process hop there is no network to steal from,
  so a proof would demonstrate nothing real.
- **Card-signing key is process-ephemeral.** Cards and JWKS are served by the
  same process, so verification always matches. A persistent key matters only
  once third parties cache cards.
- ⚠️ **External callers break.** `POST /a2a/specialists/:vertical` now requires a
  delegated token; a plain client_credentials bearer is rejected. No in-repo
  caller does this today.

## Out of scope

Proof-of-possession, a persistent signing key, `extendedAgentCard`, the orphaned
`/api/a2a/*` orchestrator route (TECH_DEBT 2026-08-29), and splitting specialists
into separate processes.

## Work order

1. `verifyA2aBearer` + its tests (red first — each check's test fails without it).
2. Card signing, the JWKS route, and verification on the client + tests.
3. Move Exchange #2 and the tool call into the specialist executor, carrying the
   PERMIT-gated local-serve fallback and its two locked tests.
4. Rewire the generalist: Exchange #1 only, delegated bearer, hard-fail.
5. Docs, Learning Hub copy, and the skill correction.
