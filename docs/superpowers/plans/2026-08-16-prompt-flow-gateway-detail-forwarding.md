# Gateway Detail Forwarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forward the same full `details` object `recordGatewayAudit()` already builds for `mcpAuditStore` into the ledger hop it emits, so the new prompt-flow ledger view and the existing `GET /api/mcp/audit` view show identical gateway detail — no divergence between the two.

**Architecture:** `demo_mcp_gateway/src/gatewayAudit.ts`'s `recordGatewayAudit()` already computes one rich `details` object per tool-call outcome (httpStatus, jsonRpcErrorCode, DPoP/RAR posture, token scopes, ACR, scope-denial alerts) and ships it to the BFF's `mcpAuditStore` via `axios.post`. In the same function it also calls `emitHop()` (`demo_mcp_gateway/src/transactionHop.ts`) to write a `gateway.authorize` hop into the shared transaction ledger, but that call currently sends only a coarse `decision{outcome,by,reason}` — the rich `details` object never reaches the ledger. This plan (a) adds an optional `details` field to `emitHop()`'s input type so the hop payload can carry it, and (b) forwards the exact same `details` object used for `mcpAuditStore` into that field. One computation, two destinations.

**Tech Stack:** TypeScript 5, Jest 29.7 + ts-jest, `demo_mcp_gateway/src/`.

**Spec:** docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md

## Global Constraints

- No schema migration: the ledger's `details` field already accepts an arbitrary object (gateway hops use it today for DPoP/RAR posture) — this change only widens what one existing call site sends into an already-generic field.
- One computation, two destinations, no divergence: the `details` object forwarded into `emitHop()` must be the exact same object (not a re-derived or trimmed copy) posted to `mcpAuditStore` in the same `recordGatewayAudit()` invocation.
- Hop emission is fire-and-forget and must never block or fail the tool-call response path — this plan only widens an existing payload; it must not change `emitHop()`'s or `recordGatewayAudit()`'s error-swallowing (`try {} catch {}` / `.catch(() => {})`) behavior.
- No new hop mechanism and no new tests for the hop transport itself (unchanged per spec §7) — only coverage confirming the expanded `details` payload matches what `mcpAuditStore` already receives (regression guard against the two diverging again).
- Scope is `demo_mcp_gateway` only — do not touch `demo_authz_server`, `demo_llm_proxy`, `langchain_agent`, or `demo_api_server` (sibling plans own those).
- Touch only what you must: no unrelated refactors to `gatewayAudit.ts` or `transactionHop.ts` beyond the two changes below.
- If the worktree executing this plan has no `demo_mcp_gateway/node_modules` (fresh worktrees never inherit installed deps — lockfiles are gitignored repo-wide), run `npm install` in `demo_mcp_gateway` before the first test run.
- Verify with `cd demo_mcp_gateway && npm run build && npm test` (per `demo_mcp_gateway/CLAUDE.md`) before considering the plan done — `tsc` catches type errors a passing test run alone would miss.

---

### Task 1: Add an optional `details` field to `TransactionHopInput`

**Files:**
- Modify: `demo_mcp_gateway/src/transactionHop.ts:5-17`
- Test: `demo_mcp_gateway/tests/transactionHop.test.ts`

**Interfaces:**
- Consumes: nothing new — extends the existing `TransactionHopInput` interface already used by `emitHop(hop: TransactionHopInput): void`.
- Produces: `TransactionHopInput.details?: Record<string, unknown>` — when present, `emitHop()` includes it verbatim (via its existing `{ ...hop, correlationId, service: SERVICE }` spread) in the JSON body POSTed to `BFF_TRANSACTION_HOP_URL`. Task 2 consumes this field.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('gateway emitHop', ...)` block in `demo_mcp_gateway/tests/transactionHop.test.ts`, immediately after the `'posts a hop stamped with the ALS correlation id and the service name'` test (after its closing `});` on line 36, before the `'no-ops outside a correlation scope'` test):

```typescript
  it('forwards an optional details object into the posted hop body verbatim', async () => {
    const details = { httpStatus: 403, dpop_bound: true, alert: true, reason: 'insufficient_scope' };
    runWithCorrelation('c1', () => emitHop({ phase: 'gateway.authorize', op: 'create_transfer', details }));
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(1);
    expect(calls[0].body.details).toEqual(details);
  });
```

- [ ] **Step 2: Run test to verify it fails**

If `demo_mcp_gateway/node_modules` is missing, first run: `cd demo_mcp_gateway && npm install`

Run: `cd demo_mcp_gateway && npx jest tests/transactionHop.test.ts --forceExit`

Expected: FAIL — ts-jest compile error, since `TransactionHopInput` has no `details` property yet:
```
TS2353: Object literal may only specify known properties, and 'details' does not exist in type 'TransactionHopInput'.
```

- [ ] **Step 3: Write minimal implementation**

In `demo_mcp_gateway/src/transactionHop.ts`, add `details` to the interface (after `decision`):

```typescript
export interface TransactionHopInput {
  phase:
    | 'ui.request' | 'agent.reason' | 'token.exchange' | 'gateway.authorize'
    | 'authz.decision' | 'hitl.consent' | 'mcp.tool' | 'response';
  op?: string;
  identity?: Record<string, unknown>;
  decision?: Record<string, unknown>;
  details?: Record<string, unknown>;
  durationMs?: number;
  status?: 'ok' | 'error';
  correlationId?: string;
  params?: Record<string, unknown>;
  consentRequired?: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_mcp_gateway && npx jest tests/transactionHop.test.ts --forceExit`

Expected: PASS — all tests in `transactionHop.test.ts` green, including the new one.

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/transactionHop.ts demo_mcp_gateway/tests/transactionHop.test.ts
git commit -m "gateway: add optional details field to TransactionHopInput"
```

---

### Task 2: Forward `recordGatewayAudit()`'s `details` object into its `emitHop()` call

**Files:**
- Modify: `demo_mcp_gateway/src/gatewayAudit.ts:77-92`
- Test: `demo_mcp_gateway/tests/gatewayAudit.test.ts`

**Interfaces:**
- Consumes: `TransactionHopInput.details?: Record<string, unknown>` (Task 1).
- Produces: every `gateway.authorize` hop written by `recordGatewayAudit()` now carries a `details` field identical to the `details` object POSTed to `mcpAuditStore` in the same call — the exact shape `GET /api/mcp/audit` already returns (httpStatus, jsonRpcErrorCode, DPoP/RAR posture, token scopes, ACR, scope-denial alerts with `requiredScopes`/`missingScopes`/`availableScopes`). Downstream consumers (the new `GET /api/prompt-flow/:correlationId` read endpoint, owned by a sibling plan) can now read this from the ledger hop directly.

- [ ] **Step 1: Write the failing test**

Add `import * as transactionHop from '../src/transactionHop';` to the top imports of `demo_mcp_gateway/tests/gatewayAudit.test.ts` (alongside the existing `import axios from 'axios';` etc.), then add this new `describe` block after the existing `describe('recordGatewayAudit — correlation id on audit events', ...)` block (i.e. after its closing `});` on line 63, before the `// Scenario 4 ...` comment that precedes `describe('scopeAlertDetails ...')`):

```typescript
describe('recordGatewayAudit — details forwarded into the ledger hop (no divergence from mcpAuditStore)', () => {
  let emitHopSpy: jest.SpyInstance;

  beforeEach(() => {
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({ status: 200 } as never);
    emitHopSpy = jest.spyOn(transactionHop, 'emitHop').mockImplementation(() => {});
  });

  afterEach(() => {
    emitHopSpy.mockRestore();
  });

  it('forwards the same details object built for mcpAuditStore into the emitHop details field', () => {
    const details = {
      httpStatus: 403,
      dpop_bound: true,
      dpop_verified: true,
      alert: true,
      reason: 'insufficient_scope',
      requiredScopes: ['transfers:write'],
      missingScopes: ['transfers:write'],
      availableScopes: ['accounts:read'],
    };
    runWithCorrelation('cid-details-1', () =>
      recordGatewayAudit({ operation: 'create_transfer', outcome: 'failure', details }, config),
    );
    expect(emitHopSpy).toHaveBeenCalledTimes(1);
    const hopArg = emitHopSpy.mock.calls[0][0];
    expect(hopArg.details).toEqual(details);
    expect(hopArg.details).toEqual(lastBody().details);
  });

  it('omits details from the hop when the audit event carries none', () => {
    runWithCorrelation('cid-details-2', () =>
      recordGatewayAudit({ operation: 'get_accounts', outcome: 'success' }, config),
    );
    const hopArg = emitHopSpy.mock.calls[0][0];
    expect(hopArg.details).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_gateway && npx jest tests/gatewayAudit.test.ts --forceExit`

Expected: FAIL on `'forwards the same details object built for mcpAuditStore into the emitHop details field'`:
```
expect(received).toEqual(expected)
Expected: {"httpStatus": 403, "dpop_bound": true, ...}
Received: undefined
```
(The `'omits details ...'` test passes trivially since `hopArg.details` is already `undefined` today — the first test is the one proving the gap.)

- [ ] **Step 3: Write minimal implementation**

In `demo_mcp_gateway/src/gatewayAudit.ts`, update the comment and `emitHop()` call inside `recordGatewayAudit()`:

```typescript
    // Same chokepoint, second consumer: the durable audit trail and the
    // ledger hop now carry the identical `details` object — one computation,
    // two destinations, so /api/mcp/audit and the ledger can never diverge.
    const decision = decisionFromAuditOutcome(enriched.outcome, enriched.details);
    emitHop({
      phase: 'gateway.authorize',
      op: enriched.operation,
      correlationId: enriched.correlationId,
      durationMs: enriched.duration,
      identity: { sub: enriched.userId ?? null, act: enriched.agentId ? [enriched.agentId] : [] },
      decision: {
        outcome: decision.outcome,
        by: 'gateway',
        reason: decision.reason,
      },
      details: enriched.details,
      status: enriched.outcome === 'failure' ? 'error' : 'ok',
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_mcp_gateway && npx jest tests/gatewayAudit.test.ts --forceExit`

Expected: PASS — all tests in `gatewayAudit.test.ts` green, including both new ones.

Then run the full gateway suite and build gate: `cd demo_mcp_gateway && npm run build && npm test`

Expected: `tsc` exits 0, and `jest --forceExit` reports all suites passing (no regressions in `transactionHop.test.ts`, `authorizeMcpRequest-audit-metadata.test.ts`, or any other suite touching `recordGatewayAudit`/`emitHop`).

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/gatewayAudit.ts demo_mcp_gateway/tests/gatewayAudit.test.ts
git commit -m "gateway: forward mcpAuditStore details into the ledger hop"
```

---

## Self-Review

**Spec coverage:** The spec's Gateway paragraph (§2) states exactly one required change: "forward the same `details` object built for `mcpAuditStore` into the hop's `details` field too — one computation, two destinations, no divergence." Task 1 makes the field representable on the hop's type; Task 2 performs the forward and adds the regression-guard test the spec's §7 Gateway/P1AZ testing bullet calls for ("add coverage confirming the *expanded* `details` payload matches what `mcpAuditStore`/`auditDecision()` already build"). No other gateway-side change is specced (WS and HTTP call sites in `index.ts` / `authorizeMcpRequest.ts` already build and pass the full `details` object into `recordGatewayAudit()`'s `event.details` today — confirmed by reading both call sites — so no change is needed there). Full coverage, no gaps.

**Placeholder scan:** No TBD/TODO, no "add appropriate error handling," no "similar to Task N" repetition — both tasks show complete, runnable code and exact commands/expected output.

**Naming consistency:** `details` is used identically as the field name across `TransactionHopInput.details` (Task 1), `GatewayAuditEvent.details` (pre-existing, unchanged), and the `emitHop({ ..., details: enriched.details })` call (Task 2) — no renaming drift. `emitHopSpy`, `mockedAxios`, `config`, `lastBody()`, `runWithCorrelation` all reuse the exact names/helpers already defined in the existing test file rather than introducing new ones.
