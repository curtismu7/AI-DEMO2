# UC22 CIBA Step-Up Override — Design

**Date:** 2026-07-19
**Status:** Approved (design), pending implementation plan
**Scope:** demo_api_server only. No demo_api_ui, no config/session changes.

## Goal

Make UC22 ("CIBA out-of-band approval," catalog `useCaseId:
'ciba-out-of-band-approval'`) actually exercise CIBA when run from the
use-case launcher or the progressive-trust demo's Act 4b, instead of
silently falling through to whatever `step_up_method` is globally
configured (currently `p1mfa` via `.env`'s `STEP_UP_METHOD=p1mfa`, which
overrides for every transfer regardless of which use case triggered it).

## Non-goals

- Not fixing the `ciba_enabled`/`ff_ciba` launcher badge mismatch (it reads
  a separate `configStore` flag than the `CIBA_ENABLED` env var the backend
  route actually checks) — out of scope per the chosen option.
- Not fixing the `'p1mfa'` vs `'pingone-mfa'` Security Settings dropdown
  value mismatch — cosmetic, unrelated to this change.
- Not building a general "per-use-case config override" framework — this is
  one hardcoded check for one use case's slug, matching the existing
  idiom in this codebase (e.g. `PROGRESSIVE_TRUST_STRIP_IDS = new
  Set(['UC24'])` in `UseCaseLauncherPage.js`).
- Not touching the global `step_up_method` config, session state, or any
  revert/cleanup logic — there is nothing to revert.

## Confirmed decision

**Per-request override via the already-threaded `useCaseId` parameter** —
not a session flag, not a global config PATCH+revert.

`useCaseId` already flows end-to-end for every transfer, with no code
changes needed to get it there:

```
UseCaseLauncherPage.handleRun()
  → POST /api/use-cases/demo/run { useCaseId, vertical }
  → navigate('/dashboard', { state: { useCaseId, triggerText, ... } })
  → AIAgent.js reads location.state.useCaseId on mount (AIAgent.js:1043-1048)
  → threaded through the NL/tool-call pipeline as `ctx.useCaseId`
    (mcpToolPipeline.js: 342, 496, 529-530, 555, 569, 576)
  → POST /api/transactions body.useCaseId (routes/transactions.js:606)
  → evaluateTransactionPolicy({ ..., useCaseId })
    (transactionAuthorizationService.js:117-125 — already a parameter)
```

This makes the override **inherently request-scoped**: it exists only for
the lifetime of the one HTTP request evaluating that one transfer. No other
concurrent session's transfers are affected regardless of timing, because
nothing is written anywhere shared (no session field, no configStore key).
There is no revert step because there is nothing to revert.

## Architecture

### `transactionAuthorizationService.js` changes

`buildStepUpBody` (currently `demo_api_server/services/transactionAuthorizationService.js:35`)
gains a `useCaseId` parameter:

```javascript
const CIBA_DEMO_USE_CASE_ID = 'ciba-out-of-band-approval'; // UC22's useCaseId slug

function buildStepUpBody({ useSimulated, policyId, runtimeSettings, useCaseId }) {
  const STEP_UP_ACR = runtimeSettings.get('stepUpAcrValue');
  const stepUpMethod = useCaseId === CIBA_DEMO_USE_CASE_ID
    ? 'ciba'
    : (configStore.getEffective('step_up_method') || runtimeSettings.get('stepUpMethod') || 'ciba');
  return {
    error: 'step_up_required',
    hitl: { type: 'step_up' },
    error_description: useSimulated
      ? 'This transaction requires additional authentication (MFA) as required by the simulated authorization policy (education mode).'
      : 'This transaction requires additional authentication (MFA) as required by the authorization policy.',
    step_up_acr: STEP_UP_ACR,
    step_up_method: stepUpMethod,
    step_up_url: '/api/auth/oauth/user/stepup',
    authorize_policy_id: policyId || undefined,
    authorize_engine: useSimulated ? 'simulated' : 'pingone',
  };
}
```

`buildStepUpBlock` (`:61`) passes `useCaseId` through unchanged in shape —
just one more field in the object it forwards to `buildStepUpBody`:

```javascript
function buildStepUpBlock({ useSimulated, policyId, runtimeSettings, useCaseId, extra = {} }) {
  const body = { ...buildStepUpBody({ useSimulated, policyId, runtimeSettings, useCaseId }), ...extra };
  // ...unchanged below this line...
}
```

All three existing call sites of `buildStepUpBlock` inside
`evaluateTransactionPolicy` (`:215`, `:288`, `:419`) add `useCaseId,` to
their call — `useCaseId` is already an `evaluateTransactionPolicy`
parameter (`:117-125`), so it's already in scope at all three sites; no new
plumbing above this function is needed.

### No changes anywhere else

- `routes/transactions.js` already passes `useCaseId: req.body?.useCaseId
  || ''` into `evaluateTransactionPolicy` (`:606`) — unchanged.
- `routes/ciba.js`, `cibaService.js`, `cibaSimulatedService.js` — unchanged.
  Once the 428 body says `step_up_method: 'ciba'`, the existing (already
  built and live-verified) CIBA UI bridge in `UserDashboard.js` and the
  simulated-fallback poll cycle take over exactly as they do today for any
  other CIBA-triggered step-up.
- `demo_api_ui` — zero changes. `UserDashboard.js`'s `beginStepUp()` already
  reads `step_up_method` off the 428 response and branches into the CIBA
  toast when it's `'ciba'` — this was already true before this change; the
  only thing changing is which value UC22 specifically produces.

## Data flow

```text
User clicks "Run" on UC22 in the launcher
  → POST /api/use-cases/demo/run { useCaseId: 'ciba-out-of-band-approval' }
  → navigate to /dashboard with { useCaseId, triggerText: 'transfer $600 from checking to savings' }
  → AIAgent.js sends that text as an NL message, useCaseId threaded through ctx
  → create_transfer tool call → POST /api/transactions { ..., useCaseId }
  → evaluateTransactionPolicy(..., useCaseId: 'ciba-out-of-band-approval')
  → amount $600 ≥ $250 threshold → buildStepUpBlock(..., useCaseId)
  → buildStepUpBody: useCaseId matches CIBA_DEMO_USE_CASE_ID → step_up_method: 'ciba'
  → 428 (or 401 in RFC 9470 mode) returned with step_up_method: 'ciba'
  → UserDashboard.js beginStepUp() → CIBA toast → handleCibaStepUp() →
    POST /api/auth/ciba/initiate → (real bc-authorize fails, unrouted on
    this env) → simulated fallback → poll → approved after ~7s →
    "Identity verified — please retry your transaction." → user retries →
    stepUpVerified fresh → transfer succeeds
```

Everything from `POST /api/auth/ciba/initiate` onward is the existing,
already-shipped, already-live-verified simulated CIBA fallback — unchanged
by this design.

## Error handling

- Any other use case, or no `useCaseId` at all (e.g. a transfer typed
  directly without going through the launcher), is completely unaffected —
  falls through to the existing `configStore.getEffective('step_up_method')
  || runtimeSettings.get('stepUpMethod') || 'ciba'` chain, exactly as today.
- If a user runs UC22 but the transfer amount somehow doesn't cross the
  step-up threshold (e.g. thresholds were reconfigured lower/higher at
  runtime), no step-up fires at all — same as today for any use case; this
  change only affects *which method* is chosen once the gate has already
  decided to fire, not whether it fires.

## Testing

- Unit test on `buildStepUpBody`: `useCaseId: 'ciba-out-of-band-approval'`
  → `step_up_method: 'ciba'` regardless of `configStore`/`runtimeSettings`
  values. Any other `useCaseId` (including `undefined`/`''`) → unchanged
  existing behavior (falls through to the prior resolution chain).
- Existing `step-up-gate.test.js` cases must still pass unmodified — this
  change only adds a new branch ahead of the existing resolution, it
  doesn't alter it.
- Live smoke test (manual, post-implementation): run UC22 from
  `/use-cases`, confirm the 428/401 step-up response's `step_up_method` is
  `'ciba'`, confirm the CIBA toast appears and the simulated-approval path
  completes the transfer.

## Files touched

| File | Change |
|---|---|
| `demo_api_server/services/transactionAuthorizationService.js` | Add `CIBA_DEMO_USE_CASE_ID` constant, add `useCaseId` param to `buildStepUpBody`/`buildStepUpBlock`, add `useCaseId,` to the 3 `buildStepUpBlock` call sites |
| `demo_api_server/src/__tests__/step-up-gate.test.js` | New test cases for the `useCaseId` override |

## Open risks

- None identified. The change is additive (one new optional parameter,
  checked before the existing fallback chain) and touches no shared state.
