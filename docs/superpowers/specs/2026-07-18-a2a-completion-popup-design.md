# A2A Delegation Teaching Popup — Design

**Date:** 2026-07-18
**Status:** Approved (design), pending implementation plan
**Scope:** demo_api_ui only. No BFF/server changes.

## Goal

Teach the Agent-to-Agent (A2A) delegation concept the same way the RAR
intent-binding demo teaches RAR: when an A2A demo step completes, automatically
open a modal that explains what just happened — both agents, the nested act
chain, the two RFC 8693 exchanges, and why PingOne Authorize permitted the
depth-2 chain but would deny the generalist alone.

## Non-goals

- The token chain itself. It **already** renders the full A2A flow (both agents,
  nested act `specialist → generalist`, both exchanges, audiences, scopes, and a
  per-event educational callout). Verified live: the `a2a-agent1-actor`,
  `a2a-exchange1`, `a2a-agent2-actor`, `a2a-exchange2` events reach the UI. This
  design does **not** touch that rendering.
- No new server events, routes, or token-chain plumbing.

## Confirmed decisions

1. **Content:** static teaching prose (fixed diagram + narrative) **plus** a
   live-values panel populated from the actual run (real act chain, audiences,
   scopes).
2. **Entry points:** the same A2A content is shown **both** automatically after
   the step completes **and** on-demand via the existing explain `(i)` icon on
   the Demo Steps dropdown.
3. **Trigger for auto-open:** only A2A use cases (UC2, UC2.5), only on
   delegation success.

## Architecture

Reuse the existing teaching modal `UseCaseExplainModal`
(`demo_api_ui/src/components/UseCaseExplainModal.jsx`) — the exact component RAR
teaches through — rather than building a parallel modal. It is a `DraggableModal`
and already renders live authz-rules / gateway-topology sections via
`useExplainData`.

Three units:

### 1. A2A teaching section (in `UseCaseExplainModal`)

A new section that renders **only** when `uc` is an A2A use case
(`uc.id === 'UC2' || uc.id === 'UC2.5'`, or a `uc.a2a === true` marker added to
the catalog — decide in the plan; id check is the minimal option).

Content:
- **Two agents** — generalist (AI Agent) delegates to the specialist (e.g.
  Investment Advisor). Static labels; live client-ids/subjects from token events.
- **Nested act chain** — `act:{ specialist, act:{ generalist } }` bound to the
  user. Static explanation of what nesting proves; live chain from the run.
- **Two RFC 8693 exchanges** — Exchange #1 → per-specialist intermediate
  audience; Exchange #2 → the dedicated A2A gateway audience + the specialist's
  `invoke`/`read` scope. Static explanation; live audiences + scopes from events.
- **The teaching point** — why Authorize PERMITs depth-2 (`ActChainDepth ≥ 2`
  via a real specialist delegation) but DENIES the generalist acting alone.

Static prose lives in the component (or a small `a2aTeaching.js` constants
module). Live values come from a `a2aTokenEvents` prop (see unit 3).

### 2. Auto-open after the step (in `AIAgent.js`)

In the `nlResumeAfterAuth` resume handler's success branch (the `else` after the
approval-gate / error branches, ~line 6602), after a step resolves:

- Determine the completed step's `useCaseId` (already tracked via
  `pendingUcIdRef` / `markUseCaseCompleted`).
- If it is an A2A use case **and** delegation succeeded — reply matches
  `/Delegation complete/i` **and** `response.tokenEvents` contains `a2a-exchange2`
  with no `a2a-exchange-failed` — set state (`a2aExplainUc`, `a2aRunEvents`) that
  opens `UseCaseExplainModal` for that `uc`, passing the run's `tokenEvents`.
- On failure (the `❌ Delegated … failed` path), do **not** auto-open.

The modal is rendered once in `AIAgent.js` alongside the other agent modals,
driven by `a2aExplainUc`.

### 3. Live values for both entry points

- **Auto-open path:** the run's `response.tokenEvents` are in scope — pass them
  straight into the modal.
- **Explain-icon path** (`DemoStepsDropdown`): no live run in hand. Read the last
  A2A run's events from `tokenChainTraceStore`
  (`demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`), which
  already persists the current trace. If none present (icon opened before any
  run), render static prose only and show the live panel in a neutral
  "run the step to see live values" empty state — never an error.

A small selector `extractA2aFacts(tokenEvents)` maps the four `a2a-*` events to
`{ generalist, specialist, intermediateAud, gatewayAud, scope, actChain }` for
the section. One pure function, unit-testable.

## Data flow

```
A2A step completes (UC2/UC2.5, success)
  └─ AIAgent resume handler: detect A2A + success
       └─ setA2aExplainUc(uc); setA2aRunEvents(response.tokenEvents)
            └─ <UseCaseExplainModal uc=… a2aTokenEvents=… open />
                 └─ A2A section: static prose + extractA2aFacts(a2aTokenEvents)

Explain (i) icon (DemoStepsDropdown, A2A uc)
  └─ open UseCaseExplainModal with a2aTokenEvents = tokenChainTraceStore last A2A run (or none)
       └─ A2A section: static prose + (live facts | empty state)
```

## Error handling

- Auto-open fires only on verified success — never masks a failure.
- Missing/partial token events → live panel shows the empty state; static prose
  always renders.
- `extractA2aFacts` tolerates absent fields (returns nulls), never throws.

## Testing

- `extractA2aFacts` unit test: full events → correct facts; missing events →
  nulls, no throw.
- `UseCaseExplainModal` render test: A2A uc → A2A section present with live
  values; non-A2A uc → section absent (RAR/others unchanged).
- `AIAgent` test: A2A success response auto-opens the modal with the run's
  events; `❌ … failed` response does **not** auto-open; non-A2A step does not
  open it.
- UI build gate: `cd demo_api_ui && npm run build` exits 0 (REGRESSION_PLAN §0).

## Regression boundaries (REGRESSION_PLAN)

- Only A2A use cases auto-open; RAR and every other demo step are untouched.
- Reuse `DraggableModal` / `UseCaseExplainModal`; no new modal framework.
- Emoji allowlist only (`⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`).
- Token-chain rendering (already live) is not modified.
