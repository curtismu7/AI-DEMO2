# Token Chain — dynamic authorize cards (repeatable-step instances)

**Date:** 2026-07-27
**Status:** design, awaiting user approval

## Why

A live `create_transfer` $2500 run showed the Token Chain's "PingOne Authorize"
card as `PERMIT` (the McpFirstTool gate's own decision, statements not yet
fulfilled) while the chat simultaneously reported "Transfer failed: PingOne
Authorize denied MCP tool access for this session." The two didn't contradict
each other — they were **two separate PingOne decisions** that the pipeline
already evaluates in sequence:

1. **McpFirstTool gate** — "may this agent invoke this tool at all" (audience,
   actor chain, HITL/step-up obligations). For this run: `PERMIT`.
2. **Transaction/Amount policy** — consulted only for amount-bearing write
   tools (`mcpToolAuthorizationService.js` `_applyTransactionPolicy`,
   L340-359). For this run: `DENY` ($2500 exceeds the deny limit). Its
   comment block is explicit: *"a hard limit-DENY overrides everything
   (UC6, $2500)"*.

`_applyTransactionPolicy` (L367-449) currently **overwrites** the gate's
result object (`r.decision = 'DENY'`, `r.raw = t.raw`, …) instead of keeping
both. By the time `mapLivePingOneResult` (L919-1043) and the wire body
(`mcpToolPipeline.js` L464-487 / L513-519) see it, the original gate decision
is gone — only the merged/overridden decision survives as the single
`mcpAuthorizeEvaluation` field. `buildTraceSteps.js`'s `authorize` step
(L322-415) then renders exactly one card from whatever single decision
reached it — so a run with two real decisions could only ever show one, and
which one depended on execution order, not on what actually happened.

The Token Chain rail's step model is fixed-slot: `buildTraceSteps()` produces
one `steps.push(makeStep(id, …))` per lane (`signin`, `agent`, `exchange`,
`authorize`, `gateway`, `mcp`, …), each rendering at most one
`TraceStepCard`. This spec makes the `authorize` lane the first
**repeatable** step — 1 card per decision that actually ran, in execution
order — instead of collapsing to one. Every other lane is untouched.

A second identified case for repeatable cards — A2A delegation adding a card
for the specialist agent's own hop — is **out of scope here**. Investigation
found `a2aOrchestratorService.js` returns `tokenEvents: []` on its
orchestration-decision stage, and while the specialist tool *call* itself
does flow through the standard pipeline (`bffMcpToolExecutor.js`
`executeBffToolWithToken`, L310-369) and does emit standard `exchange` /
`gateway` / `mcp` tokenEvents, those events carry no hop/agent tag — so
today they'd either collide with or silently overwrite the primary agent's
own cards for the same lanes. That's a distinct instrumentation gap (tagging
which agent a hop belongs to), not something this spec's mechanism alone
fixes. It gets its own brainstorm/spec once this ships; the `baseId` +
instance-`id` pattern introduced here is intended to be reused for it.

## What it does

Preserve both PingOne decisions server-side instead of discarding the first,
carry them to the client as an ordered list only when a second decision
actually happened (single-decision runs are byte-for-byte unchanged), and
let the `authorize` step in the trace-rail render one card per decision in
the order they ran.

## Components & changes

### `demo_api_server/services/mcpToolAuthorizationService.js`

- `_applyTransactionPolicy` (L367-449): before each override branch (DENY
  L388-398, step-up L399-411, HITL/consent L415-423) snapshot the pre-override
  gate result as `gateEvaluation` and attach it plus the transaction-policy
  outcome onto the returned object:

  ```js
  return {
    ...r,
    decision: 'DENY', // (etc — existing override fields unchanged)
    secondaryEvaluation: {
      source: 'transaction-policy',
      decision: t.decision,           // or synthesized 'DENY'/'STEP_UP'/'HITL_REQUIRED'
      decisionId: t.decisionId || null,
      raw: t.raw || null,
    },
    gateEvaluation: { decision: r.decision, decisionId: r.decisionId, raw: r.raw },
  };
  ```

  The `_localAmountLimitFallback` branch (L300-338, used when the live
  Transaction endpoint 429s/errors) already synthesizes a decision the same
  shape can wrap — tag `raw.engine: 'local-amount-fallback'` (already present)
  so the card can note it's a fallback, not a live decision.
  No override happens (bare PERMIT from the transaction consult, or the gate
  itself already denied and short-circuited at L383) → object shape is
  unchanged from today, no `secondaryEvaluation` key at all.
- `mapLivePingOneResult` (L919-1043): in the DENY/step-up/HITL branches,
  thread `r.gateEvaluation` / `r.secondaryEvaluation` through into
  `block.body` (new keys, additive — existing keys unchanged) alongside the
  existing single-decision fields. In the permit branch (L1029-1043), same —
  onto `evaluation`.
- New export label: extend `DECISION_CONTEXT_LABELS`-equivalent context isn't
  in this file, but the **decisionContext** value this file already sets for
  the transaction-policy branch must be a distinct string (e.g.
  `'TransactionAmount'`) so the frontend's `friendlyDecisionContext` (see
  below) can title the second card differently from the gate's
  `'McpFirstTool'`.

### `demo_api_server/services/mcpToolPipeline.js`

- Block path (L464-487) and permit path (L513-519): where the singular
  `mcpAuthorizeEvaluation` is built, add a sibling array **only when a
  secondary decision is present**:

  ```js
  ...(mcpAuthz.block.body.gateEvaluation && mcpAuthz.block.body.secondaryEvaluation
    ? { mcpAuthorizeEvaluations: [
          { ...mcpAuthz.block.body.gateEvaluation, decisionContext: 'McpFirstTool' },
          { ...mcpAuthz.block.body.secondaryEvaluation, decisionContext: 'TransactionAmount' },
        ] }
    : {}),
  ```

  The existing singular `mcpAuthorizeEvaluation` field is **not changed** —
  it keeps representing the decision that determined the outcome, exactly as
  today. `stepVerificationExpectations.js` PASS/FAIL scoring and any other
  singular-field reader are untouched and carry zero risk from this change.

### `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`

- Add `ingestAuthorizeEvaluations(list)` alongside the existing
  `ingestAuthorize(evaluation)` (L102-124): stores `trace.authorizeEvaluations
  = list` verbatim (no HITL/step-up priorGate merge logic — that's specific
  to the single-outcome field and unaffected). Call sites still call
  `ingestAuthorize` with the final/winning decision exactly as today (so
  `trace.authorize` singular semantics are unchanged); additionally call
  `ingestAuthorizeEvaluations` when the payload carries the plural field.
- Add `authorizeEvaluations: null` to the initial trace shape (next to
  `authorize: null` at L11).

### `demo_api_ui/src/services/demoAgentService.js`

- At each of the 3 existing `if (data.mcpAuthorizeEvaluation) { … }` /
  `err.mcpAuthorizeEvaluation` sites (L399-429, L674-699, L1040-1041): add a
  companion check —
  `if (data.mcpAuthorizeEvaluations) tokenChainTraceStore.ingestAuthorizeEvaluations(data.mcpAuthorizeEvaluations)`
  (same for the `err.` variant at the 4xx block site). Purely additive next
  to the existing singular-field handling.

### `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`

- `DECISION_CONTEXT_LABELS` (L65-68): add
  `TransactionAmount: "Amount / transaction policy check"` alongside the
  existing `McpFirstTool: "MCP tool-call check"`.
- The `authorize` block (L322-415): evidence source becomes
  `trace.authorizeEvaluations || [azEval]` — `azEval` is exactly today's
  existing derivation (L338-358, unchanged), so a run with no plural field
  produces the same single-element list it always implicitly did. Loop over
  the list and push one step per entry using the **same per-entry logic
  already in the block** (status/why/request/response/kv/replay), with two
  additions per instance:
  - `id`: `"authorize"` for index 0, `"authorize:2"`, `"authorize:3"`, … for
    the rest (stable — used as the React `key` and as the replay-button
    target).
  - `baseId: "authorize"` on every instance (new field) — the family
    identity other code uses to mean "the authorize step" regardless of how
    many cards it rendered.

### `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js` — `buildRunStory` (L158-201)

- L169: `const az = list.find((s) => s && s.id === 'authorize')` →
  `list.filter((s) => s && s.baseId === 'authorize')`, then pick the
  instance that determined the outcome: prefer a `DENY`-decision instance
  over a `PERMIT` one if both exist (mirrors the DENY-wins-over-PERMIT
  precedence `_applyTransactionPolicy` already encodes server-side); fall
  back to the single instance when there's only one. Everything downstream
  of `decision` in this function is unchanged.

### Unaffected (verified, no changes)

- `MCP_STEP_IDS` (L17) — doesn't include `'authorize'`, no change needed.
- `TraceStepCard.jsx` — renders whatever step object it's given, keyed by
  `step.id`; unique ids are all it needs.
- `TraceMcpPanel`, `TraceTokenSummary`, the `stepup` / `intent-binding`
  conditional steps, and every other lane in `buildTraceSteps.js` —
  untouched.
- Simulated-authorize-engine path (`evaluateMcpFirstToolGate`'s
  `runSimulated` branch) never calls `_applyTransactionPolicy` — confirmed
  by reading the code path — so it never produces a `secondaryEvaluation`
  and always renders 1 card, same as today.

## Edge cases

- **Gate itself denies** (L383 short-circuit: `if (r.decision === 'DENY' ||
  r.policyNotFound || r.stepUpRequired) return r;`) — transaction consult
  never runs, no `secondaryEvaluation`, 1 card, unchanged today's behavior.
- **Transaction consult throws / 429s** — `_localAmountLimitFallback` (L300-
  338) already returns a decision; wrapped the same as a live secondary
  decision, tagged as a fallback via the existing `raw.engine` field.
- **Transaction consult returns bare PERMIT** (adds nothing) — per the
  existing comment at L412-414/L441-448, the gate's own decision/obligations
  stand; no override happens, so no `secondaryEvaluation` — 1 card.
- **HITL/consent promoted from transaction policy onto the gate** (L412-423)
  — the transaction consult returned a real, distinct decision
  (`t.consentRequired`/`t.hitlRequired`) that changes the outcome, same kind
  of event as the DENY/step-up branches above — it gets `gateEvaluation` +
  `secondaryEvaluation` attached too, so this also renders 2 cards (gate,
  then the promoted HITL obligation), not a special case.
- **Malformed/missing `mcpAuthorizeEvaluations` on the wire** (old server
  talking to new client, or vice versa during a rolling deploy) —
  `tokenChainTraceStore` only acts on it when present; `buildTraceSteps`
  falls back to `[azEval]`. No crash path either direction.

## Success criteria

- Replaying the $2500 `create_transfer` scenario (live PingOne) shows **two**
  "PingOne Authorize" cards in the Token Chain: the McpFirstTool gate
  (`PERMIT`) first, the Transaction/Amount policy (`DENY`) second — and the
  rail's run-story headline reflects the DENY, matching the chat's "Transfer
  failed" message (no more contradiction between the top-line outcome and
  the card shown).
- Every other existing use case (single authorize decision) renders exactly
  1 authorize card, identical to today — regression-safe by construction
  (the array-of-1 fallback path).
- `stepVerificationExpectations.js` PASS/FAIL scoring is unaffected —
  verified by reading its scoring logic reads the singular field, which this
  change never alters.
- Backend: `CI=true npm test -- --forceExit` (demo_api_server) green.
- Frontend: `npm run test:unit && npm run build` (demo_api_ui) green.

## Out of scope

- A2A second-agent card — needs its own spec to tag which agent a
  hop belongs to before the repeatable-step mechanism has anything to
  render; noted above as follow-up work reusing this spec's `baseId` /
  instance-`id` pattern.
- Any other lane becoming repeatable (gateway, mcp, exchange, …) — only
  `authorize` changes in this spec.
- Changing what `_applyTransactionPolicy` actually decides (deny/step-up/
  HITL thresholds) — this spec only stops it from discarding evidence, it
  doesn't touch the policy logic itself.

## Test plan

- Backend unit: `mcpToolAuthorizationService.js` — extend the existing
  `_applyTransactionPolicy` direct-testing coverage (already exported per
  L1336) with cases asserting `secondaryEvaluation`/`gateEvaluation` present
  on DENY/step-up/HITL override, absent on bare-PERMIT and on
  gate-already-denied short-circuit.
- Backend unit: `mcpToolPipeline.js` — block/permit body carries
  `mcpAuthorizeEvaluations` (2 entries, correct order/decisionContext) only
  when the gate result carries both evaluation keys; singular
  `mcpAuthorizeEvaluation` unchanged either way.
- Frontend unit: `buildTraceSteps` — fixture with `trace.authorizeEvaluations`
  (2 entries) asserts 2 step objects with correct `id`
  (`authorize`/`authorize:2`), `baseId: 'authorize'`, and order; existing
  single-decision fixtures (no plural field) still assert exactly 1 step —
  regression guard for back-compat. `buildRunStory` fixture with both a
  PERMIT and a DENY instance asserts the headline reflects the DENY.
- Frontend unit: `tokenChainTraceStore` — `ingestAuthorizeEvaluations`
  stores the array verbatim; absent on payloads without the plural field.
- Manual/live: reproduce the $2500 transfer scenario end-to-end, confirm the
  Token Chain rail shows both cards and the run-story headline/chat message
  agree.
