# Tech Debt

Known gaps and architectural smells found while fixing something else —
correct enough to ship, not worth blocking the fix that found them. Not a bug
log (`REGRESSION_PLAN.md` §4 is that); this is "should fix properly later."

Reverse-chronological, newest first. Each entry: what's wrong, why it wasn't
fixed now, what the real fix looks like.

### 2026-08-11 — gw-authorize fallback duplicated across two client consumers

**Where:** `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`
(around line 594) and `demo_api_ui/src/context/ProofOfEnforcementContext.js`
(`gwAuthorizeEvent()`).

**What's wrong:** on a gateway-authoritative run (`useGateway: true`), the BFF
skips its own Authorize gate — `mcpAuthorizeEvaluationThisRequest` stays a
skip-shaped object with no `.decision` (this is intentional, see Contract C4
comment at `mcpToolPipeline.js:456` — it's how a caller tells "BFF's gate
didn't run" apart from "it ran and permitted"). On PERMIT, the real decision
only ever arrives client-side as a `gw-authorize` token event
(`mcpToolPipeline.js:956-977`), never merged into `trace.authorize`.

This "authorize decision may only be visible as a `gw-authorize` event, not
`trace.authorize` / `body.authorize`" fact is independently reimplemented in
**four** places, not two:

1. `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js:594` — Token
   Chain rail (had it first).
2. `demo_api_ui/src/context/ProofOfEnforcementContext.js`
   (`gwAuthorizeEvent()`) — ProofStrip verdict, added in #1635 because
   nobody had touched it and it silently read "Run failed before
   authorize-decision" on a run that had, in fact, been permitted.
3. `demo_api_server/services/stepVerificationExpectations.js:341-345`
   (`hasAuthorize` in `scoreDelegatedAccessInvoke`) — server-side chip
   prerequisite scorer, same fallback, third independent implementation.
4. `demo_api_server/services/attackSimulatorService.js:295-316`
   (`_authorizeFromPipelineOutcome` → `_normalizeAuthorizeDecision`) — attack
   sim outcome scoring, fourth implementation. Well-documented (docstring at
   282-294 explains the two-source fallback explicitly) so less of a silent
   trap than #2, but still separate logic reimplementing the same fact.

**Why not fixed now:** the fix that found this (#1635) was scoped to the one
broken consumer (#2). Fixing the duplication means normalizing the fallback
in one place per side — client (`tokenChainTraceStore.js`, where
`trace.authorize` gets set, covers #1 and #2) and server (wherever
`stepVerificationExpectations.js` and `attackSimulatorService.js` could share
a helper, covers #3 and #4) — since #3 reads a raw HTTP response body, not
`trace.tokenEvents`, it can't share the client-side store fix directly.
Either normalization touches shared/cross-cutting code used by more than the
one reported bug — bigger surface than a bug fix warrants.

**Real fix:** two separate normalizations, not one:

- Client: merge `gw-authorize` into `trace.authorize` once during ingestion
  (`tokenChainTraceStore.js`), keeping BFF-native vs gateway-native
  provenance distinguishable (e.g. a `source: 'gw-authorize'` field, which
  `buildTraceSteps.js` already stamps) so nothing downstream loses the "who
  actually decided" signal Contract C4 cares about. Fixes #1 and #2.
- Server: extract the `gw-authorize`-token-event fallback shared by #3 and #4
  into one helper (`attackSimulatorService.js`'s `_normalizeAuthorizeDecision`
  is the closer-to-reusable of the two) so both consumers call it instead of
  hand-rolling the `seenIds.has('gw-authorize')` / `events.find(...)` check.

**Do not break:** whatever the fix, `mcpAuthorizeEvaluationThisRequest`
itself must stay skip-shaped on the BFF side for gateway-authoritative
requests — see `mcpToolPipeline.js:456`. Client-side normalization must not
try to make the server stop being honest about that.
