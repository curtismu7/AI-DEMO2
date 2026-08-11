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

Two separate client consumers now independently look up that token event and
reconstruct an authorize-evidence shape from it: the Token Chain rail
(`buildTraceSteps.js`) had it first; the ProofStrip verdict
(`ProofOfEnforcementContext.js`, PR #1635) needed the identical fallback
added later because nobody had touched it and it silently read "Run failed
before authorize-decision" on a run that had, in fact, been permitted.

**Why not fixed now:** the fix that found this (#1635) was scoped to the one
broken consumer. Fixing the duplication means either (a) normalizing once in
`tokenChainTraceStore.js` where `trace.authorize` gets set, so every reader —
present and future — just reads `trace.authorize` and never re-implements the
`gw-authorize` lookup, or (b) extracting a shared helper both files import.
Either touches the shared trace store / a cross-cutting utility used by more
than the one reported bug — bigger surface than a bug fix warrants.

**Real fix:** (a) above is preferred — merge `gw-authorize` into
`trace.authorize` once during ingestion (`tokenChainTraceStore.js`), keeping
BFF-native vs gateway-native provenance distinguishable (e.g. a `source:
'gw-authorize'` field, which `buildTraceSteps.js` already stamps) so nothing
downstream loses the "who actually decided" signal Contract C4 cares about.
Delete the two independent lookups once the store does this.

**Do not break:** whatever the fix, `mcpAuthorizeEvaluationThisRequest`
itself must stay skip-shaped on the BFF side for gateway-authoritative
requests — see `mcpToolPipeline.js:456`. Any normalization belongs
client-side, not server-side.
