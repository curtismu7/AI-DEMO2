# AG-UI Authorize Trace Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the AG-UI streaming pipeline (default-on, used by `/use-cases/live` chip runs and any typed message when an LLM provider is active), the Token Chain rail's "PingOne Authorize" step currently shows no detail at all — this plan wires the authorize decision(s) the pipeline already computes onto the SSE channel the AG-UI path already uses, so the same detail every other path already shows appears there too.

**Architecture:** `mcpToolPipeline.js` already computes the authorize decision (singular, and — after PR #1070 — an optional plural array) and already calls `deps.publishMcpResultToSse(...)` on every reachable post-gate branch to push live tool-result data over a `flowTraceId`-keyed SSE channel the AG-UI hook (`useAgentRun.js`) already subscribes to. This plan threads the already-computed authorize data through that existing call, and extends the existing frontend listener (`tokenChainTraceStore.js`) to ingest it — no new channel, no new event type.

**Tech Stack:** `demo_api_server` (Node, CommonJS, Jest + supertest); `demo_api_ui` (React, Vite, Vitest — not Jest).

## Global Constraints

- Node >= 22. `demo_api_server` is CommonJS (`require`), Jest 29.7 + supertest. `demo_api_ui` is Vitest 3.2 (jsdom) — **not** Jest; imports use ESM `import`.
- Backend verify: `CI=true npm test -- --forceExit` (mandatory `CI=true`).
- Frontend verify: `npm run test:unit && npm run build`.
- Work happens on branch `worktree-agui-authorize-trace-wiring` (based on PR #1070's branch `worktree-token-chain-dynamic-authorize-cards`) inside `.claude/worktrees/agui-authorize-trace-wiring/` — stage explicitly (`git add <files>`), never `git add -A`. Running the backend jest suite regenerates `demo_api_server/data/**` fixtures as a side effect — `git status --short` before staging, and `git checkout -- demo_api_server/data && git clean -f demo_api_server/data/step-verification/` to discard any of that pollution before committing.
- This branch depends on PR #1070's `gateEvaluation`/`secondaryEvaluation` fields and `secondaryEvaluationEngine()` helper already existing in `mcpToolPipeline.js` and `mcpToolAuthorizationService.js` — confirmed present on this branch's base commit.
- The exact call site this plan must NOT touch: `mcpToolPipeline.js`'s `publishMcpResultToSse` call inside the token-exchange-failure local-fallback branch (currently ~L272) — it runs before `mcpAuthorizeEvaluationThisRequest` is even declared; referencing the variable there is a TDZ error, and there is no authorize decision to report on that bypass path.

---

### Task 1: `mcpSsePublisher.js` accepts optional authorize evaluation fields

**Files:**

- Modify: `demo_api_server/services/mcpSsePublisher.js` (whole file, currently 42 lines)
- Test: Create `demo_api_server/tests/mcpSsePublisher.test.js`

**Interfaces:**

- Produces: `publishMcpResultToSse(flowTraceId, opts)` gains two new optional keys on `opts`: `mcpAuthorizeEvaluation` (object) and `mcpAuthorizeEvaluations` (array). When present, they appear verbatim on the published SSE payload (the object passed to `mcpFlowSseHub.publish`) under the same key names. When absent/falsy, the payload is byte-identical to today (neither key present).
- Consumed by: Task 2 (`mcpToolPipeline.js` passes these two new opts at 5 call sites).

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/mcpSsePublisher.test.js`:

```js
'use strict';

jest.mock('../services/mcpFlowSseHub', () => ({ publish: jest.fn() }));

const mcpFlowSseHub = require('../services/mcpFlowSseHub');
const { publishMcpResultToSse } = require('../services/mcpSsePublisher');

describe('publishMcpResultToSse — authorize evaluation fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('includes mcpAuthorizeEvaluation and mcpAuthorizeEvaluations when passed', () => {
    const evaluation = { decision: 'PERMIT', decisionId: 'gate-1' };
    const evaluations = [
      { decision: 'PERMIT', decisionId: 'gate-1', engine: 'pingone', decisionContext: 'McpFirstTool' },
      { decision: 'DENY', decisionId: 'limit-1', engine: 'pingone', decisionContext: 'TransactionAmount' },
    ];
    publishMcpResultToSse('trace-1', {
      tool: 'create_transfer', result: { content: [] }, durationMs: 42, isDelegated: true,
      requestJson: { amount: 2500 },
      mcpAuthorizeEvaluation: evaluation,
      mcpAuthorizeEvaluations: evaluations,
    });
    expect(mcpFlowSseHub.publish).toHaveBeenCalledTimes(1);
    const [traceId, payload] = mcpFlowSseHub.publish.mock.calls[0];
    expect(traceId).toBe('trace-1');
    expect(payload.mcpAuthorizeEvaluation).toEqual(evaluation);
    expect(payload.mcpAuthorizeEvaluations).toEqual(evaluations);
  });

  it('omits both fields when neither is passed (existing callers unaffected)', () => {
    publishMcpResultToSse('trace-2', {
      tool: 'get_my_accounts', result: { content: [] }, durationMs: 10, isDelegated: false,
      requestJson: {},
    });
    const [, payload] = mcpFlowSseHub.publish.mock.calls[0];
    expect(payload).not.toHaveProperty('mcpAuthorizeEvaluation');
    expect(payload).not.toHaveProperty('mcpAuthorizeEvaluations');
  });

  it('omits mcpAuthorizeEvaluations when only the singular field is passed (single-decision case)', () => {
    publishMcpResultToSse('trace-3', {
      tool: 'get_my_accounts', result: { content: [] }, durationMs: 10, isDelegated: false,
      requestJson: {},
      mcpAuthorizeEvaluation: { decision: 'PERMIT', decisionId: 'd1' },
    });
    const [, payload] = mcpFlowSseHub.publish.mock.calls[0];
    expect(payload.mcpAuthorizeEvaluation).toEqual({ decision: 'PERMIT', decisionId: 'd1' });
    expect(payload).not.toHaveProperty('mcpAuthorizeEvaluations');
  });

  it('still no-ops when flowTraceId is falsy, even with authorize fields passed', () => {
    publishMcpResultToSse(null, {
      tool: 'get_my_accounts', result: {}, durationMs: 1, isDelegated: false,
      mcpAuthorizeEvaluation: { decision: 'PERMIT' },
    });
    expect(mcpFlowSseHub.publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/mcpSsePublisher.test.js`
Expected: FAIL — the first 3 assertions on `payload.mcpAuthorizeEvaluation(s)` fail because today's `publishMcpResultToSse` ignores those opts entirely.

- [ ] **Step 3: Implement**

Replace the full contents of `demo_api_server/services/mcpSsePublisher.js`:

```js
// demo_api_server/services/mcpSsePublisher.js
'use strict';

const mcpFlowSseHub = require('./mcpFlowSseHub');
const { buildSsePayload } = require('./sseCorrelation');

/**
 * Publish an MCP tool result to the SSE hub so the Token Chain MCP Results
 * tab updates in real-time without waiting for the 15-second poll cycle.
 * Shape matches the mcpToolCallsChain entries from getMCPToolCalls().
 *
 * @param {string} flowTraceId
 * @param {object} opts
 * @param {string}  opts.tool
 * @param {object}  opts.result     raw MCP result (content[], isError, _meta)
 * @param {number}  opts.durationMs
 * @param {boolean} opts.isDelegated
 * @param {object}  [opts.requestJson]  original tool params (pre-HITL-strip snapshot)
 * @param {object}  [opts.mcpAuthorizeEvaluation] singular authorize decision, when the
 *   gate ran on this call — same shape callMcpTool's response body already carries.
 * @param {object[]} [opts.mcpAuthorizeEvaluations] ordered [gate, secondary] pair, only
 *   present when a Transaction/Amount policy decision also fired (PR #1070).
 */
function publishMcpResultToSse(flowTraceId, {
  tool, result, durationMs, isDelegated, requestJson, denied,
  mcpAuthorizeEvaluation, mcpAuthorizeEvaluations,
}) {
  if (!flowTraceId) return;
  const success = !denied && result && !result.isError && !result.error;
  const toolResultJson = result?.content
    ? result.content.slice(0, 10)          // cap size for SSE payload
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

module.exports = { publishMcpResultToSse };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/mcpSsePublisher.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/mcpSsePublisher.js demo_api_server/tests/mcpSsePublisher.test.js
git commit -m "feat(agui): publishMcpResultToSse accepts optional authorize evaluation fields"
```

---

### Task 2: `mcpToolPipeline.js` publishes the authorize evaluation on every reachable post-gate call site

**Files:**

- Modify: `demo_api_server/services/mcpToolPipeline.js` — add helper near L26; refactor L1010-1025; extend 5 call sites (~L924, ~L948, ~L1150, ~L1176, ~L1320 — exact line numbers may drift slightly from Task 1's diff landing above them in git history terms, but not in this file; locate by the surrounding code shown below, not by line number alone)
- Test: `demo_api_server/src/__tests__/mcpToolPipeline.authorizeEvaluations.test.js` (existing file from PR #1070 — extend it)

**Interfaces:**

- Consumes: `mcpAuthorizeEvaluationThisRequest` (existing variable, `let`-declared at L330, assigned once the authorize gate section completes — either a real evaluation with optional `gateEvaluation`/`secondaryEvaluation`, or a skip-shape `{ran:false, skipped:true, skipReason}` object, or left `undefined` if that line is never reached).
- Consumes: `secondaryEvaluationEngine(secondaryEvaluation)` (existing helper at L26, from PR #1070's final-review fix wave) — reused, not reimplemented.
- Produces: a new local helper `splitAuthorizeEvaluation(v)` returning `null` (nothing to report) or `{ singular, plural }` where `plural` is `null` unless both `gateEvaluation` and `secondaryEvaluation` were present on `v`.
- Consumed by: Task 1's `publishMcpResultToSse` (`mcpAuthorizeEvaluation`/`mcpAuthorizeEvaluations` opts).

- [ ] **Step 1: Write the failing tests**

Read the existing file `demo_api_server/src/__tests__/mcpToolPipeline.authorizeEvaluations.test.js` first — it already has a `baseDeps(overrides)` helper factory from PR #1070's Task 2. Reuse that exact factory (do not redefine it) and append these new tests to the same `describe` block, or a new sibling `describe` in the same file:

```js
describe('runMcpToolPipeline — publishMcpResultToSse carries the authorize evaluation', () => {
  test('normal remote success: publishMcpResultToSse receives both fields on a dual decision', async () => {
    const publishMcpResultToSse = jest.fn();
    const deps = baseDeps({
      publishMcpResultToSse,
      evaluateMcpFirstToolGate: async () => ({
        ran: true,
        permit: true,
        evaluation: {
          decision: 'PERMIT', decisionId: 'limit-2', decisionContext: 'McpFirstTool',
          gateEvaluation: { decision: 'PERMIT', decisionId: 'gate-1', raw: null, request: null, response: null },
          secondaryEvaluation: { source: 'transaction-policy', decision: 'STEP_UP', decisionId: 'limit-2', raw: null },
        },
      }),
      mcpCallTool: async () => ({ content: [{ text: 'ok' }] }),
    });
    await runMcpToolPipeline({
      tool: 'create_transfer', params: { amount: 600 }, flowTraceId: 'ft-1', startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(publishMcpResultToSse).toHaveBeenCalled();
    const call = publishMcpResultToSse.mock.calls.find((c) => c[0] === 'ft-1');
    expect(call[1].mcpAuthorizeEvaluation).toMatchObject({ decision: 'PERMIT', decisionId: 'gate-1' });
    expect(call[1].mcpAuthorizeEvaluations).toEqual([
      { decision: 'PERMIT', decisionId: 'gate-1', raw: null, request: null, response: null, engine: 'pingone', decisionContext: 'McpFirstTool' },
      { source: 'transaction-policy', decision: 'STEP_UP', decisionId: 'limit-2', raw: null, engine: 'pingone', decisionContext: 'TransactionAmount' },
    ]);
  });

  test('normal remote success: single decision (no secondary) → mcpAuthorizeEvaluations omitted', async () => {
    const publishMcpResultToSse = jest.fn();
    const deps = baseDeps({
      publishMcpResultToSse,
      evaluateMcpFirstToolGate: async () => ({
        ran: true, permit: true,
        evaluation: { decision: 'PERMIT', decisionId: 'd1', decisionContext: 'McpFirstTool' },
      }),
      mcpCallTool: async () => ({ content: [{ text: 'ok' }] }),
    });
    await runMcpToolPipeline({
      tool: 'get_my_accounts', params: {}, flowTraceId: 'ft-2', startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    const call = publishMcpResultToSse.mock.calls.find((c) => c[0] === 'ft-2');
    expect(call[1].mcpAuthorizeEvaluation).toMatchObject({ decision: 'PERMIT', decisionId: 'd1' });
    expect(call[1]).not.toHaveProperty('mcpAuthorizeEvaluations');
  });

  test('exchange-failure local fallback (pre-gate branch): publishMcpResultToSse gets NEITHER field', async () => {
    const publishMcpResultToSse = jest.fn();
    process.env.FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE = 'true';
    try {
      const deps = baseDeps({
        publishMcpResultToSse,
        resolveMcpAccessTokenWithEvents: async () => {
          const err = new Error('exchange failed');
          err.httpStatus = 400;
          err.code = 'token_exchange_failed';
          err.tokenEvents = [];
          throw err;
        },
        callToolLocal: async () => ({ result: 'local-ok' }),
      });
      await runMcpToolPipeline({
        tool: 'get_my_accounts', params: {}, flowTraceId: 'ft-3', startTime: Date.now(),
        req: { session: { user: { id: '1', oauthId: 'u1' } } }, deps,
      });
      const call = publishMcpResultToSse.mock.calls.find((c) => c[0] === 'ft-3');
      expect(call).toBeDefined();
      expect(call[1]).not.toHaveProperty('mcpAuthorizeEvaluation');
      expect(call[1]).not.toHaveProperty('mcpAuthorizeEvaluations');
    } finally {
      delete process.env.FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE;
    }
  });
});
```

If `baseDeps` in the existing file does not already stub `callToolLocal`/`resolveMcpAccessTokenWithEvents`/other deps this third test needs, add the minimal missing stub keys directly in that test's `baseDeps({...})` override argument — do not modify `baseDeps` itself unless a key is missing entirely from its defaults (check the file first).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/mcpToolPipeline.authorizeEvaluations.test.js`
Expected: FAIL — the 2 new `publishMcpResultToSse` assertions find `undefined`/missing properties (today's calls never pass these fields). The third test (exchange-failure) should already PASS as written (nothing to fix there) — it exists to pin the "must stay excluded" behavior before the refactor, not to drive new code.

- [ ] **Step 3: Implement**

Add the helper immediately after `secondaryEvaluationEngine` (currently ends around L31, right before the block comment for `runMcpToolPipeline` or wherever the next top-level declaration begins — insert directly below `secondaryEvaluationEngine`'s closing brace):

```js
/**
 * Split the gate's merged evaluation (mcpAuthorizeEvaluationThisRequest) into
 * the singular field shape every existing consumer reads, plus, when a
 * Transaction/Amount secondary decision fired, the ordered plural array
 * (gate first, secondary second) buildTraceSteps renders as 2 Token Chain
 * cards. Returns null when there's nothing to report (gate skipped/not-run
 * — the input is falsy).
 * @param {object|null|undefined} v
 * @returns {{singular: object, plural: object[]|null}|null}
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

Replace the main success-path `out` assembly (currently L1010-1025):

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

At each of these 5 call sites, insert `const _authEval = splitAuthorizeEvaluation(mcpAuthorizeEvaluationThisRequest);` on the line immediately before the `deps.publishMcpResultToSse(...)` call, and add `mcpAuthorizeEvaluation: _authEval?.singular || null, mcpAuthorizeEvaluations: _authEval?.plural || null,` to that call's options object. Locate each by its surrounding code (line numbers may have drifted slightly):

1. Normal remote-tool-call success:

   ```js
   const _authEval = splitAuthorizeEvaluation(mcpAuthorizeEvaluationThisRequest);
   deps.publishMcpResultToSse(flowTraceId, {
       tool, result, durationMs: _durationMs, isDelegated: !!mcpAccessToken, requestJson,
       mcpAuthorizeEvaluation: _authEval?.singular || null,
       mcpAuthorizeEvaluations: _authEval?.plural || null,
   });
   ```

2. MCP-server auth-challenge → local fallback (inside `if (hasAuthChallenge)`):

   ```js
   const _authEval = splitAuthorizeEvaluation(mcpAuthorizeEvaluationThisRequest);
   deps.publishMcpResultToSse(flowTraceId, {
       tool, result: localResult, durationMs: _acDuration, isDelegated: false, requestJson,
       mcpAuthorizeEvaluation: _authEval?.singular || null,
       mcpAuthorizeEvaluations: _authEval?.plural || null,
   });
   ```

3. Gateway HITL-required 428 (inside the `try { ... } catch (_) { /* SSE best-effort */ }` block):

   ```js
   const _authEval = splitAuthorizeEvaluation(mcpAuthorizeEvaluationThisRequest);
   deps.publishMcpResultToSse(flowTraceId, {
       tool,
       result: { error: 'hitl_required', message: hitlBody.message },
       durationMs: Date.now() - startTime,
       isDelegated: !!mcpAccessToken,
       requestJson,
       denied: true,
       mcpAuthorizeEvaluation: _authEval?.singular || null,
       mcpAuthorizeEvaluations: _authEval?.plural || null,
   });
   ```

4. Gateway generic deny 403 (inside its own `try { ... }` block):

   ```js
   const _authEval = splitAuthorizeEvaluation(mcpAuthorizeEvaluationThisRequest);
   deps.publishMcpResultToSse(flowTraceId, {
       tool,
       result: {
           error: denyBody.error,
           gatewayErrorCode: denyBody.gatewayErrorCode,
           message: denyBody.message,
       },
       durationMs: Date.now() - startTime,
       isDelegated: !!mcpAccessToken,
       mcpAuthorizeEvaluation: _authEval?.singular || null,
       mcpAuthorizeEvaluations: _authEval?.plural || null,
       // (leave every other existing key in this call — e.g. requestJson, denied — untouched)
   });
   ```

5. MCP-server-unreachable → local fallback:

   ```js
   const _authEval = splitAuthorizeEvaluation(mcpAuthorizeEvaluationThisRequest);
   deps.publishMcpResultToSse(flowTraceId, {
       tool, result, durationMs: _rfDuration, isDelegated: false, requestJson,
       mcpAuthorizeEvaluation: _authEval?.singular || null,
       mcpAuthorizeEvaluations: _authEval?.plural || null,
   });
   ```

Do **not** touch the token-exchange-failure local-fallback branch's `publishMcpResultToSse` call (the one inside the `if (localFallbackApplies && localFallbackOnExchangeFailure)` block, which runs before `mcpAuthorizeEvaluationThisRequest` is declared) — leave it exactly as it is today, 5-key call with no authorize fields.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/mcpToolPipeline.authorizeEvaluations.test.js`
Expected: PASS, all tests in the file green (the 3 new tests plus every pre-existing test from PR #1070).

Also run the pinned characterization + useCaseId suites to confirm zero drift on the pre-existing `publishMcpResultToSse` calls' other fields:
Run: `cd demo_api_server && CI=true npx jest src/__tests__/mcpToolPipeline.characterization.test.js src/__tests__/mcpToolPipelineUseCaseId.test.js`
Expected: PASS, unchanged.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/mcpToolPipeline.js demo_api_server/src/__tests__/mcpToolPipeline.authorizeEvaluations.test.js
git commit -m "feat(agui): publish authorize evaluation on every post-gate SSE tool-result event"
```

---

### Task 3: `tokenChainTraceStore.js` ingests the authorize evaluation from the SSE window event

**Files:**

- Modify: `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js:184-188` (the passive `mcp-tool-result-sse` window listener)
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`

**Interfaces:**

- Consumes: `tokenChainTraceStore.ingestAuthorize` (existing) and `tokenChainTraceStore.ingestAuthorizeEvaluations` (existing, from PR #1070) — both already exported on the same store object this listener already calls `ingestMcpResult` on.
- Produces: no new public interface — purely extends existing passive wiring.

- [ ] **Step 1: Write the failing test**

Append to `demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`:

```js
test("mcp-tool-result-sse window event ingests a singular authorize evaluation", () => {
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: {
      type: "mcp-result", tool: "get_my_accounts",
      mcpAuthorizeEvaluation: { decision: "PERMIT", decisionId: "gate-1" },
    },
  }));
  expect(tokenChainTraceStore.getState().trace.authorize).toEqual({ decision: "PERMIT", decisionId: "gate-1" });
});

test("mcp-tool-result-sse window event ingests a plural authorize evaluations array", () => {
  const evaluations = [
    { decision: "PERMIT", decisionId: "gate-1", decisionContext: "McpFirstTool" },
    { decision: "DENY", decisionId: "limit-1", decisionContext: "TransactionAmount" },
  ];
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: { type: "mcp-result", tool: "create_transfer", mcpAuthorizeEvaluations: evaluations },
  }));
  expect(tokenChainTraceStore.getState().trace.authorizeEvaluations).toEqual(evaluations);
});

test("mcp-tool-result-sse window event without authorize fields does not touch trace.authorize", () => {
  tokenChainTraceStore.ingestAuthorize({ decision: "DENY", decisionId: "prior" });
  window.dispatchEvent(new CustomEvent("mcp-tool-result-sse", {
    detail: { type: "mcp-result", tool: "get_my_accounts" },
  }));
  expect(tokenChainTraceStore.getState().trace.authorize).toEqual({ decision: "DENY", decisionId: "prior" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`
Expected: FAIL — the first two new tests find `trace.authorize`/`trace.authorizeEvaluations` still `null` (today's listener only calls `ingestMcpResult`).

- [ ] **Step 3: Implement**

Replace the passive window listener at the end of `tokenChainTraceStore.js` (currently L184-188):

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`
Expected: PASS, all tests in the file green (including pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js
git commit -m "feat(agui): tokenChainTraceStore ingests authorize evaluations from the SSE mcp-result event"
```

---

### Task 4: Full verification and manual live replay

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Run the full backend suite**

Run: `cd demo_api_server && CI=true npm test -- --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='/tests/real/' --forceExit`
Expected: PASS, no new failures beyond whatever pre-existing environmental failures were already documented on the base branch (PR #1070's own final verification found 10-11 pre-existing, unrelated, credential/network-dependent failures — cross-check any failure here against that same list via `git diff --stat main...HEAD` to confirm it's not in a file this plan touches).

After the run, restore any regenerated data fixtures before staging anything else:
```bash
git checkout -- demo_api_server/data
git clean -f demo_api_server/data/step-verification/
```

- [ ] **Step 2: Run the full frontend suite + build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: PASS, 0 failures; build completes with no errors.

- [ ] **Step 3: Manual live replay**

With the demo stack running (`local.ping-devops.com:4000`), `ff_agui_enabled` at its default (`true`), and a live LLM provider active: go to `/use-cases/live`, run any chip. Open the Token Chain rail.

Expected: the "PingOne Authorize" step now shows real detail (why/request/response/decision/kv) — not blank/pending — matching what the same use case already shows on non-AG-UI paths.

- [ ] **Step 4: Manual live replay — dual-decision case**

Run the $2500 `create_transfer` scenario (or equivalent Transaction/Amount-policy-triggering use case) via the AG-UI path (`/use-cases/live` or a typed chat message with AG-UI active).

Expected: 2 "PingOne Authorize" cards appear, matching PR #1070's behavior on the non-AG-UI paths.

- [ ] **Step 5: Manual replay — non-AG-UI paths unaffected**

Run a use case through a non-AG-UI path (e.g. a direct client-dispatched action, or with `ff_agui_enabled` toggled off if that's reachable in this environment).

Expected: identical rendering to before this plan — no double-cards, no duplicate/conflicting authorize data.

- [ ] **Step 6: Report status**

State ✅ or ❌ for each of: backend suite, frontend suite + build, live single-decision AG-UI replay, live dual-decision AG-UI replay, live non-AG-UI-path regression check — per the root `CLAUDE.md` "Before claiming done" gate. Do not mark this plan complete without evidence for all five.
