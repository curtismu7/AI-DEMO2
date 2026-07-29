# AG-UI path — wire authorize decisions into the Token Chain

**Date:** 2026-07-28
**Status:** design, awaiting user approval
**Depends on:** PR #1070 (`worktree-token-chain-dynamic-authorize-cards`, unmerged) — this branch is based on it; the `gateEvaluation`/`secondaryEvaluation` fields and `secondaryEvaluationEngine()` helper this spec reuses only exist because of that PR.

## Why

On `/use-cases/live`, running a chip renders the Token Chain rail with no
detail on the "PingOne Authorize" step. Traced to: `ff_agui_enabled`
defaults to `'true'`, so chip runs go through the AG-UI streaming pipeline
(`sendAsNl` → `aguiRun` → `POST /api/agent/run`), not the older
`callMcpTool`/`/api/agent/invoke` paths PR #1070 already wired.

The AG-UI path's own protocol state (`useAgentState.js`) declares an
`authorizeDecisions: []` array (both frontend `useAgentState.js:30` and
backend `agentRun.js:461`) but nothing ever writes to it — dead state on
both sides. Tool execution on this path still runs the real gate: `agentRun.js`
persists a `flowTraceId` on the session; the agent service calls back into
the BFF at `/internal/agent-tool` (`agentTool.js`), which calls
`executeBffTool` → `runMcpToolPipeline` — the SAME pipeline, SAME
`mcpToolAuthorizationService.js` gate, as every other path. So the decision
data genuinely exists; it's the last-mile publish that's missing.

`runMcpToolPipeline` already computes `mcpAuthorizeEvaluationThisRequest`
(`mcpToolPipeline.js:330`, reused at the main success return to build
`out.mcpAuthorizeEvaluation`/`out.mcpAuthorizeEvaluations`), and already
publishes MCP tool results live over a separate SSE channel keyed by
`flowTraceId` — `deps.publishMcpResultToSse(...)`, consumed by
`useAgentRun.js:145`'s `openMcpFlowSse` subscription, which dispatches a
`mcp-tool-result-sse` window event that `tokenChainTraceStore.js:185`
already listens for (via `ingestMcpResult`) — this is precisely what fills
the MCP/API Token Chain steps for the AG-UI path today. The authorize
decision was simply never included in that payload, and the listener never
checked for it.

## What it does

Extend the existing `publishMcpResultToSse` payload to optionally carry the
authorize decision(s) (singular + plural, same shapes PR #1070 established),
and extend the frontend listener that already consumes that payload to
ingest them. No new SSE channel, no AG-UI-protocol event type, no change to
any path this doesn't touch — every other consumer of `publishMcpResultToSse`
(non-AG-UI paths already using it) is unaffected since the new fields are
additive and only appear where authorize data exists.

## Components & changes

### `demo_api_server/services/mcpSsePublisher.js`

`publishMcpResultToSse(flowTraceId, { tool, result, durationMs, isDelegated, requestJson, denied })`
(L20) gains two more optional destructured params, included in the built
payload only when present:

```js
function publishMcpResultToSse(flowTraceId, {
  tool, result, durationMs, isDelegated, requestJson, denied,
  mcpAuthorizeEvaluation, mcpAuthorizeEvaluations,
}) {
  if (!flowTraceId) return;
  const success = !denied && result && !result.isError && !result.error;
  const toolResultJson = result?.content
    ? result.content.slice(0, 10)
    : result != null ? result : null;
  mcpFlowSseHub.publish(flowTraceId, buildSsePayload('mcp-result', {
    toolName: tool,
    tool,
    status: success ? 'success' : 'failure',
    duration: durationMs ?? 0,
    isDelegated: !!isDelegated,
    denied: !!denied,
    resultSummary: success ? `${tool} completed` : `${tool} failed`,
    resultJson: toolResultJson,
    result: toolResultJson,
    requestJson: requestJson ?? null,
    timestamp: new Date().toISOString(),
    ...(mcpAuthorizeEvaluation ? { mcpAuthorizeEvaluation } : {}),
    ...(mcpAuthorizeEvaluations ? { mcpAuthorizeEvaluations } : {}),
  }));
}
```

### `demo_api_server/services/mcpToolPipeline.js`

- New local helper, placed near `secondaryEvaluationEngine()` (L26 — reused
  here, not duplicated):

  ```js
  /**
   * Split the gate's merged evaluation (mcpAuthorizeEvaluationThisRequest)
   * into the singular field shape every existing consumer reads, plus,
   * when a Transaction/Amount secondary decision fired, the ordered plural
   * array (gate first, secondary second) buildTraceSteps renders as 2 Token
   * Chain cards. Returns null when there's nothing to report (gate
   * skipped/not-run — the input is falsy).
   */
  function splitAuthorizeEvaluation(v) {
    if (!v) return null;
    const { gateEvaluation: _ge, secondaryEvaluation: _se, ...singular } = v;
    const plural = _ge && _se
      ? [
          { ..._ge, engine: 'pingone', decisionContext: 'McpFirstTool' },
          { ..._se, engine: secondaryEvaluationEngine(_se), decisionContext: 'TransactionAmount' },
        ]
      : null;
    return { singular, plural };
  }
  ```

- Main success-path `out` assembly (L1010-1025) — refactor to call the new
  helper, byte-identical output:

  ```js
  const out = {
      result,
      tokenEvents,
      activeModel,
      activeProvider
  };
  const authEval = splitAuthorizeEvaluation(mcpAuthorizeEvaluationThisRequest);
  if (authEval) {
      out.mcpAuthorizeEvaluation = authEval.singular;
      if (authEval.plural) out.mcpAuthorizeEvaluations = authEval.plural;
  }
  ```

- Five `deps.publishMcpResultToSse(...)` call sites that run **after** the
  authorize-gate section (confirmed reachable only once
  `mcpAuthorizeEvaluationThisRequest` is assigned — real permit/skip shape,
  never mid-gate) each gain the same two computed fields:

  - **L924** (normal remote-tool-call success):

    ```js
    const _authEval = splitAuthorizeEvaluation(mcpAuthorizeEvaluationThisRequest);
    deps.publishMcpResultToSse(flowTraceId, {
      tool, result, durationMs: _durationMs, isDelegated: !!mcpAccessToken, requestJson,
      mcpAuthorizeEvaluation: _authEval?.singular || null,
      mcpAuthorizeEvaluations: _authEval?.plural || null,
    });
    ```

  - **L948** (MCP-server auth-challenge → local fallback): same 2-line
    addition, using a freshly computed `_authEval` (same helper call).
  - **L1150** (gateway HITL-required 428): same addition inside the
    existing `try { ... } catch (_) { /* SSE best-effort */ }` block.
  - **L1176** (gateway generic deny 403): same addition inside its existing
    `try { ... }` block.
  - **L1320** (MCP-server-unreachable → local fallback): same 2-line
    addition.

  Each site: `const _authEval = splitAuthorizeEvaluation(mcpAuthorizeEvaluationThisRequest);`
  immediately before its `publishMcpResultToSse` call, then add
  `mcpAuthorizeEvaluation: _authEval?.singular || null, mcpAuthorizeEvaluations: _authEval?.plural || null,`
  to that call's options object.

- **L272 is explicitly excluded.** It's the token-exchange-failure local
  fallback — the sole `publishMcpResultToSse` call site that runs *before*
  `mcpAuthorizeEvaluationThisRequest` is even declared (L330). The gate
  never ran on this path; there is no decision to report, and referencing
  the variable there would be a TDZ error. No change at this call site.

### `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`

The existing passive window listener (L185-187) gains two guarded calls,
reusing `ingestAuthorize`/`ingestAuthorizeEvaluations` (both already exist,
from PR #1070/its predecessor):

```js
if (typeof window !== "undefined") {
  window.addEventListener("mcp-tool-result-sse", (e) => {
    if (!e || !e.detail) return;
    tokenChainTraceStore.ingestMcpResult(e.detail);
    if (e.detail.mcpAuthorizeEvaluation) {
      tokenChainTraceStore.ingestAuthorize(e.detail.mcpAuthorizeEvaluation);
    }
    if (e.detail.mcpAuthorizeEvaluations) {
      tokenChainTraceStore.ingestAuthorizeEvaluations(e.detail.mcpAuthorizeEvaluations);
    }
  });
}
```

This listener already fires for every path that dispatches
`mcp-tool-result-sse` — not just AG-UI (`demoAgentService.js` also
dispatches it, at its own SSE-relay sites). Those other paths' events won't
carry the two new fields (their `publishMcpResultToSse` call sites are
unchanged elsewhere, unaffected by this spec), so the new `if` blocks are
silent no-ops there — purely additive, no behavior change on non-AG-UI
paths.

### Unaffected (verified, no changes)

- `publishMcpResultToSse` has no call sites outside `mcpToolPipeline.js`
  (confirmed via grep across `demo_api_server/services` and `routes`) — the
  6 sites listed above are the complete set; no other caller to check.
- `useAgentState.js`'s own dead `authorizeDecisions: []` state — left as-is.
  Not the mechanism this spec uses (the SSE/`mcp-tool-result-sse` channel
  already reaches `tokenChainTraceStore` directly); out of scope to also
  wire this second, currently-unused state array.
- `agentTool.js`'s HTTP response body (`res.json({...})`, L161-176) — does
  NOT need the singular/plural fields added. That response goes back to the
  agent-framework's tool-call layer (what the LLM sees), not to the browser;
  the browser gets authorize data via the SSE channel this spec wires,
  which fires independently and earlier (live, during the call).

## Edge cases

- **Gate skipped/not-run** (`mcpAuthorizeEvaluationThisRequest` falsy —
  a2a-supplied-token skip, or gate genuinely didn't run) — `splitAuthorizeEvaluation`
  returns `null`; no `mcpAuthorizeEvaluation(s)` fields added to the SSE
  payload; listener's two new `if` blocks don't fire. Matches today's
  behavior on the existing `/api/agent/invoke` path for the same skip cases.
- **Gate ran via `simulated`/`fallback_simulated` engine** — those engines
  never populate `gateEvaluation`/`secondaryEvaluation` (confirmed: only the
  live `pingone` engine's `_applyTransactionPolicy` path sets them, per PR
  #1070). `splitAuthorizeEvaluation` still returns a `singular` value (the
  simulated decision) with `plural: null` — 1 card, matching every other
  path's simulated-engine behavior.
- **Multiple tool calls in one AG-UI run** (e.g. an agent loop calling 2+
  tools) — each call publishes its own `mcp-result` SSE event with its own
  authorize data; `ingestAuthorize`/`ingestAuthorizeEvaluations` overwrite
  `trace.authorize`/`trace.authorizeEvaluations` on each call, same
  last-write-wins semantics the store already has for every other ingest
  method. Not a new race — identical to how `ingestMcpResult` already
  behaves for multi-call runs today.
- **Double-ingest with the non-AG-UI paths' own direct response-body
  ingestion** (Task 4 of PR #1070) — only relevant if a future path uses
  BOTH `callMcpTool`'s direct response AND this SSE channel for the same
  call. `ingestAuthorize`/`ingestAuthorizeEvaluations` are idempotent for
  identical data (last write wins, same value either way); not a
  correctness risk, just a redundant write in that hypothetical case. Not
  reachable by the current AG-UI code path (it uses only the SSE channel).

## Success criteria

- On `/use-cases/live` (or any AG-UI-routed chip/typed-message run), the
  Token Chain rail's "PingOne Authorize" step shows real decision detail
  (why/request/response/decision/kv), matching what the same use case shows
  on the non-AG-UI paths.
- A run that trips the Transaction/Amount policy override (PR #1070's
  scenario) shows 2 authorize cards on the AG-UI path too, not just on
  `callMcpTool`/`/api/agent/invoke`.
- Every non-AG-UI path (`callMcpTool`, `/api/agent/invoke`,
  `/api/demo-agent/nl`, attack sims) renders identically to before — this
  spec adds a new data channel, it doesn't touch how those paths already
  ingest authorize data.
- Backend: `CI=true npm test -- --forceExit` (demo_api_server) green.
- Frontend: `npm run test:unit && npm run build` (demo_api_ui) green.

## Out of scope

- Wiring `useAgentState.js`'s dead `authorizeDecisions: []` array — a
  second, unused mechanism; not needed since the SSE channel already
  reaches `tokenChainTraceStore` directly.
- `agentTool.js`'s HTTP response body — not the transport this spec uses.
- Anything about `/api/demo-agent/nl` (the third `sendAsNlInner` branch,
  used when `ff_agui_enabled` is off or no LLM provider is active) — not
  investigated; if it has the same gap, that's a separate follow-up.
- Any change to `mcpToolAuthorizationService.js` or the authorize gate's
  own logic — this spec only publishes data the gate already produces.

## Test plan

- Backend unit: `mcpSsePublisher.test.js` (extend or create) — asserts
  `publishMcpResultToSse` includes `mcpAuthorizeEvaluation`/`mcpAuthorizeEvaluations`
  in the published payload when passed, omits both when omitted.
- Backend unit: `mcpToolPipeline.js` tests — extend the existing
  `mcpToolPipeline.authorizeEvaluations.test.js` (or a sibling file) with
  cases asserting `deps.publishMcpResultToSse` is called with the correct
  `mcpAuthorizeEvaluation`/`mcpAuthorizeEvaluations` values on: (a) normal
  success with a dual decision, (b) success with a single decision, (c) the
  auth-challenge/local-fallback branch (L948), (d) the gateway-deny branches
  (L1150/L1176), (e) the remote-unreachable/local-fallback branch (L1320),
  (f) confirm the L272 exchange-failure branch's `publishMcpResultToSse`
  call is NOT passed either field (still 5-arg shape as today).
- Frontend unit: `tokenChainTraceStore.test.js` — dispatch a
  `mcp-tool-result-sse` window event with `detail.mcpAuthorizeEvaluation`/
  `.mcpAuthorizeEvaluations` present, assert `trace.authorize`/
  `trace.authorizeEvaluations` populated; dispatch one without those fields,
  assert no change (back-compat with existing non-AG-UI dispatchers of this
  event).
- Manual/live: run a chip on `/use-cases/live` with AG-UI enabled (default),
  confirm the Token Chain authorize step now shows detail; run the $2500
  transfer scenario via this path, confirm 2 cards.
