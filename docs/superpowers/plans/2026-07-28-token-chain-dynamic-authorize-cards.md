# Token Chain — Dynamic Authorize Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When PingOne Authorize makes two decisions on one tool call (the McpFirstTool gate, then the Transaction/Amount policy that can override it), the Token Chain rail shows two "PingOne Authorize" cards in execution order instead of collapsing to one — so the visible card always matches the outcome the user sees in chat.

**Architecture:** Backend stops discarding the gate's decision when the Transaction/Amount policy overrides it (`mcpToolAuthorizationService.js`), surfaces both as an additive `mcpAuthorizeEvaluations` array on the wire only when a second decision actually happened (`mcpToolPipeline.js`), and the frontend's `authorize` step in `buildTraceSteps.js` renders one card per array entry instead of one card total. Every other Token Chain step, and the existing singular `mcpAuthorizeEvaluation` field everything else already reads, is untouched.

**Tech Stack:** `demo_api_server` (Node, CommonJS, Jest + supertest); `demo_api_ui` (React, Vite, Vitest — not Jest).

**Design refinements found while grounding this plan against the real source (not in the original spec, both are strict narrowings/simplifications, not scope changes):**

- `gateEvaluation` also carries `request`/`response` (sourced from the gate's own `_debug`), not just `decision`/`decisionId`/`raw`. Reading the code traced the ORIGINAL bug precisely: today, `_applyTransactionPolicy`'s override spreads `...r` (so `r._debug` survives untouched — still the gate's own request/response) while only `r.raw` gets replaced with the transaction policy's raw. `mapLivePingOneResult`'s singular-field construction then does `r._debug?.response || r.raw` — `_debug.response` wins, so the singular field's "raw response" was always the stale GATE payload even when `decision` said DENY. That's exactly what the original screenshot showed (PERMIT JSON, DENY outcome). This plan's `gateEvaluation`/`secondaryEvaluation` objects are built explicitly, bypassing that leak, so both new cards show their OWN correct data regardless of the pre-existing `_debug` quirk (which is left alone — fixing it for the singular field is out of scope, see spec).
- `buildRunStory` needs **no change**. The spec called for switching its `id === 'authorize'` lookup to a `baseId`-based pick with DENY-over-PERMIT precedence. Tracing the function found `errStep` (any step with `status === 'error'`) always wins the headline branch before the `decision` variable is ever read, and a DENY-decision card always renders with `status: 'error'` — so that precedence is unreachable dead code. Since `id: "authorize"` stays assigned to the first/primary card either way (single- or multi-decision), the existing `list.find(s => s.id === 'authorize')` already resolves correctly with zero changes. Flagged to the user; not silently dropped.

## Global Constraints

- Node >= 22. `demo_api_server` is CommonJS (`require`), Jest 29.7 + supertest. `demo_api_ui` is Vitest 3.2 (jsdom) — **not** Jest; imports use ESM `import`.
- Backend verify: `CI=true npm test -- --forceExit` (mandatory `CI=true` — without it supertest suites flake).
- Frontend verify: `npm run test:unit && npm run build` (the build is the real gate — a green test run alone is not enough).
- Work happens on branch `worktree-token-chain-dynamic-authorize-cards` inside `.claude/worktrees/token-chain-dynamic-authorize-cards/` — stage explicitly (`git add <files>`), never `git add -A`.
- No new UI copy uses emoji (plain text labels only, per the emoji allowlist rule).
- Existing singular fields (`mcpAuthorizeEvaluation`, `trace.authorize`) must not change shape or meaning anywhere in this plan — every new field is strictly additive.

---

### Task 1: Preserve both decisions in `mcpToolAuthorizationService.js`

**Files:**

- Modify: `demo_api_server/services/mcpToolAuthorizationService.js:300-449` (`_localAmountLimitFallback`, `_applyTransactionPolicy`) and `:919-1043` (`mapLivePingOneResult`, the closure inside `evaluateMcpFirstToolGate`)
- Test: `demo_api_server/src/__tests__/mcpToolAuthorizationService.test.js`

**Interfaces:**

- Produces: `_applyTransactionPolicy(r, opts)` return value gains two optional keys when an override happens: `gateEvaluation: { decision, decisionId, raw, request, response }` (the gate's OWN pre-override decision) and `secondaryEvaluation: { source: 'transaction-policy'|'transaction-policy-fallback', decision: 'DENY'|'STEP_UP'|'HITL_REQUIRED', decisionId, raw }`. Neither key is present when no override happened (bare PERMIT from the transaction consult, or the gate already denied and short-circuited).
- Produces: `mapLivePingOneResult`'s `block.body` (DENY/step-up/hitl-receipt-rejected/hitl-required branches) and `evaluation` (permit branch) both gain `gateEvaluation`/`secondaryEvaluation` keys, threaded straight through from `r`.
- Consumed by: Task 2 (`mcpToolPipeline.js` reads `mcpAuthz.block.body.gateEvaluation`/`.secondaryEvaluation` and `mcpAuthz.evaluation.gateEvaluation`/`.secondaryEvaluation`).

- [ ] **Step 1: Write the failing tests**

Add `_applyTransactionPolicy` to the existing require destructure at the top of the test file:

```js
const {
  evaluateMcpFirstToolGate,
  getMcpFirstToolGateStatus,
  nestedActIdFromClaim,
  _applyTransactionPolicy,
} = require('../../services/mcpToolAuthorizationService');
```

Insert a new `describe` block immediately after the `describe('transaction-limit policy consult', ...)` block closes (right after its closing `});`, before the `it('fails CLOSED (503)...')` test that follows it):

```js
    describe('_applyTransactionPolicy — preserves gate + secondary decisions', () => {
      const GATE_PERMIT_HITL = {
        decision: 'PERMIT', hitlRequired: true, decisionId: 'gate-1',
        raw: { decision: 'PERMIT' },
        _debug: { request: { method: 'POST', url: 'https://example/mcp' }, response: { decision: 'PERMIT' } },
      };

      it('DENY override carries both gateEvaluation and secondaryEvaluation', async () => {
        pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({
          decision: 'DENY', decisionId: 'limit-1', raw: { decision: 'DENY', reason: 'amount over limit' },
        });
        const r = await _applyTransactionPolicy({ ...GATE_PERMIT_HITL }, {
          amount: 2500, transactionType: 'transfer', userId: 'u1', acr: null,
        });
        expect(r.decision).toBe('DENY'); // existing merged behavior unchanged
        expect(r.gateEvaluation).toEqual({
          decision: 'PERMIT', decisionId: 'gate-1', raw: { decision: 'PERMIT' },
          request: { method: 'POST', url: 'https://example/mcp' }, response: { decision: 'PERMIT' },
        });
        expect(r.secondaryEvaluation).toEqual({
          source: 'transaction-policy', decision: 'DENY', decisionId: 'limit-1',
          raw: { decision: 'DENY', reason: 'amount over limit' },
        });
      });

      it('step-up override carries both evaluations', async () => {
        pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({
          decision: 'PERMIT', stepUpRequired: true, decisionId: 'limit-2',
        });
        const r = await _applyTransactionPolicy({ ...GATE_PERMIT_HITL }, {
          amount: 600, transactionType: 'transfer', userId: 'u1', acr: null,
        });
        expect(r.stepUpRequired).toBe(true);
        expect(r.gateEvaluation.decisionId).toBe('gate-1');
        expect(r.secondaryEvaluation).toEqual({
          source: 'transaction-policy', decision: 'STEP_UP', decisionId: 'limit-2', raw: null,
        });
      });

      it('promoted HITL/consent override carries both evaluations', async () => {
        pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({
          decision: 'PERMIT', consentRequired: true, decisionId: 'limit-3',
        });
        const r = await _applyTransactionPolicy(
          { decision: 'PERMIT', hitlRequired: false, decisionId: 'gate-2' },
          { amount: 300, transactionType: 'transfer', userId: 'u1', acr: null },
        );
        expect(r.hitlRequired).toBe(true);
        expect(r.secondaryEvaluation).toEqual({
          source: 'transaction-policy', decision: 'HITL_REQUIRED', decisionId: 'limit-3', raw: null,
        });
      });

      it('bare PERMIT from the transaction consult attaches neither field', async () => {
        pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({ decision: 'PERMIT' });
        const r = await _applyTransactionPolicy({ ...GATE_PERMIT_HITL }, {
          amount: 300, transactionType: 'transfer', userId: 'u1', acr: null,
        });
        expect(r.secondaryEvaluation).toBeUndefined();
        expect(r.gateEvaluation).toBeUndefined();
      });

      it('gate already DENY short-circuits before the consult — neither field attached', async () => {
        const r = await _applyTransactionPolicy(
          { decision: 'DENY', decisionId: 'gate-deny' },
          { amount: 2500, transactionType: 'transfer', userId: 'u1', acr: null },
        );
        expect(pingOneAuthorizeService.evaluateTransaction).not.toHaveBeenCalled();
        expect(r.secondaryEvaluation).toBeUndefined();
      });

      it('local-amount-fallback DENY (transaction consult errors) also attaches both evaluations', async () => {
        pingOneAuthorizeService.evaluateTransaction.mockRejectedValue(new Error('p1az down'));
        const r = await _applyTransactionPolicy({ ...GATE_PERMIT_HITL }, {
          amount: 2500, transactionType: 'transfer', userId: 'u1', acr: null,
        });
        expect(r.decision).toBe('DENY');
        expect(r.gateEvaluation.decisionId).toBe('gate-1');
        expect(r.secondaryEvaluation).toMatchObject({ source: 'transaction-policy-fallback', decision: 'DENY' });
      });
    });
```

Also extend the EXISTING test `'a transaction-policy DENY overrides the gate PERMIT+HITL'` (do not remove its current assertions — add these two after the existing `expect(r.block.body.decisionContext).toBe('McpFirstTool');` line):

```js
        expect(r.block.body.gateEvaluation).toEqual({
          decision: 'PERMIT', decisionId: 'gate-1',
          raw: { decision: 'PERMIT', statements: [{ code: 'HITL' }, { code: 'mcp-tool-authorized' }] },
          request: { method: 'POST', url: 'https://example/mcp' },
          response: { decision: 'PERMIT', statements: [{ code: 'HITL' }, { code: 'mcp-tool-authorized' }] },
        });
        expect(r.block.body.secondaryEvaluation).toEqual({
          source: 'transaction-policy', decision: 'DENY', decisionId: 'limit-1',
          raw: { decision: 'DENY', reason: 'amount over limit', statements: [] },
        });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/mcpToolAuthorizationService.test.js`
Expected: FAIL — `_applyTransactionPolicy is not a function` (not yet destructured/exported for this use) or the new `gateEvaluation`/`secondaryEvaluation` assertions fail as `undefined`.

- [ ] **Step 3: Implement — add the helper and thread it through every override branch**

Insert this helper immediately before `_localAmountLimitFallback` (currently starts at line 300):

```js
/**
 * Attach the gate's own (pre-override) decision plus the override source's
 * decision onto a Transaction/local-fallback override result, so the Token
 * Chain can render both instead of only the merged/overridden object. Only
 * called from override branches — a bare-PERMIT / no-override return stays
 * unchanged and carries neither key.
 * @param {object} overridden - the return value with fields already overridden
 * @param {object} gateR - the ORIGINAL r, before this override. This file
 *   never mutates r in place (only spreads it), so gateR is still the gate's
 *   own decision at every call site below.
 * @param {{source: string, decision: string, decisionId?: string|null, raw?: object|null}} secondary
 * @returns {object}
 */
function withGateAndSecondaryEvaluation(overridden, gateR, secondary) {
  return {
    ...overridden,
    gateEvaluation: {
      decision: gateR.decision,
      decisionId: gateR.decisionId || null,
      raw: gateR.raw || null,
      request: gateR._debug?.request || null,
      response: gateR._debug?.response || gateR.raw || null,
    },
    secondaryEvaluation: secondary,
  };
}
```

Replace `_localAmountLimitFallback` (lines 300-338) with:

```js
function _localAmountLimitFallback(r, { amount, acr }) {
  const denyAmount = simulatedAuthorizeService.getDenyAmountUsd();
  const stepUpAmount = simulatedAuthorizeService.getStepUpAmountUsd();
  const confirmAmount = simulatedAuthorizeService.getConfirmAmountUsd();
  const acrStrong = typeof acr === 'string'
    && /multi.?factor|mfa|aal2|Multi_Factor/i.test(acr);

  if (amount > denyAmount) {
    return withGateAndSecondaryEvaluation({
      ...r,
      decision: 'DENY',
      transactionPolicyDenied: true,
      transactionPolicyFallback: true,
      raw: {
        ...(r.raw || {}),
        decision: 'DENY',
        reason: `Local amount fallback DENY: $${amount} exceeds deny limit $${denyAmount} (Transaction endpoint unavailable).`,
        engine: 'local-amount-fallback',
      },
    }, r, {
      source: 'transaction-policy-fallback', decision: 'DENY', decisionId: null,
      raw: { engine: 'local-amount-fallback', reason: `$${amount} exceeds deny limit $${denyAmount}` },
    });
  }
  if (amount >= stepUpAmount && !acrStrong) {
    return withGateAndSecondaryEvaluation({
      ...r,
      stepUpRequired: true,
      transactionPolicyStepUp: true,
      transactionPolicyFallback: true,
    }, r, {
      source: 'transaction-policy-fallback', decision: 'STEP_UP', decisionId: null,
      raw: { engine: 'local-amount-fallback', reason: `$${amount} at/above step-up limit $${stepUpAmount}` },
    });
  }
  if (amount >= confirmAmount && !acrStrong) {
    return withGateAndSecondaryEvaluation({
      ...r,
      hitlRequired: true,
      transactionPolicyHitl: true,
      transactionPolicyFallback: true,
    }, r, {
      source: 'transaction-policy-fallback', decision: 'HITL_REQUIRED', decisionId: null,
      raw: { engine: 'local-amount-fallback', reason: `$${amount} at/above confirm limit $${confirmAmount}` },
    });
  }
  return r;
}
```

In `_applyTransactionPolicy` (lines 367-449), replace the three `try` overrides and the `catch` block's `forceStepUp` return:

```js
    if (t && t.decision === 'DENY') {
      return withGateAndSecondaryEvaluation({
        ...r,
        decision: 'DENY',
        decisionId: t.decisionId || r.decisionId,
        raw: t.raw || r.raw,
        transactionPolicyDenied: true,
      }, r, { source: 'transaction-policy', decision: 'DENY', decisionId: t.decisionId || null, raw: t.raw || null });
    }
    if (forceStepUp || (t && t.stepUpRequired)) {
      return withGateAndSecondaryEvaluation({
        ...r,
        stepUpRequired: true,
        hitlRequired: false,
        decisionId: t?.decisionId || r.decisionId,
        raw: t?.raw || r.raw,
        transactionPolicyStepUp: true,
      }, r, { source: 'transaction-policy', decision: 'STEP_UP', decisionId: t?.decisionId || null, raw: t?.raw || null });
    }
    if (t && (t.consentRequired || t.hitlRequired)) {
      return withGateAndSecondaryEvaluation({
        ...r,
        hitlRequired: true,
        decisionId: t.decisionId || r.decisionId,
        raw: t.raw || r.raw,
        transactionPolicyHitl: true,
      }, r, { source: 'transaction-policy', decision: 'HITL_REQUIRED', decisionId: t.decisionId || null, raw: t.raw || null });
    }
  } catch (err) {
    if (forceStepUp) {
      return withGateAndSecondaryEvaluation(
        { ...r, stepUpRequired: true, hitlRequired: false, transactionPolicyStepUp: true },
        r,
        { source: 'transaction-policy', decision: 'STEP_UP', decisionId: null, raw: null },
      );
    }
```

(The rest of the `catch` block — the `console.warn` and `return _localAmountLimitFallback(r, { amount, acr });` — is unchanged; `_localAmountLimitFallback` now attaches the fields itself.)

In `mapLivePingOneResult` (lines 919-1043), add `gateEvaluation: r.gateEvaluation || null, secondaryEvaluation: r.secondaryEvaluation || null,` into the `body` object of all four block branches (DENY, step-up, hitl-receipt-rejected, hitl-required) and into the `evaluation` object of the final permit branch. Each branch in full, in the order they appear in the file:

```js
    if (r.decision === 'DENY') {
      return {
        ran: true,
        block: {
          status: 403,
          body: {
            error: 'mcp_authorization_denied',
            error_description: 'PingOne Authorize denied MCP tool access for this session.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            deny_reason: r.raw?.reason || null,
            deny_parameters: r.raw?.parameters || null,
            authorize_request: r._debug?.request || null,
            authorize_response: r._debug?.response || r.raw || null,
            gateEvaluation: r.gateEvaluation || null,
            secondaryEvaluation: r.secondaryEvaluation || null,
            ...autoDisabled,
          },
        },
      };
    }

    if (r.stepUpRequired && !stepUpAlreadyVerified) {
      return {
        ran: true,
        block: {
          status: 428,
          body: {
            error: 'mcp_step_up_required',
            error_description:
              'PingOne Authorize requires additional authentication before MCP tools can run.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            step_up_method: resolveStepUpMethod(useCaseId),
            gateEvaluation: r.gateEvaluation || null,
            secondaryEvaluation: r.secondaryEvaluation || null,
            ...autoDisabled,
          },
        },
      };
    }

    if (r.hitlRequired && hitlApproved) {
      return {
        ran: true,
        block: {
          status: 403,
          body: {
            error: 'mcp_hitl_receipt_rejected',
            error_description:
              'HITL receipt accepted but authorization engine still requires approval — possible policy misconfiguration.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            gateEvaluation: r.gateEvaluation || null,
            secondaryEvaluation: r.secondaryEvaluation || null,
            ...autoDisabled,
          },
        },
      };
    }

    if (r.hitlRequired && hitlAlreadyVerified) {
      // Consume-on-use: the credit discharged this HITL gate, so spend it now.
      hitlCredit.consume(req.session);
    } else if (r.hitlRequired) {
      return {
        ran: true,
        block: {
          status: 428,
          body: {
            error: 'mcp_hitl_required',
            error_description:
              'PingOne Authorize requires human approval before MCP tools can run.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            gateEvaluation: r.gateEvaluation || null,
            secondaryEvaluation: r.secondaryEvaluation || null,
            ...autoDisabled,
          },
        },
      };
    }

    return {
      ran: true,
      permit: true,
      evaluation: {
        engine: 'pingone',
        decision: r.decision,
        path: r.path,
        decisionId: r.decisionId,
        decisionContext: 'McpFirstTool',
        request: r._debug?.request || null,
        response: r._debug?.response || r.raw || null,
        gateEvaluation: r.gateEvaluation || null,
        secondaryEvaluation: r.secondaryEvaluation || null,
        ...autoDisabled,
      },
    };
```

Only the 4 marked lines (`gateEvaluation: ...` / `secondaryEvaluation: ...`) are new in each block — everything else in these 5 return statements is today's existing code, unchanged, shown in full here so no other line needs to move.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/mcpToolAuthorizationService.test.js`
Expected: PASS — all new tests green, all pre-existing tests in this file still green (in particular every test in `describe('transaction-limit policy consult', ...)` and the rest of `describe('evaluateMcpFirstToolGate', ...)`).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/mcpToolAuthorizationService.js demo_api_server/src/__tests__/mcpToolAuthorizationService.test.js
git commit -m "feat(authz): preserve gate + transaction-policy decisions instead of discarding the first"
```

---

### Task 2: Emit `mcpAuthorizeEvaluations` from `mcpToolPipeline.js`

**Files:**

- Modify: `demo_api_server/services/mcpToolPipeline.js:464-487` (block path body), `:989-997` (permit path `out` assembly)
- Test: Create `demo_api_server/src/__tests__/mcpToolPipeline.authorizeEvaluations.test.js`

**Interfaces:**

- Consumes: `mcpAuthz.block.body.gateEvaluation`/`.secondaryEvaluation` and `mcpAuthz.evaluation.gateEvaluation`/`.secondaryEvaluation` (Task 1's output — this task mocks `deps.evaluateMcpFirstToolGate` directly, so it does NOT depend on Task 1 having landed to be implemented or tested).
- Produces: `outcome.body.mcpAuthorizeEvaluations` — an array `[gate, secondary]`, each `{ ...evaluation, engine: 'pingone', decisionContext: 'McpFirstTool'|'TransactionAmount' }` — present ONLY when both `gateEvaluation` and `secondaryEvaluation` exist on the gate result; absent otherwise. `outcome.body.mcpAuthorizeEvaluation` (singular) is never touched by this task.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/src/__tests__/mcpToolPipeline.authorizeEvaluations.test.js`:

```js
'use strict';

const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');

function baseDeps(overrides = {}) {
  return {
    resolveMcpAccessTokenWithEvents: async () => ({ token: 'tok', tokenEvents: [] }),
    evaluateMcpFirstToolGate: async () => ({ ran: true, permit: true, evaluation: { decisionId: 'd1', decisionContext: 'McpFirstTool' } }),
    introspectToken: async () => ({ active: true }),
    getSessionAccessToken: () => 'tok',
    callToolLocal: async () => ({ result: 'ok' }),
    mcpCallTool: async () => ({ result: 'ok' }),
    callToolViaGateway: async () => ({ result: 'ok' }),
    http2Bridge: null,
    pingoneAdapter: null,
    buildTokenEvent: () => ({}),
    mcpNoBearerResponse: () => null,
    createPendingDecision: () => null,
    createHitlChallenge: async () => null,
    decodeAgentId: () => undefined,
    recordMcpToolCall: () => {},
    recordComplianceAudit: () => {},
    publishMcpResultToSse: () => {},
    publishTokenEventsToSse: () => {},
    appEventLog: jest.fn(),
    emit: () => {},
    config: { introspectionConfigured: false, useGateway: false, gatewayHttpUrl: null, mcpUrl: 'http://x', useHttp2: false, pingoneAdminEnabled: false, pingoneAdminTools: () => false },
    ...overrides,
  };
}

describe('runMcpToolPipeline — mcpAuthorizeEvaluations (dynamic Token Chain authorize cards)', () => {
  test('block path: gate + secondary decisions become an ordered mcpAuthorizeEvaluations array', async () => {
    const deps = baseDeps({
      evaluateMcpFirstToolGate: async () => ({
        ran: true,
        block: {
          status: 403,
          body: {
            error: 'mcp_authorization_denied',
            decisionId: 'limit-1',
            decisionContext: 'McpFirstTool',
            gateEvaluation: { decision: 'PERMIT', decisionId: 'gate-1', raw: { decision: 'PERMIT' }, request: null, response: { decision: 'PERMIT' } },
            secondaryEvaluation: { source: 'transaction-policy', decision: 'DENY', decisionId: 'limit-1', raw: { decision: 'DENY', reason: 'over limit' } },
          },
        },
      }),
    });
    const outcome = await runMcpToolPipeline({
      tool: 'create_transfer', params: { amount: 2500 }, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome.kind).toBe('block');
    expect(outcome.body.mcpAuthorizeEvaluation.decisionId).toBe('limit-1'); // singular unchanged
    expect(outcome.body.mcpAuthorizeEvaluations).toEqual([
      { decision: 'PERMIT', decisionId: 'gate-1', raw: { decision: 'PERMIT' }, request: null, response: { decision: 'PERMIT' }, engine: 'pingone', decisionContext: 'McpFirstTool' },
      { source: 'transaction-policy', decision: 'DENY', decisionId: 'limit-1', raw: { decision: 'DENY', reason: 'over limit' }, engine: 'pingone', decisionContext: 'TransactionAmount' },
    ]);
  });

  test('block path: single decision (no secondary) never gets mcpAuthorizeEvaluations', async () => {
    const deps = baseDeps({
      evaluateMcpFirstToolGate: async () => ({
        ran: true,
        block: { status: 403, body: { error: 'mcp_authorization_denied', decisionId: 'd1', decisionContext: 'McpFirstTool' } },
      }),
    });
    const outcome = await runMcpToolPipeline({
      tool: 'get_my_accounts', params: {}, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome.body.mcpAuthorizeEvaluations).toBeUndefined();
  });

  test('permit path: gate + secondary decisions become an ordered mcpAuthorizeEvaluations array', async () => {
    const deps = baseDeps({
      evaluateMcpFirstToolGate: async () => ({
        ran: true,
        permit: true,
        evaluation: {
          decision: 'PERMIT', decisionId: 'limit-2', decisionContext: 'McpFirstTool',
          gateEvaluation: { decision: 'PERMIT', decisionId: 'gate-1', raw: null, request: null, response: null },
          secondaryEvaluation: { source: 'transaction-policy', decision: 'STEP_UP', decisionId: 'limit-2', raw: null },
        },
      }),
    });
    const outcome = await runMcpToolPipeline({
      tool: 'create_transfer', params: { amount: 600 }, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome.kind).toBe('result');
    expect(outcome.body.mcpAuthorizeEvaluations).toEqual([
      { decision: 'PERMIT', decisionId: 'gate-1', raw: null, request: null, response: null, engine: 'pingone', decisionContext: 'McpFirstTool' },
      { source: 'transaction-policy', decision: 'STEP_UP', decisionId: 'limit-2', raw: null, engine: 'pingone', decisionContext: 'TransactionAmount' },
    ]);
  });

  test('permit path: no secondary decision → no mcpAuthorizeEvaluations', async () => {
    const deps = baseDeps();
    const outcome = await runMcpToolPipeline({
      tool: 'get_balance', params: {}, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome.body.mcpAuthorizeEvaluation).toBeDefined();
    expect(outcome.body.mcpAuthorizeEvaluations).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/mcpToolPipeline.authorizeEvaluations.test.js`
Expected: FAIL — `outcome.body.mcpAuthorizeEvaluations` is `undefined` in the two tests that expect it populated.

- [ ] **Step 3: Implement**

In the block-path return (inside the `if (mcpAuthz.ran && mcpAuthz.block)` branch, currently lines 464-487), add one more spread key to the returned `body` object, after the existing `mcpAuthorizeEvaluation: { ... }` key:

```js
            return { kind: 'block', httpStatus: mcpAuthz.block.status, tokenEvents, body: {
                ...mcpAuthz.block.body,
                tool,
                ...(hitlChallenge ? {
                    challengeId: hitlChallenge.challengeId,
                    expiresAt: hitlChallenge.expiresAt,
                    taskId: hitlChallenge.challengeId,
                    instructions: `Approve at the dashboard, then retry the tool with ${HITL_CHALLENGE_ARG} in arguments.`,
                } : {}),
                tokenEvents,
                mcpAuthorizeEvaluation: {
                    decision: authorizeDecision,
                    outcome: authorizeOutcome,
                    engine: mcpAuthz.block.body.authorize_engine || null,
                    decisionContext: mcpAuthz.block.body.decisionContext,
                    decisionId: mcpAuthz.block.body.decisionId,
                    request: mcpAuthz.block.body.authorize_request || null,
                    response: mcpAuthz.block.body.authorize_response || null,
                    ...(ctx.useCaseId ? { useCaseId: ctx.useCaseId } : {}),
                    ...(ctx.vertical ? { vertical: ctx.vertical } : {}),
                },
                ...(mcpAuthz.block.body.gateEvaluation && mcpAuthz.block.body.secondaryEvaluation ? {
                    mcpAuthorizeEvaluations: [
                        { ...mcpAuthz.block.body.gateEvaluation, engine: 'pingone', decisionContext: 'McpFirstTool' },
                        { ...mcpAuthz.block.body.secondaryEvaluation, engine: 'pingone', decisionContext: 'TransactionAmount' },
                    ],
                } : {}),
            } };
```

In the permit path (currently lines 989-997), add the array alongside the existing singular assignment:

```js
        const out = {
            result,
            tokenEvents,
            activeModel,
            activeProvider
        };
        if (mcpAuthorizeEvaluationThisRequest) {
            out.mcpAuthorizeEvaluation = mcpAuthorizeEvaluationThisRequest;
            if (mcpAuthorizeEvaluationThisRequest.gateEvaluation && mcpAuthorizeEvaluationThisRequest.secondaryEvaluation) {
                out.mcpAuthorizeEvaluations = [
                    { ...mcpAuthorizeEvaluationThisRequest.gateEvaluation, engine: 'pingone', decisionContext: 'McpFirstTool' },
                    { ...mcpAuthorizeEvaluationThisRequest.secondaryEvaluation, engine: 'pingone', decisionContext: 'TransactionAmount' },
                ];
            }
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/mcpToolPipeline.authorizeEvaluations.test.js`
Expected: PASS, all 4 tests green.

Also run the pinned characterization suite to confirm zero behavior drift on the singular field:
Run: `cd demo_api_server && CI=true npx jest src/__tests__/mcpToolPipeline.characterization.test.js src/__tests__/mcpToolPipelineUseCaseId.test.js`
Expected: PASS, unchanged.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/mcpToolPipeline.js demo_api_server/src/__tests__/mcpToolPipeline.authorizeEvaluations.test.js
git commit -m "feat(authz): emit mcpAuthorizeEvaluations array when a second decision fires"
```

---

### Task 3: `tokenChainTraceStore.js` gains `ingestAuthorizeEvaluations`

**Files:**

- Modify: `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js:8-16` (`EMPTY_TRACE`), add new method after `ingestAuthorize` (currently ends line 124)
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`

**Interfaces:**

- Produces: `tokenChainTraceStore.ingestAuthorizeEvaluations(list)` — stores `trace.authorizeEvaluations = list` verbatim when `list` is a non-empty array; no-op otherwise. `trace.authorizeEvaluations` starts `null`.
- Consumed by: Task 4 (call sites in `demoAgentService.js`) and Task 5 (`buildTraceSteps.js` reads `trace.authorizeEvaluations`).

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`:

```js
test("ingestAuthorizeEvaluations stores the ordered decision list", () => {
  const list = [
    { decision: "PERMIT", decisionId: "gate-1", decisionContext: "McpFirstTool" },
    { decision: "DENY", decisionId: "limit-1", decisionContext: "TransactionAmount" },
  ];
  tokenChainTraceStore.ingestAuthorizeEvaluations(list);
  expect(tokenChainTraceStore.getState().trace.authorizeEvaluations).toEqual(list);
});

test("ingestAuthorizeEvaluations ignores empty/non-array input", () => {
  tokenChainTraceStore.ingestAuthorizeEvaluations([]);
  expect(tokenChainTraceStore.getState().trace.authorizeEvaluations).toBeNull();
  tokenChainTraceStore.ingestAuthorizeEvaluations(undefined);
  expect(tokenChainTraceStore.getState().trace.authorizeEvaluations).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`
Expected: FAIL — `tokenChainTraceStore.ingestAuthorizeEvaluations is not a function`.

- [ ] **Step 3: Implement**

In `EMPTY_TRACE` (lines 8-16), add the new field next to `authorize: null`:

```js
const EMPTY_TRACE = () => ({
  startedAt: null, prompt: null, routingMode: null, routingDetail: null,
  llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, authorizeEvaluations: null, outcome: null,
  // 'declined' once the human refuses a step-up / HITL approval gate. Without
  // it the trace ends at authorize.outcome === 'STEP_UP' and the Proof verdict
  // cannot tell "gate fired, human approved" from "gate fired, human refused".
  approvalOutcome: null,
});
```

Add the new method immediately after `ingestAuthorize(...)` closes (after line 124's `},`):

```js
  ingestAuthorizeEvaluations(list) {
    if (!Array.isArray(list) || !list.length) return;
    ensureTrace();
    trace.authorizeEvaluations = list;
    emit();
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js`
Expected: PASS, all tests in the file green (including pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.test.js
git commit -m "feat(token-chain): tokenChainTraceStore learns ingestAuthorizeEvaluations"
```

---

### Task 4: Wire `demoAgentService.js`'s 3 ingest sites to the new store method

**Files:**

- Modify: `demo_api_ui/src/services/demoAgentService.js:399-432` (error/block path), `:673-700` (success/permit path), `:1040-1042` (`ingestLegacyRunTrace`)
- Test: `demo_api_ui/src/services/__tests__/callMcpTool.stepUpAuthorizeIngest.test.js`, `demo_api_ui/src/services/__tests__/demoAgentService.legacyTrace.test.js`

**Interfaces:**

- Consumes: `tokenChainTraceStore.ingestAuthorizeEvaluations` (Task 3).
- Produces: whenever a response body (or `ingestLegacyRunTrace` input) carries `mcpAuthorizeEvaluations`, `trace.authorizeEvaluations` gets populated — purely additive next to the existing singular-field handling, which is untouched.

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_ui/src/services/__tests__/callMcpTool.stepUpAuthorizeIngest.test.js` (inside the existing `describe('callMcpTool step-up 428 authorize ingest', ...)` block, or as new top-level tests in the same file — match whichever the file already uses):

```js
  test('ingests mcpAuthorizeEvaluations (gate + secondary) from a 403 mcp_authorization_denied body', async () => {
    const evaluations = [
      { decision: 'PERMIT', decisionId: 'gate-1', engine: 'pingone', decisionContext: 'McpFirstTool' },
      { decision: 'DENY', decisionId: 'limit-1', engine: 'pingone', decisionContext: 'TransactionAmount' },
    ];
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: () =>
          Promise.resolve({
            error: 'mcp_authorization_denied',
            error_description: 'PingOne Authorize denied MCP tool access for this session.',
            tokenEvents: [],
            mcpAuthorizeEvaluation: { decision: 'DENY', decisionId: 'limit-1' },
            mcpAuthorizeEvaluations: evaluations,
          }),
      }),
    );

    await expect(callMcpTool('create_transfer', { amount: 2500 })).rejects.toMatchObject({
      statusCode: 403,
      code: 'mcp_authorization_denied',
    });

    const snap = tokenChainTraceStore.getState();
    expect(snap.trace.authorizeEvaluations).toEqual(evaluations);
  });

  test('ingests mcpAuthorizeEvaluations on a 200 OK permit response', async () => {
    const evaluations = [
      { decision: 'PERMIT', decisionId: 'gate-1', engine: 'pingone', decisionContext: 'McpFirstTool' },
      { decision: 'STEP_UP', decisionId: 'limit-2', engine: 'pingone', decisionContext: 'TransactionAmount' },
    ];
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () =>
          Promise.resolve({
            result: 'ok',
            tokenEvents: [],
            mcpAuthorizeEvaluation: { decision: 'PERMIT', decisionId: 'limit-2' },
            mcpAuthorizeEvaluations: evaluations,
          }),
      }),
    );

    await callMcpTool('create_transfer', { amount: 600 });

    const snap = tokenChainTraceStore.getState();
    expect(snap.trace.authorizeEvaluations).toEqual(evaluations);
  });
```

Append to `demo_api_ui/src/services/__tests__/demoAgentService.legacyTrace.test.js`:

```js
test("ingestLegacyRunTrace forwards mcpAuthorizeEvaluations to the store", () => {
  const evaluations = [
    { decision: "PERMIT", decisionId: "gate-1", decisionContext: "McpFirstTool" },
    { decision: "DENY", decisionId: "limit-1", decisionContext: "TransactionAmount" },
  ];
  ingestLegacyRunTrace({
    agentPath: "llm",
    reply: "Transfer failed.",
    success: false,
    mcpAuthorizeEvaluation: { decision: "DENY", decisionId: "limit-1" },
    mcpAuthorizeEvaluations: evaluations,
  });
  const { trace } = tokenChainTraceStore.getState();
  expect(trace.authorizeEvaluations).toEqual(evaluations);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/callMcpTool.stepUpAuthorizeIngest.test.js src/services/__tests__/demoAgentService.legacyTrace.test.js`
Expected: FAIL — `snap.trace.authorizeEvaluations` / `trace.authorizeEvaluations` is `null` in the 3 new tests.

- [ ] **Step 3: Implement**

At the error/block-path site (after the existing `tokenChainTraceStore.ingestAuthorize(ae);` call, currently line 429):

```js
          tokenChainTraceStore.ingestAuthorize(ae);
          tokenChainTraceStore.ingestTokenEvents(allTokenEvents);
          if (err.mcpAuthorizeEvaluations) {
            tokenChainTraceStore.ingestAuthorizeEvaluations(err.mcpAuthorizeEvaluations);
          }
```

At the success/permit-path site (after the existing `tokenChainTraceStore.ingestAuthorize(data.mcpAuthorizeEvaluation);` call, currently line 699):

```js
      tokenChainTraceStore.ingestAuthorize(data.mcpAuthorizeEvaluation);
      if (data.mcpAuthorizeEvaluations) {
        tokenChainTraceStore.ingestAuthorizeEvaluations(data.mcpAuthorizeEvaluations);
      }
```

At the `ingestLegacyRunTrace` site (after the existing `if (data.mcpAuthorizeEvaluation) { ... }` block, currently lines 1040-1042):

```js
    if (data.mcpAuthorizeEvaluation) {
      tokenChainTraceStore.ingestAuthorize(data.mcpAuthorizeEvaluation);
    }
    if (data.mcpAuthorizeEvaluations) {
      tokenChainTraceStore.ingestAuthorizeEvaluations(data.mcpAuthorizeEvaluations);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/callMcpTool.stepUpAuthorizeIngest.test.js src/services/__tests__/demoAgentService.legacyTrace.test.js`
Expected: PASS, all tests in both files green (including pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/demoAgentService.js demo_api_ui/src/services/__tests__/callMcpTool.stepUpAuthorizeIngest.test.js demo_api_ui/src/services/__tests__/demoAgentService.legacyTrace.test.js
git commit -m "feat(token-chain): wire mcpAuthorizeEvaluations from all 3 demoAgentService ingest sites"
```

---

### Task 5: `buildTraceSteps.js` renders one authorize card per decision

**Files:**

- Modify: `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js:65-68` (`DECISION_CONTEXT_LABELS`), `:88-101` (insert new helper after `buildAuthorizeReplay`), `:203-204` (trace destructure), `:397-415` (the authorize push)
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`

**Interfaces:**

- Consumes: `trace.authorizeEvaluations` (Task 3/4's output).
- Produces: every step this function returns for the `authorize` lane now carries `baseId: "authorize"` (new field). When 2+ decisions exist, `steps` contains multiple entries with `baseId === "authorize"`: `id: "authorize"` for the first (gate), `id: "authorize:2"` for the second (transaction/amount), etc. When 0 or 1 decision exists (the `trace.authorizeEvaluations` field absent/empty — every existing use case today), exactly one entry is produced, `id: "authorize"`, byte-identical `detail` shape to today.

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`:

```js
describe("buildTraceSteps — dynamic authorize cards (multi-decision)", () => {
  test("2 authorize evaluations render 2 cards, gate first then secondary", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      authorizeEvaluations: [
        { decision: "PERMIT", decisionId: "gate-1", engine: "pingone", decisionContext: "McpFirstTool", response: { decision: "PERMIT" } },
        { decision: "DENY", decisionId: "limit-1", engine: "pingone", decisionContext: "TransactionAmount", raw: { decision: "DENY", reason: "over limit" } },
      ],
    });
    const authorizeSteps = steps.filter((s) => s.baseId === "authorize");
    expect(authorizeSteps).toHaveLength(2);
    expect(authorizeSteps[0].id).toBe("authorize");
    expect(authorizeSteps[0].status).toBe("done");
    expect(authorizeSteps[0].detail.decision.outcome).toBe("PERMIT");
    expect(authorizeSteps[0].detail.response.text).toContain('"PERMIT"');
    expect(authorizeSteps[1].id).toBe("authorize:2");
    expect(authorizeSteps[1].status).toBe("error");
    expect(authorizeSteps[1].detail.decision.outcome).toBe("DENY");
    expect(authorizeSteps[1].detail.response.text).toContain("over limit");
    expect(authorizeSteps[1].detail.decision.label).toContain("Amount / transaction policy check");
  });

  test("no authorizeEvaluations field still renders exactly 1 authorize card (back-compat)", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      authorize: { decision: "PERMIT", engine: "pingone", decisionId: "d-1" },
    });
    const authorizeSteps = steps.filter((s) => s.baseId === "authorize");
    expect(authorizeSteps).toHaveLength(1);
    expect(authorizeSteps[0].id).toBe("authorize");
  });

  test("empty authorizeEvaluations array falls back to the single-decision path", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, authorizeEvaluations: [] });
    expect(steps.filter((s) => s.baseId === "authorize")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`
Expected: FAIL — `authorizeSteps` is empty (no step has a `baseId` field yet) in all 3 new tests.

- [ ] **Step 3: Implement**

Add a `TransactionAmount` entry to `DECISION_CONTEXT_LABELS` (lines 65-68):

```js
const DECISION_CONTEXT_LABELS = {
  McpFirstTool: "MCP tool-call check",
  TransactionAmount: "Amount / transaction policy check",
};
```

Insert a new module-level helper immediately after `buildAuthorizeReplay` (after line 101, before `buildGatewayReplay`):

```js
/** Build the why/request/response/decision/kv/replay detail for ONE authorize
 * card from a resolved evaluation object (`{decision, decisionId, engine,
 * decisionContext, request, response, source}`). Shared by the single-decision
 * path (fed the rich `azEval`) and the multi-decision path (fed each raw entry
 * off `trace.authorizeEvaluations`) so both render identically. */
function buildAuthorizeDetail(evalObj) {
  const decision = evalObj.decision != null ? String(evalObj.decision).toUpperCase() : "";
  const isDeny = decision === "DENY";
  const isChallenge = decision === "INDETERMINATE" || decision === "STEP_UP" || decision === "HITL_REQUIRED";
  const requestPayload = evalObj.request
    ? ((evalObj.request.body && evalObj.request.body.parameters)
        || evalObj.request.parameters
        || evalObj.request.body
        || evalObj.request)
    : null;
  const responseBody = evalObj.response || evalObj.raw || null;
  const why = isChallenge
    ? `Authorize returned ${evalObj.decision || "INDETERMINATE"} — the human must approve before the tool proceeds.`
    : isDeny
      ? `Authorize denied this action (${evalObj.engine || "policy"}) — the tool call is blocked.`
      : `Authorize returned ${evalObj.decision || "PERMIT"}`
        + (evalObj.decisionContext ? ` for the ${friendlyDecisionContext(evalObj.decisionContext)}` : "")
        + (evalObj.source === "gw-authorize" ? " at the Agent Gateway hop." : " before the tool ran.");
  return {
    why,
    request: requestPayload
      ? { title: "Decision request (actual)",
          text: `${(evalObj.request && evalObj.request.method) || "POST"} ${(evalObj.request && evalObj.request.url) || ""}\n${asJson(requestPayload)}` }
      : undefined,
    response: responseBody
      ? { title: "Decision response (raw)", text: asJson(responseBody) } : undefined,
    decision: { outcome: evalObj.decision || "INDETERMINATE",
      label: `${evalObj.decision || "INDETERMINATE"} — ${evalObj.engine || "?"}${evalObj.decisionContext ? ` (${friendlyDecisionContext(evalObj.decisionContext)})` : ""}` },
    kv: [
      ["engine", String(evalObj.engine || "")],
      ["decision id", String(evalObj.decisionId || "")],
      evalObj.source === "gw-authorize" ? ["evidence", "from gw-authorize (gateway hop)"] : null,
    ].filter((row) => row && row[1]),
    moreDetail: { edu: EDU.PINGONE_AUTHORIZE, label: "Learn: PingOne Authorize" },
    replay: buildAuthorizeReplay(evalObj, requestPayload),
  };
}
```

Add `authorizeEvaluations` to the trace destructure (line 204):

```js
  const { prompt, routingMode, routingDetail, llmDetail, llmReply, phases, tokenEvents, mcpResult, authorize, authorizeEvaluations, outcome } = trace;
```

Replace the single push at lines 397-415 (`steps.push(makeStep("authorize", azStatus, azEval ? {...} : {}));`) with:

```js
  if (Array.isArray(authorizeEvaluations) && authorizeEvaluations.length) {
    // Multi-decision run (e.g. McpFirstTool gate PERMIT + Transaction/Amount
    // policy DENY) — one card per decision, in execution order.
    authorizeEvaluations.forEach((evalObj, idx) => {
      const decision = evalObj && evalObj.decision != null ? String(evalObj.decision).toUpperCase() : "";
      const status = decision === "DENY" ? "error"
        : (decision === "INDETERMINATE" || decision === "STEP_UP" || decision === "HITL_REQUIRED") ? "active"
        : "done";
      const step = makeStep("authorize", status, evalObj ? buildAuthorizeDetail(evalObj) : {});
      step.id = idx === 0 ? "authorize" : `authorize:${idx + 1}`;
      step.baseId = "authorize";
      steps.push(step);
    });
  } else {
    const step = makeStep("authorize", azStatus,
      azEval ? {
        why: authorizeWhy,
        request: azRequestPayload || azEval.request
          ? { title: "Decision request (actual)",
              text: `${(azEval.request && azEval.request.method) || "POST"} ${(azEval.request && azEval.request.url) || ""}\n${asJson(azRequestPayload || azEval.request)}` }
          : undefined,
        response: azEval.response
          ? { title: "Decision response (raw)", text: asJson(azEval.response) } : undefined,
        decision: { outcome: azEval.decision || "INDETERMINATE",
          label: `${azEval.decision || "INDETERMINATE"} — ${azEval.engine || "?"}${azEval.decisionContext ? ` (${friendlyDecisionContext(azEval.decisionContext)})` : ""}` },
        kv: [
          ["engine", String(azEval.engine || "")],
          ["decision id", String(azEval.decisionId || "")],
          azEval.source === "gw-authorize" ? ["evidence", "from gw-authorize (gateway hop)"] : null,
        ].filter((row) => row && row[1]),
        moreDetail: { edu: EDU.PINGONE_AUTHORIZE, label: "Learn: PingOne Authorize" },
        replay: buildAuthorizeReplay(azEval, azRequestPayload),
      } : {});
    step.baseId = "authorize";
    steps.push(step);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js`
Expected: PASS — the 3 new tests green, and every pre-existing test in this file still green (in particular every `steps.find((s) => s.id === "authorize")` lookup across the file, since `id: "authorize"` is preserved for the single/first card in every case).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js demo_api_ui/src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js
git commit -m "feat(token-chain): render one authorize card per PingOne decision"
```

---

### Task 6: Full verification and manual live replay

**Files:** none (verification only)

**Interfaces:** none — this task produces no new interfaces, it confirms Tasks 1-5 compose correctly end-to-end.

- [ ] **Step 1: Run the full backend suite**

Run: `cd demo_api_server && CI=true npm test -- --forceExit`
Expected: PASS, 0 failures.

- [ ] **Step 2: Run the full frontend suite + build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: PASS, 0 failures; build completes with no errors.

- [ ] **Step 3: Manual live replay of the motivating scenario**

With the demo stack running (`local.ping-devops.com:4000`) and live PingOne Authorize configured (not simulated mode): sign in, send `transfer $2500 from checking to savings` (a `create_transfer` call with an amount above the deny threshold). Open the Token Chain rail.

Expected: two "PingOne Authorize" cards appear in order — the first (`McpFirstTool` / "MCP tool-call check") showing `PERMIT`, the second (`TransactionAmount` / "Amount / transaction policy check") showing `DENY`. The rail's run-story headline and the chat's "Transfer failed" message agree (both reflect the DENY) — no more contradiction between the top-line outcome and the first card shown.

- [ ] **Step 4: Confirm an ordinary single-decision use case is unaffected**

Run any use case that does NOT hit the amount-gated write-tool path (e.g. `show my balance` / `get_my_accounts`). Open the Token Chain rail.

Expected: exactly one "PingOne Authorize" card, identical in appearance to before this change.

- [ ] **Step 5: Report status**

State ✅ or ❌ for each of: backend suite, frontend suite + build, live $2500 replay, live single-decision replay — per the root `CLAUDE.md` "Before claiming done" gate. Do not mark this plan complete without evidence for all four.
