# Delegation-chain value demo

## Purpose

Prove, live in the demo, the two claims RFC 8693 delegation chains deliver:

1. **Accountability** — nested `act`/`sub` claims give an evidential audit trail (who acted, when, on whose behalf). Already demonstrated by UC2 (`a2a-delegation`) and UC2.5 (`a2a-orchestrator-learning`) via `TokenChainDisplay.jsx` and `delegationAuditLogger.js`.
2. **Authorization** — a resource server can evaluate not just what the user can do, but whether the *specific agent* may act on the user's behalf. Currently has zero demo surface even though the policy branch exists: `demo_authz_server/routes/decision.js:554-558` DENYs with `invalid_a2a_generalist` when `NestedActClientId` doesn't match the registered generalist (`PINGONE_AI_AGENT_CLIENT_ID`).

This spec closes the authorization gap and packages both claims into a standalone narrative.

## Background / constraint discovered during investigation

In every real, live A2A delegation today, `NestedActClientId` is minted from the same config key that backs `PINGONE_AI_AGENT_CLIENT_ID` (`a2aDelegationService.js:154`, `configStore.js:1164`) — so a genuine live exchange can never produce a mismatched actor. No second registered agent identity exists in this environment. Registering a real second PingOne Worker app to make the mismatch fully end-to-end was considered and rejected as disproportionate cost for a demo scenario (decision made explicitly with the user). Instead, the mismatch is fabricated at the decision-call layer, the same pattern `demo_api_server/scripts/verifyA2aDelegationPolicy.js` already uses to hit the real P1AZ decision endpoint directly — real policy, real DENY, no new PingOne app.

**Implication:** the DENY leg of UC2.6 is a real policy decision but not a full live token mint. The UI must label it as an actor-mismatch probe, not imply a second real agent was minted a token.

## Scope

### 1. New use case: UC2.6 `a2a-generalist-mismatch`

Added to `demo_api_server/config/useCases.js`, foundations/A2A group, alongside UC2/UC2.5. One trigger chip, one flow, two legs:

- **Leg 1 (PERMIT)** — reuses the existing UC2 live delegation path: correct generalist, genuine act chain, genuine PERMIT.
- **Leg 2 (DENY)** — new service call that sends a fabricated/unregistered `NestedActClientId` directly to the real P1AZ decision endpoint (same call shape as `verifyA2aDelegationPolicy.js`), producing a genuine `invalid_a2a_generalist` DENY from live policy.

Same `ff_a2a_delegation` flag as UC2/UC2.5 (already present in `demo_api_ui/src/utils/requiredDemoFlags.js:48`) — no new flag needed.

Evidence/UI for leg 2 must carry a distinct label (e.g. "simulated actor mismatch") so it's not confused with a full live exchange.

**Audit trail check:** `delegationAuditLogger.js` logs `DELEGATION_ACTION` via `delegationAuditMiddleware` on the normal request path. Because leg 2 bypasses the normal live-exchange path (it calls the decision endpoint directly), confirm during implementation whether that middleware still runs; if not, add an explicit `logDelegationEvent` call for the DENY so the blocked attempt itself is captured as accountability evidence — a denied cross-agent attempt is exactly the kind of thing this feature is meant to prove gets recorded.

### 2. Chip rendering — no new component

`TokenChainDisplay.jsx` and `ProofStrip.jsx` already render PERMIT/DENY + act-chain evidence for UC2/UC2.5. UC2.6 slots into the same rendering path unchanged.

### 3. Dedicated page

New route + nav entry (following the `/demo-track` registration pattern in `App.js`, nav entry alongside existing entries in `AdminSideNav.jsx` or main nav — exact file confirmed at implementation time). Live page, not a static explainer:

- Embeds real chip triggers for UC2 (accountability leg: full act chain, PERMIT) and UC2.6 (authorization leg: PERMIT then DENY, same user, different agent).
- Narrative framing follows the two claims verbatim: audit-trail attributability, and actor-aware policy decisions (not just user-aware).
- Reuses `TokenChainDisplay`/`ProofStrip` inline — same components as the chip path elsewhere, no divergent rendering.

## Out of scope

- Registering a real second PingOne Worker app for a fully genuine end-to-end mismatched exchange (rejected — cost disproportionate to demo value; fabricated-decision-call approach chosen instead).
- Embedding UC2.5 (orchestrator) on the new page — optional link-out only, not required.
- Any change to the `invalid_a2a_generalist` policy branch itself — it already exists and is correct; this spec only adds a demo path that exercises it.

## Testing

- BFF: `CI=true npm test -- --forceExit` in `demo_api_server` — cover the new UC2.6 service call (leg 2) and confirm audit logging fires.
- UI: `npm run test:unit && npm run build` in `demo_api_ui` — cover chip rendering for UC2.6 (reuses existing TokenChainDisplay/ProofStrip tests where possible) and the new page.
- Manual: verify chip flow end-to-end in Super Sports vertical (per project default), and verify the new page renders both legs live against the running stack.
