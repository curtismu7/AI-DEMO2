# Transaction Chain of Custody Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Follow one agent turn end-to-end across six services in a durable ledger, assert the delegation chain held with identity invariants, and corroborate it against independently-written audit sinks.

**Architecture:** An append-only LMDB ledger in the BFF is the primary witness — each service emits a `TransactionHop` keyed by correlationId. A pure-function invariant engine and a reconciler that joins existing audit sinks run at read time. Jaeger stays a deep-link only.

**Tech Stack:** Node/Express + LMDB (BFF), TypeScript (agent-service, mcp-gateway, mcp-server), React 19 + Vite (UI). Tests: jest (BFF, hitl, gateway, mcp-server, agent-service), `node --test` (authz-server), vitest + React Testing Library (UI).

**Source spec:** [2026-07-18-transaction-chain-of-custody-design.md](../specs/2026-07-18-transaction-chain-of-custody-design.md)

## Global Constraints

- **Worktree only.** All work happens in `.claude/worktrees/transaction-chain-of-custody` on branch `worktree-transaction-chain-of-custody`. A hard-block hook denies Write/Edit in the main checkout. Stage explicitly with `git add <files>` — never `git add -A`.
- **No writes into protected auth code.** `demo_api_server/routes/oauth.js`, `demo_api_server/services/oauthService.js`, and the BFF session layer are REGRESSION_PLAN §1 protected and must not be modified by any task in this plan.
- **Three further files this plan DOES touch are also REGRESSION_PLAN §1 protected.** Every edit to them must be strictly additive, minimal, and must state what it will not break before changing anything:
  - `demo_api_server/server.js` (§1 *Session persistence*) — Tasks 5, 6 add route mounts and middleware only. Do not touch `req.session.save()` ordering, existing mount order, or any session configuration.
  - `demo_api_server/services/configStore.js` (§1 *configStore / Config UI*) — Task 14 adds one key to the defaults map. Do not change any existing key, default, or the `public` flag of anything already present.
  - `demo_api_ui/src/App.js` (§1 *Bottom dock on dashboard routes*, *AI Agent FAB*) — Task 16 adds one import and one `<Route>`. Do not touch the dock, FAB, or dashboard route blocks.
- **Emission is fail-open.** Every `emitHop` call site is wrapped in try/catch and is fire-and-forget. A dead ledger drops hops; it never fails, blocks, or slows a request.
- **Claims only — never raw tokens in the ledger.** Store `jti` plus decoded claims. No `access_token`, `id_token`, `refresh_token`, `subject_token`, or `actor_token` values.
- **Emoji allowlist (REGRESSION_PLAN §0):** only `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` may appear in UI copy.
- **Feature flag `ff_transaction_ledger`**, default `'true'`, wired at all three points (see Task 14).
- **Running BFF jest from this worktree needs an override, or it silently passes with zero tests.** `demo_api_server/jest.config.js:47-52` sets `testPathIgnorePatterns: ['/node_modules/', '/\\.claude/worktrees/', '/\\.kilo/worktrees/', '/tests/real/']`. Because this worktree lives under `.claude/worktrees/`, the plain command reports `0 matches` and **exits 0** — a false pass. Every BFF test command in this plan must be run as:

  ```bash
  cd demo_api_server && CI=true ./node_modules/.bin/jest <testpath> \
    --testPathIgnorePatterns '/node_modules/' '/tests/real/'
  ```

  `CI=true` caps workers so the supertest suites do not flake. Re-listing `/node_modules/` and `/tests/real/` keeps those exclusions while dropping only the worktree ones — passing an empty `--testPathIgnorePatterns=''` would re-enable `tests/real/`, which hits live services. Use `./node_modules/.bin/jest`, not `npx jest`: a shell hook in this environment mangles `npx jest` into a parser error.

  **Any BFF test run that reports `0 matches` or `No tests found` is a FAILURE, never a pass.** Read the suite/test counts before claiming green.
- **Internal secret:** `BFF_INTERNAL_SECRET`, dev fallback literal `'dev-shared-secret-change-me'`, presented as header `x-internal-gateway-secret`, compared with `crypto.timingSafeEqual`.

## Deviations from the spec (resolved during planning)

These five findings changed the spec's assumptions. Each resolution is applied throughout the tasks below.

1. **Route rename.** `/transactions` (UI, `demo_api_ui/src/App.js:1176`) and `/api/transactions` (BFF, `demo_api_server/server.js:1239`) are both already taken by the banking transactions pages. This feature uses **`/transaction-trace`** and **`/api/transaction-trace`**.

2. **`tokenChainService` records no `correlationId`.** The `trackTokenEvent` event literal has no such field, so deriving `token.exchange` hops by correlationId was impossible as specced. Resolution: add `correlationId: getCorrelationId() || null` inside the event literal in `tokenChainService.js`. It reads AsyncLocalStorage, so **zero call sites change** and no protected auth file is touched (Task 10).

3. **`authz auditDecision` writes to stdout only** — no file, no store, and nothing in the repo reads `evt: 'authz_decision'`. Adding PERMIT auditing there (approved during brainstorming) does not make authz reconcilable. Resolution: do **both** — authz emits a real hop over HTTP (the machine path, Task 8) *and* gains PERMIT auditing on the stdout line (the human-debug path, Task 8). The second witness for authz decisions is `mcpTrafficLogger`'s existing `authorize_response` NDJSON line, not stdout.

4. **HITL drops `correlationId`.** `demo_mcp_gateway/src/hitlClient.ts:64` sends it, but `POST /challenges` destructures only `{ tool, userId, agentId, userEmail, context }` and `challengeStore.create` ignores the rest. Consent cannot join without a two-line additive fix (Task 9).

5. **INV-7 cannot use the intent token.** `mintIntentToken` (`demo_api_server/services/intentTokenService.js:130`) carries `permitted_tools` and `prompt_hash` — **no tool parameters at all**. The real parameter binding lives in the HITL challenge `context` and is enforced by `verifyHitlReceipt` (`demo_mcp_gateway/src/hitlClient.ts:132`), which binds `amount` plus the account keys `to_account_id`, `from_account_id`, `account_id`, `toAccountId`, `fromAccountId`. INV-7 mirrors that logic against the ledger (Task 12).

Two further facts constrain the code:

- **`demo_api_server/data/token-chains/*.json` are jest fixtures, not production output.** They use `type` (not `eventType`), numeric epoch `timestamp` (not ISO), and `scope` (not `scopes[]`). `reloadFromDisk()` validates only `Array.isArray`, so they load into `tokenEvents` on boot. Derived-hop code must skip any record carrying a `type` key (Task 10).
- **`mcpAuditStore.query()` has no `correlationId` filter** and gateway-written records have no `eventType`. The reconciler scans and filters client-side (Task 13).

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `demo_api_server/utils/traceIdFromCorrelation.js` | Deterministic correlationId → 32-hex trace-id derivation |
| `demo_api_server/services/lmdb/transactionLedger.lmdb.js` | Append-only per-transaction hop store, capped at 500 |
| `demo_api_server/services/transactionHop.js` | BFF in-process `emitHop` |
| `demo_api_server/routes/transactionHopIngest.js` | `POST /internal/transaction-hop`, secret-guarded |
| `demo_api_server/routes/transactionTrace.js` | `GET /api/transaction-trace[/:correlationId]` |
| `demo_api_server/services/transactionAssembler.js` | Merges ledger hops + derived token-exchange hops |
| `demo_api_server/services/transactionInvariants.js` | Pure `evaluate(record)` — INV-1..INV-8 |
| `demo_api_server/services/transactionReconciler.js` | Second-witness join |
| `demo_agent_service/src/transactionHop.ts` | agent-service emitter |
| `demo_mcp_gateway/src/transactionHop.ts` | gateway emitter |
| `demo_mcp_server/src/utils/transactionHop.ts` | mcp-server emitter |
| `demo_authz_server/transactionHop.js` | authz emitter |
| `demo_hitl_service/src/transactionHop.js` | hitl emitter |
| `demo_api_ui/src/pages/TransactionTracePage.jsx` + `.css` | Chain-of-custody UI |

**Modify:** `demo_api_server/utils/outboundTracing.js`, `demo_api_server/services/tokenChainService.js`, `demo_api_server/server.js`, `demo_api_server/routes/featureFlags.js`, `demo_api_server/services/configStore.js`, `demo_mcp_server/src/server/correlationFromMessage.ts`, `demo_mcp_server/src/server/HttpMCPTransport.ts`, `demo_agent_service/src/agentRunHandler.ts`, `demo_authz_server/logger.js`, `demo_authz_server/routes/decision.js`, `demo_hitl_service/src/routes/challenges.js`, `demo_hitl_service/src/store/challengeStore.js`, `demo_api_ui/src/App.js`, `demo_api_ui/src/components/AdminSideNav.jsx`, `demo_api_ui/src/components/QuickFlagsPill.js`.

**Emitter placement note (deviation from spec wording):** the spec said to add `emitHop` to each service's existing `teachLogger`. Each emitter instead gets its own small module that imports the same `correlationContext`. Identical amount of code, single responsibility, and five working logger files stay untouched.

---

## Phase P0 — Correlation foundation

### Task 1: Deterministic trace-id derivation

**Files:**
- Create: `demo_api_server/utils/traceIdFromCorrelation.js`
- Modify: `demo_api_server/utils/outboundTracing.js:30-42`
- Test: `demo_api_server/tests/traceIdFromCorrelation.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `traceIdFromCorrelation(correlationId: string) => string` (32 lowercase hex chars). Used by Task 15's read route to build the Jaeger deep-link, and by `buildTraceparent`.

`buildTraceparent` already contains this exact derivation inline. Extracting it is what makes the ledger's `traceId` provably equal to the trace-id on the wire — today the two are computed in one place and readable from nowhere.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/traceIdFromCorrelation.test.js`:

```js
'use strict';
const { traceIdFromCorrelation } = require('../utils/traceIdFromCorrelation');
const { buildTraceparent } = require('../utils/outboundTracing');

describe('traceIdFromCorrelation', () => {
  test('reuses a UUID\'s hex digits as the trace-id', () => {
    const id = '3d5b456e-9de9-4091-850b-2d04fd0948b6';
    expect(traceIdFromCorrelation(id)).toBe('3d5b456e9de94091850b2d04fd0948b6');
  });

  test('hashes a non-UUID correlation id to 32 hex chars', () => {
    const out = traceIdFromCorrelation('req-42');
    expect(out).toMatch(/^[0-9a-f]{32}$/);
  });

  test('is deterministic — same input, same trace-id', () => {
    expect(traceIdFromCorrelation('req-42')).toBe(traceIdFromCorrelation('req-42'));
  });

  test('distinct inputs produce distinct trace-ids', () => {
    expect(traceIdFromCorrelation('req-1')).not.toBe(traceIdFromCorrelation('req-2'));
  });

  test('matches the trace-id buildTraceparent puts on the wire', () => {
    const id = '3d5b456e-9de9-4091-850b-2d04fd0948b6';
    const traceparent = buildTraceparent(id);
    expect(traceparent.split('-')[1]).toBe(traceIdFromCorrelation(id));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/traceIdFromCorrelation.test.js`
Expected: FAIL — `Cannot find module '../utils/traceIdFromCorrelation'`

- [ ] **Step 3: Write the module**

Create `demo_api_server/utils/traceIdFromCorrelation.js`:

```js
'use strict';

const crypto = require('node:crypto');

/**
 * Derive a stable 32-hex-char W3C trace-id from a correlation id.
 *
 * Deterministic, not reversible: a UUID correlation id reuses its own hex
 * digits so the two identifiers stay visibly linked in Jaeger; anything else
 * is hashed. Extracted from outboundTracing.buildTraceparent so the ledger can
 * record the same trace-id that goes out on the `traceparent` header, making a
 * ledger row deep-linkable to its Jaeger trace.
 *
 * @param {string} correlationId
 * @returns {string} 32 lowercase hex chars
 */
function traceIdFromCorrelation(correlationId) {
  const hex = String(correlationId).replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.length >= 32
    ? hex.slice(0, 32)
    : crypto.createHash('sha256').update(String(correlationId)).digest('hex').slice(0, 32);
}

module.exports = { traceIdFromCorrelation };
```

- [ ] **Step 4: Rewrite `buildTraceparent` to use it**

In `demo_api_server/utils/outboundTracing.js`, add the require next to the existing ones:

```js
const crypto = require('node:crypto');
const axios = require('axios');
const { getCorrelationId } = require('./correlationContext');
const { traceIdFromCorrelation } = require('./traceIdFromCorrelation');
```

Replace the body of `buildTraceparent` (currently lines 30-42) with:

```js
/**
 * Build a W3C traceparent (`00-<32hex traceId>-<16hex spanId>-01`) from the
 * correlation ID. The trace-id derivation lives in traceIdFromCorrelation so
 * the transaction ledger can record the identical value. The span-id is fresh
 * per outbound call.
 */
function buildTraceparent(correlationId) {
  const traceId = traceIdFromCorrelation(correlationId);
  const spanId = crypto.randomBytes(8).toString('hex');
  return `00-${traceId}-${spanId}-01`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/traceIdFromCorrelation.test.js`
Expected: PASS, 5 tests.

Run the existing outbound-tracing suite to confirm no regression:
Run: `cd demo_api_server && CI=true npx jest --testPathPattern='outboundTracing|correlation'`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/utils/traceIdFromCorrelation.js \
        demo_api_server/utils/outboundTracing.js \
        demo_api_server/tests/traceIdFromCorrelation.test.js
git commit -m "feat(tracing): extract deterministic trace-id derivation from correlation id"
```

---

### Task 2: mcp-server reads correlation from HTTP headers

**Files:**
- Modify: `demo_mcp_server/src/server/correlationFromMessage.ts` (full rewrite, 15 lines)
- Modify: `demo_mcp_server/src/server/HttpMCPTransport.ts:544`
- Test: `demo_mcp_server/tests/correlation-binding.test.ts` (extend existing)

**Interfaces:**
- Consumes: nothing.
- Produces: `correlationFromMessage(msg: RpcLike | undefined, headers?: Record<string, string | string[] | undefined>) => string`. The second parameter is new and optional; the WebSocket call site in `BankingMCPServer.ts:339` keeps working unchanged because it has no `req` in scope.

Today `correlationFromMessage` reads `params.correlationId` then falls back to the JSON-RPC `id`. Any HTTP call without that RPC param gets a fresh unrelated id — this is the single biggest break in end-to-end correlation.

- [ ] **Step 1: Write the failing test**

Replace `demo_mcp_server/tests/correlation-binding.test.ts` with:

```ts
import { correlationFromMessage } from '../src/server/correlationFromMessage';
import { getCorrelationId, runWithCorrelation } from '../src/utils/correlationContext';

describe('mcp-server correlation extraction', () => {
  it('reads params.correlationId, then id, else generates', () => {
    expect(correlationFromMessage({ params: { correlationId: 'P' } })).toBe('P');
    expect(correlationFromMessage({ id: 42 })).toBe('42');
    expect(correlationFromMessage({ id: 'rpc-x' })).toBe('rpc-x');
    const gen = correlationFromMessage({});
    expect(typeof gen).toBe('string');
    expect(gen.length).toBeGreaterThan(0);
    expect(typeof correlationFromMessage(undefined)).toBe('string');
  });

  it('reads x-correlation-id from headers when params.correlationId is absent', () => {
    expect(correlationFromMessage({ id: 7 }, { 'x-correlation-id': 'H1' })).toBe('H1');
  });

  it('falls back to x-request-id when x-correlation-id is absent', () => {
    expect(correlationFromMessage({ id: 7 }, { 'x-request-id': 'H2' })).toBe('H2');
  });

  it('prefers an explicit params.correlationId over the header', () => {
    expect(correlationFromMessage({ params: { correlationId: 'P' } }, { 'x-correlation-id': 'H' })).toBe('P');
  });

  it('prefers a header over the JSON-RPC id — the id is a local counter, not a correlation', () => {
    expect(correlationFromMessage({ id: 1 }, { 'x-correlation-id': 'H' })).toBe('H');
  });

  it('ignores empty and array-valued headers', () => {
    expect(correlationFromMessage({ id: 5 }, { 'x-correlation-id': '' })).toBe('5');
    expect(correlationFromMessage({ id: 5 }, { 'x-correlation-id': ['a', 'b'] })).toBe('5');
  });

  it('getCorrelationId reflects a runWithCorrelation scope', async () => {
    await runWithCorrelation('mcp-1', async () => {
      expect(getCorrelationId()).toBe('mcp-1');
    });
    expect(getCorrelationId()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_server && NODE_ENV=test npx jest tests/correlation-binding.test.ts --forceExit`
Expected: FAIL — the header tests return `'7'` / `'5'` instead of `'H1'` / `'H2'`.

- [ ] **Step 3: Rewrite `correlationFromMessage`**

Replace `demo_mcp_server/src/server/correlationFromMessage.ts` entirely:

```ts
import { randomUUID } from 'crypto';

interface RpcLike {
  id?: unknown;
  params?: { correlationId?: unknown };
}

type HeaderBag = Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderBag | undefined, name: string): string | undefined {
  const raw = headers?.[name];
  return typeof raw === 'string' && raw ? raw : undefined;
}

/**
 * Resolve the correlation id for an inbound MCP message.
 *
 * Precedence: explicit RPC param → inbound HTTP header → JSON-RPC id → fresh UUID.
 *
 * The header leg is what makes BFF → gateway → mcp-server correlation survive
 * over HTTP: the gateway stamps X-Correlation-ID on every proxied call, but
 * only some call sites also inject params.correlationId. The JSON-RPC id ranks
 * BELOW the header because it is a per-connection counter, not a correlation.
 */
export function correlationFromMessage(msg: RpcLike | undefined, headers?: HeaderBag): string {
  const p = msg?.params?.correlationId;
  if (typeof p === 'string' && p) return p;

  const fromHeader =
    headerValue(headers, 'x-correlation-id') ?? headerValue(headers, 'x-request-id');
  if (fromHeader) return fromHeader;

  const id = msg?.id;
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number') return String(id);
  return randomUUID();
}
```

- [ ] **Step 4: Pass headers at the HTTP call site**

In `demo_mcp_server/src/server/HttpMCPTransport.ts`, line 544 currently reads:

```ts
    const correlationId = correlationFromMessage(message as any);
```

Replace with:

```ts
    const correlationId = correlationFromMessage(message as any, req.headers);
```

`req` is in scope for the whole of `handlePost` (declared line 404; `req.headers` is already read at line 524). Leave `BankingMCPServer.ts:339` unchanged — the WebSocket path has no request object, and the new parameter is optional.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_mcp_server && NODE_ENV=test npx jest tests/correlation-binding.test.ts --forceExit`
Expected: PASS, 7 tests.

Run: `cd demo_mcp_server && npx tsc --noEmit`
Expected: no output (clean).

Run: `cd demo_mcp_server && NODE_ENV=test npx jest tests/server/HttpMCPTransport.test.ts --forceExit`
Expected: PASS — no regression in the transport suite.

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_server/src/server/correlationFromMessage.ts \
        demo_mcp_server/src/server/HttpMCPTransport.ts \
        demo_mcp_server/tests/correlation-binding.test.ts
git commit -m "fix(mcp-server): read correlation id from HTTP headers, not just RPC params"
```

---

### Task 3: agent-service binds spans to correlation

**Files:**
- Modify: `demo_agent_service/src/agentRunHandler.ts:1-16`, `:266-290`, `:361-390`, `:483-492`
- Test: `demo_agent_service/tests/agentRunHandler.correlation.test.ts`

**Interfaces:**
- Consumes: `runWithCorrelation`, `getCorrelationId` from `./correlationContext` (existing).
- Produces: `correlationIdFromRequest(headers, body) => string` exported from `agentRunHandler.ts`, so the test can assert precedence without driving a full SSE run.

Three defects here: `agentRunHandler.ts` never imports `correlationContext` (so its spans carry no correlation), spans use bare `tracer.startSpan()` with no `context.with` (so `reasoning-step-N` and `tool-execution` are not parented to `agent-run-request`), and on the reasoning `catch` path the `span` const is out of scope and never `.end()`ed.

- [ ] **Step 1: Write the failing test**

Create `demo_agent_service/tests/agentRunHandler.correlation.test.ts`:

```ts
import { correlationIdFromRequest } from '../src/agentRunHandler';

describe('agentRunHandler correlation resolution', () => {
  it('prefers the x-correlation-id header', () => {
    expect(correlationIdFromRequest({ 'x-correlation-id': 'H' }, { context: { correlationId: 'B' } })).toBe('H');
  });

  it('falls back to context.correlationId in the body', () => {
    expect(correlationIdFromRequest({}, { context: { correlationId: 'B' } })).toBe('B');
  });

  it('falls back to a top-level body correlationId', () => {
    expect(correlationIdFromRequest({}, { correlationId: 'T' })).toBe('T');
  });

  it('generates a uuid when nothing is supplied', () => {
    const out = correlationIdFromRequest({}, {});
    expect(out).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores an array-valued header', () => {
    expect(correlationIdFromRequest({ 'x-correlation-id': ['a', 'b'] as any }, { correlationId: 'T' })).toBe('T');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_agent_service && npx jest tests/agentRunHandler.correlation.test.ts --forceExit`
Expected: FAIL — `correlationIdFromRequest is not a function`.

- [ ] **Step 3: Add imports and the resolver**

In `demo_agent_service/src/agentRunHandler.ts`, replace the import block at lines 1-8 with:

```ts
import { Request, Response } from 'express';
import { randomUUID, timingSafeEqual } from 'crypto';
import { context as otelContext, trace } from '@opentelemetry/api';
import { EventType } from '@ag-ui/core';
import { reasonOnce } from './reasoningGraph';
import { runWithCorrelation, getCorrelationId } from './correlationContext';
import type { ReasonMessage, ReasonResponse, ReasonToolSchema } from './reasonContract';

const tracer = trace.getTracer('banking-agent-service');

/**
 * Resolve the correlation id for an agent run.
 *
 * Precedence: inbound header → body context → top-level body field → fresh UUID.
 * Mirrors reasonRoute.ts so both agent-service entry points agree.
 */
export function correlationIdFromRequest(
  headers: Record<string, string | string[] | undefined>,
  body: { correlationId?: unknown; context?: { correlationId?: unknown } } | undefined,
): string {
  const h = headers?.['x-correlation-id'];
  if (typeof h === 'string' && h) return h;
  const fromContext = body?.context?.correlationId;
  if (typeof fromContext === 'string' && fromContext) return fromContext;
  const fromBody = body?.correlationId;
  if (typeof fromBody === 'string' && fromBody) return fromBody;
  return randomUUID();
}
```

- [ ] **Step 4: Wrap the handler body in a correlation scope and parent the spans**

In `makeAgentRunHandler` (around line 266), replace:

```ts
    const requestSpan = tracer.startSpan('agent-run-request', {
      attributes: { 'http.method': 'POST', 'http.url': '/run' },
    });

    try {
```

with:

```ts
    const correlationId = correlationIdFromRequest(req.headers, req.body);
    const requestSpan = tracer.startSpan('agent-run-request', {
      attributes: {
        'http.method': 'POST',
        'http.url': '/run',
        // Joins this Jaeger trace to the ledger record and to every log line.
        correlation_id: correlationId,
      },
    });
    // Child spans are started inside this context so reasoning-step-N and
    // tool-execution parent to agent-run-request instead of attaching to
    // whatever ambient auto-instrumented HTTP span happens to be active.
    const runContext = trace.setSpan(otelContext.active(), requestSpan);

    return runWithCorrelation(correlationId, async () => {
    try {
```

Find the `finally` block that ends the handler (the one containing `requestSpan.end()`, around line 576) and close the new arrow function immediately after it:

```ts
    } finally {
      requestSpan.end();
    }
    });
  };
}
```

- [ ] **Step 5: Parent and correlate the reasoning span, and end it on the error path**

Replace the reasoning-span block (around line 361) — note `span` moves out of the `try` so the `catch` can end it:

```ts
      let reasonResult: ReasonResponse | undefined;
      const span = tracer.startSpan(`reasoning-step-${iter + 1}`, undefined, runContext);
      span.setAttribute('iteration', iter + 1);
      span.setAttribute('message_count', conversationMessages.length);
      span.setAttribute('provider', provider ?? process.env.AGENT_PROVIDER ?? 'anthropic');
      span.setAttribute('correlation_id', getCorrelationId() ?? '');
      try {
        reasonResult = await reasonOnce({
```

Then in the same block, delete the four lines that previously started and configured the span inside the `try` (`const span = tracer.startSpan(...)` through the third `span.setAttribute('provider', ...)`), keep the `input_tokens` / `output_tokens` attribute writes and the `span.end()` where they are, and change the `catch` to end the span before returning:

```ts
      } catch (err) {
        span.end();
        emit(res, { type: EventType.RUN_ERROR, message: 'Reasoning failed: ' + String(err), code: 'REASONING_ERROR' });
        res.end();
        return;
      }
```

- [ ] **Step 6: Parent and correlate the tool span**

Replace the tool-span lines (around line 483):

```ts
          const toolSpan = tracer.startSpan('tool-execution', undefined, runContext);
          toolSpan.setAttribute('tool_name', call.name);
          toolSpan.setAttribute('tool_call_id', callId);
          toolSpan.setAttribute('correlation_id', getCorrelationId() ?? '');
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd demo_agent_service && npx jest tests/agentRunHandler.correlation.test.ts --forceExit`
Expected: PASS, 5 tests.

Run: `cd demo_agent_service && npx tsc --noEmit`
Expected: no output (clean). This gate matters — a tsc failure silently keeps the OLD Docker image.

Run: `cd demo_agent_service && npx jest --forceExit`
Expected: PASS — full suite, no regression.

- [ ] **Step 8: Commit**

```bash
git add demo_agent_service/src/agentRunHandler.ts \
        demo_agent_service/tests/agentRunHandler.correlation.test.ts
git commit -m "fix(agent-service): bind run spans to correlation ALS and parent child spans"
```

---

## Phase P1 — Ledger

### Task 4: Transaction ledger store

**Files:**
- Create: `demo_api_server/services/lmdb/transactionLedger.lmdb.js`
- Test: `demo_api_server/tests/services/transactionLedger.test.js`

**Interfaces:**
- Consumes: `getDb` from `./openEnv` (existing).
- Produces:
  - `appendHop(correlationId: string, hop: object) => object` — returns the updated record; assigns `seq` (1-based) and `ts` when absent.
  - `getRecord(correlationId: string) => object | null` — `{ correlationId, startedAt, endedAt, hops: [] }`.
  - `listRecords({ limit?: number }) => object[]` — newest-first summaries `{ correlationId, startedAt, endedAt, hopCount }`.
  - `clear() => void`, `DB_NAME`, `MAX_TRANSACTIONS`.

Keyed by `correlationId` directly rather than `mcpAuditStore`'s time-prefixed key, because hops arrive out of order across services and must land in one record. Ordering and eviction do a full scan, which is why the cap is low (500).

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/services/transactionLedger.test.js`. The LMDB fake implements `getKeys` and `getStats` in addition to the usual four — the existing fake in `tests/verticalManifest/verticalStore.lmdb.test.js` omits them, which would silently break eviction:

```js
'use strict';

jest.mock('../../services/lmdb/openEnv', () => {
  const dbs = new Map();
  function openDB(name) {
    if (!dbs.has(name)) dbs.set(name, new Map());
    const m = dbs.get(name);
    return {
      get(key) { return m.has(key) ? m.get(key) : undefined; },
      putSync(key, value) { m.set(key, value); },
      removeSync(key) { m.delete(key); },
      getKeys() { return [...m.keys()]; },
      getStats() { return { entryCount: m.size }; },
      getRange({ reverse } = {}) {
        const out = [...m.entries()].map(([key, value]) => ({ key, value }));
        return reverse ? out.reverse() : out;
      },
    };
  }
  return {
    openEnv: () => ({ openDB }),
    getDb: (name) => openDB(name),
    LMDB_PATH: '/tmp/fake',
    __reset: () => dbs.clear(),
  };
});

const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const openEnvMock = require('../../services/lmdb/openEnv');

describe('transactionLedger', () => {
  beforeEach(() => { openEnvMock.__reset(); });

  test('getRecord returns null for an unknown correlation id', () => {
    expect(ledger.getRecord('nope')).toBeNull();
  });

  test('appendHop creates a record and assigns seq 1', () => {
    const rec = ledger.appendHop('c1', { service: 'demo-api-server', phase: 'ui.request' });
    expect(rec.correlationId).toBe('c1');
    expect(rec.hops).toHaveLength(1);
    expect(rec.hops[0].seq).toBe(1);
    expect(rec.hops[0].phase).toBe('ui.request');
    expect(typeof rec.hops[0].ts).toBe('string');
  });

  test('hops accumulate in arrival order with increasing seq', () => {
    ledger.appendHop('c1', { service: 'demo-api-server', phase: 'ui.request' });
    ledger.appendHop('c1', { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' });
    const rec = ledger.getRecord('c1');
    expect(rec.hops.map((h) => h.seq)).toEqual([1, 2]);
    expect(rec.hops.map((h) => h.phase)).toEqual(['ui.request', 'mcp.tool']);
  });

  test('a caller-supplied ts is preserved', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'mcp.tool', ts: '2026-07-18T00:00:00.000Z' });
    expect(ledger.getRecord('c1').hops[0].ts).toBe('2026-07-18T00:00:00.000Z');
  });

  test('endedAt advances as hops arrive but startedAt does not', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'ui.request' });
    const first = ledger.getRecord('c1');
    ledger.appendHop('c1', { service: 'y', phase: 'response' });
    const second = ledger.getRecord('c1');
    expect(second.startedAt).toBe(first.startedAt);
    expect(second.endedAt >= first.endedAt).toBe(true);
  });

  test('listRecords returns newest-first summaries', () => {
    ledger.appendHop('older', { service: 'x', phase: 'ui.request', ts: '2026-07-18T00:00:00.000Z' });
    ledger.appendHop('newer', { service: 'x', phase: 'ui.request', ts: '2026-07-18T01:00:00.000Z' });
    const list = ledger.listRecords();
    expect(list.map((r) => r.correlationId)).toEqual(['newer', 'older']);
    expect(list[0].hopCount).toBe(1);
  });

  test('listRecords honours limit', () => {
    for (let i = 0; i < 5; i++) ledger.appendHop(`c${i}`, { service: 'x', phase: 'ui.request' });
    expect(ledger.listRecords({ limit: 2 })).toHaveLength(2);
  });

  test('evicts the oldest transactions past MAX_TRANSACTIONS', () => {
    for (let i = 0; i < ledger.MAX_TRANSACTIONS + 3; i++) {
      ledger.appendHop(`c${String(i).padStart(4, '0')}`, {
        service: 'x',
        phase: 'ui.request',
        ts: `2026-07-18T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`,
      });
    }
    expect(ledger.listRecords({ limit: 10000 })).toHaveLength(ledger.MAX_TRANSACTIONS);
    expect(ledger.getRecord('c0000')).toBeNull();
  });

  test('appending to an existing transaction does not trigger eviction', () => {
    for (let i = 0; i < ledger.MAX_TRANSACTIONS; i++) ledger.appendHop(`c${i}`, { service: 'x', phase: 'ui.request' });
    ledger.appendHop('c0', { service: 'x', phase: 'response' });
    expect(ledger.getRecord('c0').hops).toHaveLength(2);
    expect(ledger.listRecords({ limit: 10000 })).toHaveLength(ledger.MAX_TRANSACTIONS);
  });

  test('clear wipes the store', () => {
    ledger.appendHop('c1', { service: 'x', phase: 'ui.request' });
    ledger.clear();
    expect(ledger.getRecord('c1')).toBeNull();
    expect(ledger.listRecords()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionLedger.test.js`
Expected: FAIL — `Cannot find module '../../services/lmdb/transactionLedger.lmdb'`

- [ ] **Step 3: Write the store**

Create `demo_api_server/services/lmdb/transactionLedger.lmdb.js`:

```js
'use strict';
/**
 * transactionLedger.lmdb.js — durable per-transaction chain of custody.
 *
 * One record per correlationId, holding every hop a request took across the
 * six instrumentable services. This is the PRIMARY witness: the invariant
 * engine (services/transactionInvariants.js) evaluates it, and the reconciler
 * (services/transactionReconciler.js) corroborates it against independently
 * written audit sinks.
 *
 * Keyed by correlationId — NOT by the time-prefixed key mcpAuditStore uses —
 * because hops for one transaction arrive out of order from six services and
 * must merge into a single record. Ordering and eviction therefore do a full
 * range scan, which is why MAX_TRANSACTIONS is deliberately small.
 *
 * Claims only. Never store raw tokens here: this record is presented as an
 * audit trail, unlike teachLogger where token visibility is a teaching feature.
 */
const { getDb } = require('./openEnv');

const DB_NAME = 'transactionLedger';
const MAX_TRANSACTIONS = 500;

function _db() {
  return getDb(DB_NAME); // cached handle, mirrors mcpAuditStore.lmdb.js
}

/**
 * Append a hop to its transaction, creating the record on first hop.
 * @param {string} correlationId
 * @param {object} hop
 * @returns {object} the updated record
 */
function appendHop(correlationId, hop) {
  const db = _db();
  const now = new Date().toISOString();
  const existing = db.get(correlationId) || null;
  const record = existing || { correlationId, startedAt: now, endedAt: now, hops: [] };

  record.hops.push({ ...hop, seq: record.hops.length + 1, ts: hop.ts || now });
  record.endedAt = now;
  db.putSync(correlationId, record);

  // Only a NEW transaction can push the store over the cap — appending to an
  // existing record leaves the count unchanged, so skip the scan.
  if (!existing) _evict(db);
  return record;
}

function _evict(db) {
  let count;
  try {
    count = db.getStats().entryCount;
  } catch {
    return; // getStats unavailable — skip eviction rather than scan every write
  }
  if (count <= MAX_TRANSACTIONS) return;

  const entries = [];
  for (const { key, value } of db.getRange()) {
    entries.push({ key, startedAt: (value && value.startedAt) || '' });
  }
  entries.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  for (const e of entries.slice(0, entries.length - MAX_TRANSACTIONS)) db.removeSync(e.key);
}

/**
 * @param {string} correlationId
 * @returns {object|null}
 */
function getRecord(correlationId) {
  const rec = _db().get(correlationId);
  return rec || null;
}

/**
 * Newest-first transaction summaries.
 * @param {object} [opts]
 * @param {number} [opts.limit=100]
 * @returns {object[]} [{ correlationId, startedAt, endedAt, hopCount }]
 */
function listRecords(opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 100;
  const out = [];
  for (const { value } of _db().getRange()) {
    if (!value) continue;
    out.push({
      correlationId: value.correlationId,
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      hopCount: Array.isArray(value.hops) ? value.hops.length : 0,
    });
  }
  out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return out.slice(0, limit);
}

function clear() {
  const db = _db();
  for (const key of db.getKeys()) db.removeSync(key);
}

module.exports = { appendHop, getRecord, listRecords, clear, DB_NAME, MAX_TRANSACTIONS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionLedger.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/lmdb/transactionLedger.lmdb.js \
        demo_api_server/tests/services/transactionLedger.test.js
git commit -m "feat(ledger): add per-transaction chain-of-custody LMDB store"
```

---

### Task 5: Hop ingest endpoint

**Files:**
- Create: `demo_api_server/routes/transactionHopIngest.js`
- Modify: `demo_api_server/server.js:1229` (next to the `/internal/mcp-audit` mount)
- Test: `demo_api_server/tests/routes/transactionHopIngest.test.js`

**Interfaces:**
- Consumes: `appendHop` from Task 4.
- Produces: `POST /internal/transaction-hop`. Request body is a `TransactionHop` plus `correlationId`. Responses: `204` accepted, `400 {error:'invalid_hop'}`, `403 {error:'forbidden'}`. Remote emitters in Tasks 7-9 target this contract.

Mirrors `routes/mcpAuditIngest.js` exactly: not under `/api/*`, shared-secret guarded, constant-time comparison, and persistence failures swallow to `204` so auditing never breaks a caller's request path.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/routes/transactionHopIngest.test.js`:

```js
'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  appendHop: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const router = require('../../routes/transactionHopIngest');

const SECRET = process.env.BFF_INTERNAL_SECRET || 'dev-shared-secret-change-me';

function app() {
  const a = express();
  a.use('/internal', router);
  return a;
}

const VALID = {
  correlationId: 'c1',
  service: 'mcp-server',
  phase: 'mcp.tool',
  op: 'get_balance',
};

describe('POST /internal/transaction-hop', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('403 without the internal secret', async () => {
    const res = await request(app()).post('/internal/transaction-hop').send(VALID);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('403 with a wrong secret', async () => {
    const res = await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', 'nope')
      .send(VALID);
    expect(res.status).toBe(403);
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('204 and persists a valid hop', async () => {
    const res = await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', SECRET)
      .send(VALID);
    expect(res.status).toBe(204);
    expect(ledger.appendHop).toHaveBeenCalledWith('c1', expect.objectContaining({
      service: 'mcp-server',
      phase: 'mcp.tool',
      op: 'get_balance',
    }));
  });

  test('400 when correlationId is missing', async () => {
    const res = await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', SECRET)
      .send({ service: 'x', phase: 'mcp.tool' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_hop' });
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('400 on an unknown phase', async () => {
    const res = await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', SECRET)
      .send({ correlationId: 'c1', service: 'x', phase: 'not.a.phase' });
    expect(res.status).toBe(400);
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('strips raw token fields before persisting', async () => {
    await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', SECRET)
      .send({
        ...VALID,
        identity: { sub: 'u1', jti: 'j1', access_token: 'eyJraw', subject_token: 'eyJraw2' },
      });
    const [, hop] = ledger.appendHop.mock.calls[0];
    expect(hop.identity.sub).toBe('u1');
    expect(hop.identity.jti).toBe('j1');
    expect(hop.identity.access_token).toBeUndefined();
    expect(hop.identity.subject_token).toBeUndefined();
  });

  test('204 even when the store throws — auditing never breaks the caller', async () => {
    ledger.appendHop.mockImplementation(() => { throw new Error('lmdb down'); });
    const res = await request(app())
      .post('/internal/transaction-hop')
      .set('x-internal-gateway-secret', SECRET)
      .send(VALID);
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/routes/transactionHopIngest.test.js`
Expected: FAIL — `Cannot find module '../../routes/transactionHopIngest'`

- [ ] **Step 3: Write the route**

Create `demo_api_server/routes/transactionHopIngest.js`:

```js
'use strict';
/**
 * /internal/transaction-hop — service-to-service hop ingest.
 *
 * Every instrumentable service ships one hop per phase of a transaction here,
 * fire-and-forget, so the BFF can assemble a complete chain of custody. Mirrors
 * the trust model of /internal/mcp-audit:
 *   - NOT mounted under /api/* (browser-facing prefix)
 *   - requires x-internal-gateway-secret matching BFF_INTERNAL_SECRET
 *   - constant-time secret comparison
 *
 * Status codes:
 *   204  accepted (no body)
 *   400  invalid_hop  — missing correlationId/service, or unknown phase
 *   403  forbidden    — missing or wrong x-internal-gateway-secret
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const ledger = require('../services/lmdb/transactionLedger.lmdb');

// Must match demo_mcp_gateway/src/config.ts DEFAULT_BFF_INTERNAL_SECRET and
// routes/agentIdToken.js. Production startup refuses this literal elsewhere.
const DEFAULT_INTERNAL_SECRET = 'dev-shared-secret-change-me';
const INTERNAL_SECRET = process.env.BFF_INTERNAL_SECRET || DEFAULT_INTERNAL_SECRET;
const INTERNAL_SECRET_BUF = Buffer.from(INTERNAL_SECRET);

const VALID_PHASES = new Set([
  'ui.request',
  'agent.reason',
  'token.exchange',
  'gateway.authorize',
  'authz.decision',
  'hitl.consent',
  'mcp.tool',
  'response',
]);

// The ledger is presented as an audit record, so raw credentials must never
// land in it — unlike teachLogger, where token visibility is a teaching
// feature. Claims and the jti survive; token values do not.
const TOKEN_KEYS = new Set([
  'access_token', 'refresh_token', 'id_token', 'subject_token', 'actor_token',
  'authorization', 'token', 'client_secret',
]);

function stripTokens(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (TOKEN_KEYS.has(k.toLowerCase())) continue;
    out[k] = v && typeof v === 'object' ? stripTokens(v, depth + 1) : v;
  }
  return out;
}

function _secretOk(presented) {
  const buf = typeof presented === 'string' ? Buffer.from(presented) : null;
  return (
    !!buf &&
    buf.length === INTERNAL_SECRET_BUF.length &&
    crypto.timingSafeEqual(buf, INTERNAL_SECRET_BUF)
  );
}

router.post('/transaction-hop', express.json({ limit: '64kb' }), (req, res) => {
  if (!_secretOk(req.headers['x-internal-gateway-secret'])) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const body = req.body;
  if (
    !body ||
    typeof body !== 'object' ||
    typeof body.correlationId !== 'string' ||
    !body.correlationId ||
    typeof body.service !== 'string' ||
    !body.service ||
    !VALID_PHASES.has(body.phase)
  ) {
    return res.status(400).json({ error: 'invalid_hop' });
  }

  const { correlationId, ...hop } = body;
  try {
    ledger.appendHop(correlationId, stripTokens(hop));
  } catch (err) {
    // Auditing must never break a caller's request path — swallow and 204.
    // eslint-disable-next-line no-console
    console.warn('[transactionHopIngest] failed to persist hop:', err?.message);
  }
  return res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 4: Mount it**

In `demo_api_server/server.js`, immediately after the `/internal/mcp-audit` mount (line 1229), add:

```js
// Transaction chain of custody — every instrumentable service ships one hop
// per phase here so the BFF can assemble the full chain. Secret-guarded;
// NOT browser-facing. Read back at /api/transaction-trace.
app.use('/internal', require('./routes/transactionHopIngest'));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/routes/transactionHopIngest.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/transactionHopIngest.js \
        demo_api_server/server.js \
        demo_api_server/tests/routes/transactionHopIngest.test.js
git commit -m "feat(ledger): add secret-guarded /internal/transaction-hop ingest"
```

---

### Task 6: BFF emitter, turn middleware, and read route

**Files:**
- Create: `demo_api_server/services/transactionHop.js`
- Create: `demo_api_server/middleware/transactionTurn.js`
- Create: `demo_api_server/routes/transactionTrace.js`
- Modify: `demo_api_server/server.js:1056`, `:1071`, and the `/api/*` mount block
- Test: `demo_api_server/tests/services/transactionHop.test.js`, `demo_api_server/tests/routes/transactionTrace.test.js`

**Interfaces:**
- Consumes: `appendHop`, `getRecord`, `listRecords` (Task 4); `getCorrelationId` from `utils/correlationContext`; `traceIdFromCorrelation` (Task 1).
- Produces:
  - `emitHop(hop: object) => void` — in-process, never throws, resolves correlationId from ALS when absent.
  - `transactionTurnMiddleware(req, res, next)` — emits `ui.request` on entry and `response` on `res` finish.
  - `GET /api/transaction-trace?limit=` → `{ transactions: [{correlationId, startedAt, endedAt, hopCount}] }`
  - `GET /api/transaction-trace/:correlationId` → `{ correlationId, traceId, startedAt, endedAt, hops: [] }` or `404 {error:'not_found'}`. Tasks 11-13 add `verdict` and `reconciliation` to this payload.

This task ends with a demoable slice: hit the agent, then `curl` the trace.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/services/transactionHop.test.js`:

```js
'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  appendHop: jest.fn(),
}));

const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const { emitHop } = require('../../services/transactionHop');
const { runWithCorrelation } = require('../../utils/correlationContext');

describe('emitHop', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('resolves the correlation id from AsyncLocalStorage', () => {
    runWithCorrelation('c-als', () => {
      emitHop({ phase: 'ui.request' });
    });
    expect(ledger.appendHop).toHaveBeenCalledWith('c-als', expect.objectContaining({
      phase: 'ui.request',
      service: 'demo-api-server',
    }));
  });

  test('an explicit correlationId overrides the ALS value', () => {
    runWithCorrelation('c-als', () => {
      emitHop({ correlationId: 'c-explicit', phase: 'response' });
    });
    expect(ledger.appendHop).toHaveBeenCalledWith('c-explicit', expect.anything());
  });

  test('no-ops outside a correlation scope rather than inventing an id', () => {
    emitHop({ phase: 'ui.request' });
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('a caller-supplied service is preserved', () => {
    runWithCorrelation('c1', () => emitHop({ phase: 'mcp.tool', service: 'other' }));
    expect(ledger.appendHop).toHaveBeenCalledWith('c1', expect.objectContaining({ service: 'other' }));
  });

  test('swallows a store failure — emission is fail-open', () => {
    ledger.appendHop.mockImplementation(() => { throw new Error('lmdb down'); });
    expect(() => runWithCorrelation('c1', () => emitHop({ phase: 'ui.request' }))).not.toThrow();
  });
});
```

Create `demo_api_server/tests/routes/transactionTrace.test.js`:

```js
'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  getRecord: jest.fn(),
  listRecords: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const router = require('../../routes/transactionTrace');

function app() {
  const a = express();
  a.use('/api/transaction-trace', router);
  return a;
}

describe('GET /api/transaction-trace', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('lists transactions newest-first', async () => {
    ledger.listRecords.mockReturnValue([
      { correlationId: 'c2', startedAt: 'B', endedAt: 'B', hopCount: 3 },
      { correlationId: 'c1', startedAt: 'A', endedAt: 'A', hopCount: 6 },
    ]);
    const res = await request(app()).get('/api/transaction-trace');
    expect(res.status).toBe(200);
    expect(res.body.transactions.map((t) => t.correlationId)).toEqual(['c2', 'c1']);
  });

  test('passes limit through to the store', async () => {
    ledger.listRecords.mockReturnValue([]);
    await request(app()).get('/api/transaction-trace?limit=5');
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: 5 });
  });

  test('ignores a non-numeric limit', async () => {
    ledger.listRecords.mockReturnValue([]);
    await request(app()).get('/api/transaction-trace?limit=abc');
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: undefined });
  });

  test('404 for an unknown correlation id', async () => {
    ledger.getRecord.mockReturnValue(null);
    const res = await request(app()).get('/api/transaction-trace/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  test('returns the record with a derived traceId', async () => {
    ledger.getRecord.mockReturnValue({
      correlationId: '3d5b456e-9de9-4091-850b-2d04fd0948b6',
      startedAt: 'A',
      endedAt: 'B',
      hops: [{ seq: 1, phase: 'ui.request', service: 'demo-api-server' }],
    });
    const res = await request(app()).get('/api/transaction-trace/3d5b456e-9de9-4091-850b-2d04fd0948b6');
    expect(res.status).toBe(200);
    expect(res.body.traceId).toBe('3d5b456e9de94091850b2d04fd0948b6');
    expect(res.body.hops).toHaveLength(1);
  });

  test('degrades to an empty list when the store throws', async () => {
    ledger.listRecords.mockImplementation(() => { throw new Error('lmdb down'); });
    const res = await request(app()).get('/api/transaction-trace');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ transactions: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionHop.test.js tests/routes/transactionTrace.test.js`
Expected: FAIL — both modules missing.

- [ ] **Step 3: Write the emitter**

Create `demo_api_server/services/transactionHop.js`:

```js
'use strict';
/**
 * BFF in-process transaction-hop emitter.
 *
 * The BFF writes straight to the ledger — no HTTP round trip, unlike the
 * remote services which POST to /internal/transaction-hop. Fail-open by
 * contract: a dead ledger drops hops and never disturbs the request path.
 */
const ledger = require('./lmdb/transactionLedger.lmdb');
const { getCorrelationId } = require('../utils/correlationContext');

const SERVICE = 'demo-api-server';

/**
 * @param {object} hop  { phase, op?, identity?, decision?, durationMs?, status?, correlationId?, service? }
 */
function emitHop(hop) {
  try {
    const correlationId = hop.correlationId || getCorrelationId();
    // No correlation scope means we cannot attribute this hop to a
    // transaction. Minting an id here would create orphan single-hop records
    // that look like incomplete transactions in the UI.
    if (!correlationId) return;
    const { correlationId: _ignored, ...rest } = hop;
    ledger.appendHop(correlationId, { service: SERVICE, ...rest });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[transactionHop] emit failed:', err?.message);
  }
}

module.exports = { emitHop, SERVICE };
```

- [ ] **Step 4: Write the turn middleware**

Create `demo_api_server/middleware/transactionTurn.js`:

```js
'use strict';
/**
 * Marks the boundaries of one agent turn in the transaction ledger.
 *
 * Mounted only on the two agent-turn entry points (/api/demo-agent and
 * /api/agent) — NOT app-wide. The traced unit is an agent turn; stamping every
 * inbound request would fill the 500-transaction cap with health checks and
 * static asset fetches.
 */
const { emitHop } = require('../services/transactionHop');

function transactionTurnMiddleware(req, res, next) {
  const startedAt = Date.now();

  emitHop({
    phase: 'ui.request',
    op: `${req.method} ${req.baseUrl}${req.path}`,
    identity: {
      sub: req.session?.user?.sub || req.user?.id || null,
      sessionId: req.sessionID || null,
    },
    status: 'ok',
  });

  res.on('finish', () => {
    emitHop({
      phase: 'response',
      op: `${res.statusCode}`,
      durationMs: Date.now() - startedAt,
      status: res.statusCode >= 400 ? 'error' : 'ok',
    });
  });

  next();
}

module.exports = { transactionTurnMiddleware };
```

- [ ] **Step 5: Write the read route**

Create `demo_api_server/routes/transactionTrace.js`:

```js
'use strict';
/**
 * /api/transaction-trace — chain-of-custody read API.
 *
 * Named transaction-trace, not transactions: /api/transactions is already the
 * banking transactions API (server.js:1239).
 *
 * Tasks 11-13 extend the detail payload with `verdict` (invariant engine) and
 * `reconciliation` (second-witness join). Both are computed at read time, so
 * neither is stored.
 */
const express = require('express');
const router = express.Router();
const ledger = require('../services/lmdb/transactionLedger.lmdb');
const { traceIdFromCorrelation } = require('../utils/traceIdFromCorrelation');

router.get('/', (req, res) => {
  const parsed = parseInt(String(req.query.limit), 10);
  try {
    const transactions = ledger.listRecords({
      limit: Number.isFinite(parsed) ? parsed : undefined,
    });
    return res.json({ transactions });
  } catch (err) {
    // A read failure degrades to an empty list, not a 500 that breaks the page.
    console.warn('[transactionTrace] list failed:', err?.message);
    return res.json({ transactions: [] });
  }
});

router.get('/:correlationId', (req, res) => {
  let record;
  try {
    record = ledger.getRecord(req.params.correlationId);
  } catch (err) {
    console.warn('[transactionTrace] read failed:', err?.message);
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!record) return res.status(404).json({ error: 'not_found' });

  return res.json({
    ...record,
    traceId: traceIdFromCorrelation(record.correlationId),
  });
});

module.exports = router;
```

- [ ] **Step 6: Wire the middleware and route into `server.js`**

Add the require next to the other middleware requires near the top of the file:

```js
const { transactionTurnMiddleware } = require('./middleware/transactionTurn');
```

Change line 1056 from:

```js
app.use('/api/demo-agent', demoAgentRoutes);
```

to:

```js
app.use('/api/demo-agent', transactionTurnMiddleware, demoAgentRoutes);
```

Change line 1071 from:

```js
app.use('/api/agent', delegationGate, agentRunRoutes); // AG-UI Step 2: /api/agent/run
```

to:

```js
app.use('/api/agent', delegationGate, transactionTurnMiddleware, agentRunRoutes); // AG-UI Step 2: /api/agent/run
```

Then mount the read route alongside the other authenticated `/api/*` routes (next to the `/api/token-chain` mount at line 1283):

```js
// Transaction chain of custody — read side. Any logged-in user, matching the
// accessibility of its Telemetry sibling (the Tracing page).
app.use('/api/transaction-trace', authenticateToken, require('./routes/transactionTrace'));
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionHop.test.js tests/routes/transactionTrace.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/services/transactionHop.js \
        demo_api_server/middleware/transactionTurn.js \
        demo_api_server/routes/transactionTrace.js \
        demo_api_server/server.js \
        demo_api_server/tests/services/transactionHop.test.js \
        demo_api_server/tests/routes/transactionTrace.test.js
git commit -m "feat(ledger): emit BFF turn hops and expose /api/transaction-trace"
```

---

### Task 7: Remote emitters — agent-service, gateway, mcp-server

**Files:**
- Create: `demo_agent_service/src/transactionHop.ts`, `demo_mcp_gateway/src/transactionHop.ts`, `demo_mcp_server/src/utils/transactionHop.ts`
- Modify: `demo_agent_service/src/agentRunHandler.ts` (reasoning + tool blocks), `demo_mcp_gateway/src/gatewayAudit.ts`, `demo_mcp_server/src/server/HttpMCPTransport.ts`
- Test: `demo_agent_service/tests/transactionHop.test.ts`, `demo_mcp_gateway/tests/transactionHop.test.ts`, `demo_mcp_server/tests/transactionHop.test.ts`

**Interfaces:**
- Consumes: `POST /internal/transaction-hop` (Task 5); each service's own `getCorrelationId`.
- Produces: `emitHop(hop: TransactionHopInput) => void` in each service — fire-and-forget, never throws, never awaited.

The three emitters are byte-identical apart from the `SERVICE` constant and the import path for `correlationContext`. Repeated in full below because the implementer may read tasks out of order.

- [ ] **Step 1: Write the failing test (agent-service)**

Create `demo_agent_service/tests/transactionHop.test.ts`:

```ts
import { emitHop, __setFetchForTests } from '../src/transactionHop';
import { runWithCorrelation } from '../src/correlationContext';

describe('agent-service emitHop', () => {
  const calls: Array<{ url: string; body: any; headers: any }> = [];

  beforeEach(() => {
    calls.length = 0;
    process.env.BFF_TRANSACTION_HOP_URL = 'http://bff/internal/transaction-hop';
    process.env.BFF_INTERNAL_SECRET = 'sekrit';
    __setFetchForTests(async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return { ok: true } as any;
    });
  });

  afterEach(() => {
    __setFetchForTests(undefined);
    delete process.env.BFF_TRANSACTION_HOP_URL;
    delete process.env.BFF_INTERNAL_SECRET;
  });

  it('posts a hop stamped with the ALS correlation id and the service name', async () => {
    runWithCorrelation('c1', () => emitHop({ phase: 'agent.reason', op: 'reasoning-step-1' }));
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://bff/internal/transaction-hop');
    expect(calls[0].body).toMatchObject({
      correlationId: 'c1',
      service: 'agent-service',
      phase: 'agent.reason',
      op: 'reasoning-step-1',
    });
    expect(calls[0].headers['x-internal-gateway-secret']).toBe('sekrit');
  });

  it('no-ops outside a correlation scope', async () => {
    emitHop({ phase: 'agent.reason' });
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);
  });

  it('no-ops when the ingest URL is unset', async () => {
    delete process.env.BFF_TRANSACTION_HOP_URL;
    runWithCorrelation('c1', () => emitHop({ phase: 'agent.reason' }));
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);
  });

  it('never throws when the transport rejects', async () => {
    __setFetchForTests(async () => { throw new Error('network down'); });
    expect(() => runWithCorrelation('c1', () => emitHop({ phase: 'agent.reason' }))).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_agent_service && npx jest tests/transactionHop.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../src/transactionHop'`

- [ ] **Step 3: Write the agent-service emitter**

Create `demo_agent_service/src/transactionHop.ts`:

```ts
import { getCorrelationId } from './correlationContext';

const SERVICE = 'agent-service';

export interface TransactionHopInput {
  phase:
    | 'ui.request' | 'agent.reason' | 'token.exchange' | 'gateway.authorize'
    | 'authz.decision' | 'hitl.consent' | 'mcp.tool' | 'response';
  op?: string;
  identity?: Record<string, unknown>;
  decision?: Record<string, unknown>;
  durationMs?: number;
  status?: 'ok' | 'error';
  correlationId?: string;
  params?: Record<string, unknown>;
  consentRequired?: boolean;
}

type FetchLike = (url: string, init: any) => Promise<any>;
let _fetch: FetchLike | undefined;

/** Test seam — inject a fetch double. Pass undefined to restore global fetch. */
export function __setFetchForTests(fn: FetchLike | undefined): void {
  _fetch = fn;
}

/**
 * Ship one transaction hop to the BFF ledger, fire-and-forget.
 *
 * Never awaited and never throws: a slow or dead BFF must not add latency to,
 * or fail, the agent run. Silently no-ops without a correlation scope rather
 * than minting an id, which would create orphan single-hop transactions.
 */
export function emitHop(hop: TransactionHopInput): void {
  try {
    const url = process.env.BFF_TRANSACTION_HOP_URL;
    const secret = process.env.BFF_INTERNAL_SECRET;
    if (!url || !secret) return;
    const correlationId = hop.correlationId ?? getCorrelationId();
    if (!correlationId) return;

    const doFetch = _fetch ?? (globalThis.fetch as unknown as FetchLike);
    if (!doFetch) return;

    doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-gateway-secret': secret },
      body: JSON.stringify({ ...hop, correlationId, service: SERVICE }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => { /* swallow — auditing must never break the run */ });
  } catch {
    /* swallow */
  }
}
```

- [ ] **Step 4: Emit hops from `agentRunHandler.ts`**

Add the import alongside the Task 3 imports:

```ts
import { emitHop } from './transactionHop';
```

Immediately after `span.end();` in the reasoning block (the successful path, around line 389), add:

```ts
        emitHop({
          phase: 'agent.reason',
          op: `reasoning-step-${iter + 1}`,
          status: 'ok',
        });
```

Immediately after `toolSpan.end();` (around line 492), add:

```ts
          emitHop({
            phase: 'agent.reason',
            op: `tool:${call.name}`,
            durationMs: mcpEntry?.durationMs,
            params: call.args as Record<string, unknown>,
            status: 'ok',
          });
```

- [ ] **Step 5: Write the gateway emitter**

Create `demo_mcp_gateway/src/transactionHop.ts` — identical to the agent-service file with two changes: `const SERVICE = 'mcp-gateway';` and `import { getCorrelationId } from './correlationContext';`:

```ts
import { getCorrelationId } from './correlationContext';

const SERVICE = 'mcp-gateway';

export interface TransactionHopInput {
  phase:
    | 'ui.request' | 'agent.reason' | 'token.exchange' | 'gateway.authorize'
    | 'authz.decision' | 'hitl.consent' | 'mcp.tool' | 'response';
  op?: string;
  identity?: Record<string, unknown>;
  decision?: Record<string, unknown>;
  durationMs?: number;
  status?: 'ok' | 'error';
  correlationId?: string;
  params?: Record<string, unknown>;
  consentRequired?: boolean;
}

type FetchLike = (url: string, init: any) => Promise<any>;
let _fetch: FetchLike | undefined;

/** Test seam — inject a fetch double. Pass undefined to restore global fetch. */
export function __setFetchForTests(fn: FetchLike | undefined): void {
  _fetch = fn;
}

/**
 * Ship one transaction hop to the BFF ledger, fire-and-forget.
 * Never awaited and never throws — auditing must never break the tool-call path.
 */
export function emitHop(hop: TransactionHopInput): void {
  try {
    const url = process.env.BFF_TRANSACTION_HOP_URL;
    const secret = process.env.BFF_INTERNAL_SECRET;
    if (!url || !secret) return;
    const correlationId = hop.correlationId ?? getCorrelationId();
    if (!correlationId) return;

    const doFetch = _fetch ?? (globalThis.fetch as unknown as FetchLike);
    if (!doFetch) return;

    doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-gateway-secret': secret },
      body: JSON.stringify({ ...hop, correlationId, service: SERVICE }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => { /* swallow */ });
  } catch {
    /* swallow */
  }
}
```

Copy `demo_agent_service/tests/transactionHop.test.ts` to `demo_mcp_gateway/tests/transactionHop.test.ts`, changing the two import paths to `'../src/transactionHop'` and `'../src/correlationContext'`, the describe title to `'gateway emitHop'`, and the expected `service` to `'mcp-gateway'`.

- [ ] **Step 6: Emit the gateway hop from `gatewayAudit.ts`**

`recordGatewayAudit` is already the single chokepoint every tool call passes through on both transports, so emitting from inside it gives complete coverage for free. Add the import:

```ts
import { emitHop } from './transactionHop';
```

Inside `recordGatewayAudit`, immediately after the `enriched` const is built and before the `axios.post`, add:

```ts
    // Same chokepoint, second consumer: the durable audit trail keeps its
    // existing shape while the ledger gets a hop with identity fields on it.
    emitHop({
      phase: 'gateway.authorize',
      op: enriched.operation,
      correlationId: enriched.correlationId,
      durationMs: enriched.duration,
      identity: { sub: enriched.userId ?? null, act: enriched.agentId ? [enriched.agentId] : [] },
      decision: {
        outcome: enriched.outcome === 'success' ? 'permit' : enriched.outcome === 'partial' ? 'n/a' : 'deny',
        by: 'gateway',
        reason: enriched.outcome,
      },
      status: enriched.outcome === 'failure' ? 'error' : 'ok',
    });
```

- [ ] **Step 7: Write the mcp-server emitter and call site**

Create `demo_mcp_server/src/utils/transactionHop.ts` — identical to the gateway file with `const SERVICE = 'mcp-server';` and `import { getCorrelationId } from './correlationContext';`.

Copy the test to `demo_mcp_server/tests/transactionHop.test.ts` with import paths `'../src/utils/transactionHop'` and `'../src/utils/correlationContext'`, describe title `'mcp-server emitHop'`, and expected `service` `'mcp-server'`.

In `demo_mcp_server/src/server/HttpMCPTransport.ts`, add the import next to the correlation imports at line 31:

```ts
import { emitHop } from '../utils/transactionHop';
```

Inside the `runWithCorrelation` callback (which begins at line 545), immediately after `const mcpResponse = await this.messageHandler.handleMessage(message, context);`, add:

```ts
      if (message.method === 'tools/call') {
        emitHop({
          phase: 'mcp.tool',
          op: String((message.params as any)?.name ?? 'unknown'),
          params: (message.params as any)?.arguments ?? {},
          status: mcpResponse?.error ? 'error' : 'ok',
        });
      }
```

- [ ] **Step 8: Wire the ingest URL into compose**

Each service already receives `BFF_INTERNAL_SECRET` through its `env_file`, which is why `gatewayAudit` works today. Only the new URL needs adding. In `docker-compose.yml`, add this line to the `environment:` block of **`mcp-server`** (line 281), **`mcp-gateway`** (line 395), and **`agent-service`** (line 443):

```yaml
      BFF_TRANSACTION_HOP_URL: "https://demo-api-server:3001/internal/transaction-hop"
```

HTTPS matches how these services already reach the BFF (`BFF_BASE_URL: "https://demo-api-server:3001"`), so the existing mkcert CA bundle covers it. An unset value makes `emitHop` a silent no-op, which is the intended behaviour outside Docker.

- [ ] **Step 9: Run all three suites**

Run: `cd demo_agent_service && npx jest tests/transactionHop.test.ts --forceExit && npx tsc --noEmit`
Expected: PASS, 4 tests; tsc clean.

Run: `cd demo_mcp_gateway && npx jest tests/transactionHop.test.ts --forceExit && npx tsc --noEmit`
Expected: PASS, 4 tests; tsc clean.

Run: `cd demo_mcp_server && NODE_ENV=test npx jest tests/transactionHop.test.ts --forceExit && npx tsc --noEmit`
Expected: PASS, 4 tests; tsc clean.

- [ ] **Step 10: Commit**

```bash
git add docker-compose.yml \
        demo_agent_service/src/transactionHop.ts demo_agent_service/src/agentRunHandler.ts demo_agent_service/tests/transactionHop.test.ts \
        demo_mcp_gateway/src/transactionHop.ts demo_mcp_gateway/src/gatewayAudit.ts demo_mcp_gateway/tests/transactionHop.test.ts \
        demo_mcp_server/src/utils/transactionHop.ts demo_mcp_server/src/server/HttpMCPTransport.ts demo_mcp_server/tests/transactionHop.test.ts
git commit -m "feat(ledger): emit transaction hops from agent-service, gateway, and mcp-server"
```

---

### Task 8: authz-server — hop emission and PERMIT auditing

**Files:**
- Create: `demo_authz_server/transactionHop.js`
- Modify: `demo_authz_server/logger.js:31-53`, `demo_authz_server/routes/decision.js:728-744`
- Test: `demo_authz_server/tests/transactionHop.test.js`

**Interfaces:**
- Consumes: `POST /internal/transaction-hop` (Task 5); `getCorrelationId`, `getDecisionContext` from `./correlationContext`.
- Produces: `emitHop(hop) => void`; `auditDecision(decision, reason)` now accepts `'PERMIT'` in addition to `'DENY'` / `'INDETERMINATE'`.

Both halves of deviation #3 land here. The hop is the machine-readable path the reconciler and invariant engine actually use; the widened `auditDecision` keeps the human-debug stdout line complete, which is what was asked for during brainstorming. `demo_authz_server` uses `node --test`, not jest.

`permit()`, `permitWithAdvice()`, `deny()`, and `indeterminate()` are the four terminal response helpers every decision path funnels through, so emitting from them gives complete coverage. Note that several early DENY guards return before `setDecisionContext` runs at line 188 — those hops carry `null` for `tool`/`sub`/`actor`, which is honest and must not be papered over.

- [ ] **Step 1: Write the failing test**

Create `demo_authz_server/tests/transactionHop.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { emitHop, __setFetchForTests } = require('../transactionHop');
const { runWithCorrelation } = require('../correlationContext');

function harness() {
  const calls = [];
  __setFetchForTests(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true };
  });
  process.env.BFF_TRANSACTION_HOP_URL = 'http://bff/internal/transaction-hop';
  process.env.BFF_INTERNAL_SECRET = 'sekrit';
  return calls;
}

function reset() {
  __setFetchForTests(undefined);
  delete process.env.BFF_TRANSACTION_HOP_URL;
  delete process.env.BFF_INTERNAL_SECRET;
}

test('posts a hop stamped with the ALS correlation id and service name', async () => {
  const calls = harness();
  runWithCorrelation('c1', () => emitHop({ phase: 'authz.decision', op: 'create_transfer' }));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].body.correlationId, 'c1');
  assert.strictEqual(calls[0].body.service, 'authz-server');
  assert.strictEqual(calls[0].body.phase, 'authz.decision');
  assert.strictEqual(calls[0].headers['x-internal-gateway-secret'], 'sekrit');
  reset();
});

test('no-ops outside a correlation scope', async () => {
  const calls = harness();
  emitHop({ phase: 'authz.decision' });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(calls.length, 0);
  reset();
});

test('no-ops when the ingest URL is unset', async () => {
  const calls = harness();
  delete process.env.BFF_TRANSACTION_HOP_URL;
  runWithCorrelation('c1', () => emitHop({ phase: 'authz.decision' }));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(calls.length, 0);
  reset();
});

test('never throws when the transport rejects', async () => {
  harness();
  __setFetchForTests(async () => { throw new Error('network down'); });
  assert.doesNotThrow(() => runWithCorrelation('c1', () => emitHop({ phase: 'authz.decision' })));
  await new Promise((r) => setImmediate(r));
  reset();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_authz_server && node --test tests/transactionHop.test.js`
Expected: FAIL — `Cannot find module '../transactionHop'`

- [ ] **Step 3: Write the emitter**

Create `demo_authz_server/transactionHop.js`:

```js
'use strict';
/**
 * Ship one transaction hop to the BFF ledger, fire-and-forget.
 *
 * The mock Authorization Server's existing audit sink (logger.auditDecision)
 * writes to stdout only — nothing in the repo reads it. This emitter is the
 * machine-readable path the invariant engine and reconciler consume.
 * Never awaited and never throws: a decision must never be delayed or failed
 * by auditing.
 */
const { getCorrelationId } = require('./correlationContext');

const SERVICE = 'authz-server';

let _fetch;

/** Test seam — inject a fetch double. Pass undefined to restore global fetch. */
function __setFetchForTests(fn) {
  _fetch = fn;
}

function emitHop(hop) {
  try {
    const url = process.env.BFF_TRANSACTION_HOP_URL;
    const secret = process.env.BFF_INTERNAL_SECRET;
    if (!url || !secret) return;
    const correlationId = hop.correlationId || getCorrelationId();
    if (!correlationId) return;

    const doFetch = _fetch || globalThis.fetch;
    if (!doFetch) return;

    doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-gateway-secret': secret },
      body: JSON.stringify({ ...hop, correlationId, service: SERVICE }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => { /* swallow */ });
  } catch {
    /* swallow */
  }
}

module.exports = { emitHop, __setFetchForTests, SERVICE };
```

- [ ] **Step 4: Widen `auditDecision` to cover PERMIT**

In `demo_authz_server/logger.js`, replace the `auditDecision` docblock and signature:

```js
/**
 * Emit a structured audit record for a decision.
 *
 * PERMIT is audited alongside DENY / INDETERMINATE so the stdout trail is
 * complete for a human reading container logs. Note this sink is stdout-only —
 * the machine-readable path the reconciler uses is transactionHop.emitHop.
 * @param {'PERMIT'|'DENY'|'INDETERMINATE'} decision
 * @param {string} reason
 */
function auditDecision(decision, reason) {
```

The body is unchanged.

- [ ] **Step 5: Emit from the four terminal helpers**

In `demo_authz_server/routes/decision.js`, add to the imports near line 41:

```js
const { emitHop } = require('../transactionHop');
```

Replace the four helpers (lines 728-744) with:

```js
// Every decision path funnels through these four helpers, so emitting here
// gives complete coverage. Early DENY guards return before setDecisionContext
// runs, so their hops carry null tool/sub/actor — that gap is real and must
// stay visible rather than being back-filled with guesses.
function _emitDecisionHop(outcome, reason) {
  const ctx = getDecisionContext();
  emitHop({
    phase: 'authz.decision',
    op: ctx.tool || null,
    identity: { sub: ctx.sub || null, act: ctx.actor ? [ctx.actor] : [] },
    decision: { outcome, by: 'mock', reason: reason || null },
    status: 'ok',
  });
}

function permit(res, reason) {
  auditDecision('PERMIT', reason);
  _emitDecisionHop('permit', reason);
  res.json({ decision: 'PERMIT', reason, decision_id: randomId(), policy_version: 'mock-v1' });
}

function permitWithAdvice(res, reason, advice) {
  auditDecision('PERMIT', reason);
  _emitDecisionHop('permit', reason);
  res.json({ decision: 'PERMIT', reason, advice, decision_id: randomId(), policy_version: 'mock-v1' });
}

function deny(res, reason) {
  auditDecision('DENY', reason);
  _emitDecisionHop('deny', reason);
  res.json({ decision: 'DENY', reason, decision_id: randomId(), policy_version: 'mock-v1' });
}

function indeterminate(res, reason) {
  auditDecision('INDETERMINATE', reason);
  _emitDecisionHop('n/a', reason);
  res.json({ decision: 'INDETERMINATE', reason, decision_id: randomId(), policy_version: 'mock-v1' });
}
```

Add `getDecisionContext` to the existing `correlationContext` require in this file if it is not already imported:

```js
const { getDecisionContext } = require('../correlationContext');
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd demo_authz_server && node --test tests/transactionHop.test.js`
Expected: PASS, 4 tests.

Run: `cd demo_authz_server && node --test`
Expected: PASS — full suite, including `decision.rar.test.js` and `decision-nnp3-nnp2.test.js`, unchanged.

- [ ] **Step 7: Wire the ingest URL into compose**

In `docker-compose.yml`, add to the `environment:` block of **`authz-server`** (line 571):

```yaml
      BFF_TRANSACTION_HOP_URL: "https://demo-api-server:3001/internal/transaction-hop"
```

`BFF_INTERNAL_SECRET` already arrives through this service's `env_file`.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml \
        demo_authz_server/transactionHop.js \
        demo_authz_server/logger.js \
        demo_authz_server/routes/decision.js \
        demo_authz_server/tests/transactionHop.test.js
git commit -m "feat(authz): emit decision hops and audit PERMIT alongside DENY"
```

---

### Task 9: hitl-service — correlation passthrough and consent hop

**Files:**
- Create: `demo_hitl_service/src/transactionHop.js`
- Modify: `demo_hitl_service/src/routes/challenges.js:41-72`, `:95-123`; `demo_hitl_service/src/store/challengeStore.js:33-56`
- Test: `demo_hitl_service/tests/transactionHop.test.js`, `demo_hitl_service/tests/challengeCorrelation.test.js`

**Interfaces:**
- Consumes: `POST /internal/transaction-hop` (Task 5); `getCorrelationId` from `./correlationContext`.
- Produces: `emitHop(hop) => void`; `challengeStore.create({tool, userId, agentId, context, correlationId})` now persists `correlationId` on the challenge record; the consent hop carries `params` = the challenge `context`, which is what INV-7 compares against the executed tool's params in Task 12.

Deviation #4 lands here. The gateway already sends `correlationId` in the body and as `X-Correlation-ID` (`hitlClient.ts:64`), but `POST /challenges` destructures only `{ tool, userId, agentId, userEmail, context }` and `store.create` ignores everything else, so it is dropped on the floor. Without this, consent cannot be joined to its transaction at all.

- [ ] **Step 1: Write the failing tests**

Create `demo_hitl_service/tests/transactionHop.test.js`:

```js
'use strict';
const { emitHop, __setFetchForTests } = require('../src/transactionHop');
const { runWithCorrelation } = require('../src/correlationContext');

describe('hitl emitHop', () => {
  const calls = [];

  beforeEach(() => {
    calls.length = 0;
    process.env.BFF_TRANSACTION_HOP_URL = 'http://bff/internal/transaction-hop';
    process.env.BFF_INTERNAL_SECRET = 'sekrit';
    __setFetchForTests(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return { ok: true };
    });
  });

  afterEach(() => {
    __setFetchForTests(undefined);
    delete process.env.BFF_TRANSACTION_HOP_URL;
    delete process.env.BFF_INTERNAL_SECRET;
  });

  test('posts a hop stamped with the ALS correlation id and service name', async () => {
    runWithCorrelation('c1', () => emitHop({ phase: 'hitl.consent', op: 'create_transfer' }));
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ correlationId: 'c1', service: 'hitl-service', phase: 'hitl.consent' });
    expect(calls[0].headers['x-internal-gateway-secret']).toBe('sekrit');
  });

  test('an explicit correlationId wins over the ALS value', async () => {
    runWithCorrelation('c-als', () => emitHop({ phase: 'hitl.consent', correlationId: 'c-explicit' }));
    await new Promise((r) => setImmediate(r));
    expect(calls[0].body.correlationId).toBe('c-explicit');
  });

  test('no-ops outside a correlation scope', async () => {
    emitHop({ phase: 'hitl.consent' });
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);
  });

  test('never throws when the transport rejects', async () => {
    __setFetchForTests(async () => { throw new Error('network down'); });
    expect(() => runWithCorrelation('c1', () => emitHop({ phase: 'hitl.consent' }))).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
```

Create `demo_hitl_service/tests/challengeCorrelation.test.js`:

```js
'use strict';
const store = require('../src/store/challengeStore');

describe('challengeStore correlationId', () => {
  test('persists correlationId on create', () => {
    const ch = store.create({
      tool: 'create_transfer',
      userId: 'u1',
      agentId: 'a1',
      context: { amount: 5000, to_account_id: 'acc-1' },
      correlationId: 'c1',
    });
    expect(ch.correlationId).toBe('c1');
    expect(store.get(ch.id).correlationId).toBe('c1');
  });

  test('correlationId is null when not supplied', () => {
    const ch = store.create({ tool: 'x', userId: 'u1', agentId: 'a1', context: {} });
    expect(ch.correlationId).toBeNull();
  });

  test('resolve preserves correlationId', () => {
    const ch = store.create({ tool: 'x', userId: 'u1', agentId: 'a1', context: {}, correlationId: 'c1' });
    const resolved = store.resolve(ch.id, 'approved');
    expect(resolved.correlationId).toBe('c1');
    expect(resolved.decision).toBe('approved');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_hitl_service && npx jest tests/transactionHop.test.js tests/challengeCorrelation.test.js`
Expected: FAIL — missing module, and `correlationId` is `undefined` on the challenge.

- [ ] **Step 3: Write the emitter**

Create `demo_hitl_service/src/transactionHop.js` — same shape as the authz emitter, with `const SERVICE = 'hitl-service';`:

```js
'use strict';
/**
 * Ship one transaction hop to the BFF ledger, fire-and-forget.
 * Never awaited and never throws — consent must never be delayed by auditing.
 */
const { getCorrelationId } = require('./correlationContext');

const SERVICE = 'hitl-service';

let _fetch;

/** Test seam — inject a fetch double. Pass undefined to restore global fetch. */
function __setFetchForTests(fn) {
  _fetch = fn;
}

function emitHop(hop) {
  try {
    const url = process.env.BFF_TRANSACTION_HOP_URL;
    const secret = process.env.BFF_INTERNAL_SECRET;
    if (!url || !secret) return;
    const correlationId = hop.correlationId || getCorrelationId();
    if (!correlationId) return;

    const doFetch = _fetch || globalThis.fetch;
    if (!doFetch) return;

    doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-gateway-secret': secret },
      body: JSON.stringify({ ...hop, correlationId, service: SERVICE }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => { /* swallow */ });
  } catch {
    /* swallow */
  }
}

module.exports = { emitHop, __setFetchForTests, SERVICE };
```

- [ ] **Step 4: Persist `correlationId` on the challenge**

In `demo_hitl_service/src/store/challengeStore.js`, update the docblock and `create`:

```js
/**
 * In-memory HITL challenge store.
 *
 * Keyed by challengeId (UUID). Each entry:
 *   { id, tool, userId, agentId, context, correlationId, status,
 *     createdAt, expiresAt, resolvedAt, decision }
 *
 * Status lifecycle:  pending → approved | denied | expired
 *
 * For production: swap _store for Redis or a DB — interface stays the same.
 */
```

```js
function create({ tool, userId, agentId, context, correlationId }) {
  _pruneExpired();
  if (_store.size >= MAX_CHALLENGES) {
    throw new Error('Challenge store at capacity');
  }
  const id = uuidv4();
  const now = Date.now();
  const challenge = {
    id,
    tool,
    userId: userId || null,
    agentId: agentId || null,
    context: context || {},
    // Joins this consent to its transaction. The gateway has always sent it
    // (hitlClient.ts) — it used to be dropped here.
    correlationId: correlationId || null,
    status: 'pending',
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
    resolvedAt: null,
    decision: null,
  };
  _store.set(id, challenge);
  return { ...challenge };
}
```

- [ ] **Step 5: Thread it through the routes and emit the consent hop**

In `demo_hitl_service/src/routes/challenges.js`, add the import:

```js
const { emitHop } = require('../transactionHop');
```

In the `POST /` handler, change the destructure and the `store.create` call:

```js
  const { tool, userId, agentId, userEmail, context, correlationId } = req.body || {};
```

```js
    challenge = store.create({ tool, userId, agentId, context, correlationId });
```

In the `POST /:id/respond` handler, after the successful `store.resolve(...)` and before `res.json(...)`, add:

```js
  // params carries the consented arguments — INV-7 compares them against the
  // arguments the tool actually executed with.
  emitHop({
    phase: 'hitl.consent',
    op: challenge.tool,
    correlationId: challenge.correlationId,
    identity: { sub: challenge.userId || null, act: challenge.agentId ? [challenge.agentId] : [] },
    decision: {
      outcome: challenge.decision === 'approved' ? 'permit' : 'deny',
      by: 'gateway',
      reason: `hitl_${challenge.decision}`,
    },
    params: challenge.context || {},
    status: 'ok',
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd demo_hitl_service && npx jest tests/transactionHop.test.js tests/challengeCorrelation.test.js`
Expected: PASS, 7 tests.

Run: `cd demo_hitl_service && npx jest`
Expected: PASS — full suite, no regression.

- [ ] **Step 7: Wire the ingest URL into compose**

In `docker-compose.yml`, add to the `environment:` block of **`hitl-service`** (line 482):

```yaml
      BFF_TRANSACTION_HOP_URL: "https://demo-api-server:3001/internal/transaction-hop"
```

`BFF_INTERNAL_SECRET` already arrives through this service's `env_file`.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml \
        demo_hitl_service/src/transactionHop.js \
        demo_hitl_service/src/store/challengeStore.js \
        demo_hitl_service/src/routes/challenges.js \
        demo_hitl_service/tests/transactionHop.test.js \
        demo_hitl_service/tests/challengeCorrelation.test.js
git commit -m "feat(hitl): persist correlationId on challenges and emit consent hops"
```

---

### Task 10: Derived token-exchange hops

**Files:**
- Modify: `demo_api_server/services/tokenChainService.js:88-155` (the `trackTokenEvent` event literal), and the module exports
- Create: `demo_api_server/services/transactionAssembler.js`
- Modify: `demo_api_server/routes/transactionTrace.js` (detail handler)
- Test: `demo_api_server/tests/services/transactionAssembler.test.js`

**Interfaces:**
- Consumes: `getRecord` (Task 4); `getTokenChain` from `tokenChainService`.
- Produces: `assemble(correlationId) => Promise<object|null>` returning `{ correlationId, startedAt, endedAt, hops }` with derived `token.exchange` hops merged in and all hops re-sequenced by `ts`. Tasks 12-13 wrap this with `verdict` and `reconciliation`.

Deviation #2 lands here. `trackTokenEvent` records no `correlationId`, so exchanges cannot currently be attributed to a transaction. The fix reads AsyncLocalStorage inside the event literal — **no call site changes, and `routes/oauth.js` / `services/oauthService.js` are not touched.**

Derived hops are marked `source: 'derived'` so the UI and reconciler can tell them apart from emitted hops. Records carrying a `type` key are skipped: `demo_api_server/data/token-chains/*.json` are jest fixtures with a different shape that `reloadFromDisk()` loads blindly on boot.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/services/transactionAssembler.test.js`:

```js
'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ getRecord: jest.fn() }));
jest.mock('../../services/tokenChainService', () => ({ getTokenChain: jest.fn() }));

const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const tokenChainService = require('../../services/tokenChainService');
const { assemble } = require('../../services/transactionAssembler');

const LEDGER_RECORD = {
  correlationId: 'c1',
  startedAt: '2026-07-18T00:00:00.000Z',
  endedAt: '2026-07-18T00:00:10.000Z',
  hops: [
    { seq: 1, ts: '2026-07-18T00:00:00.000Z', service: 'demo-api-server', phase: 'ui.request' },
    { seq: 2, ts: '2026-07-18T00:00:09.000Z', service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
  ],
};

describe('transactionAssembler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tokenChainService.getTokenChain.mockResolvedValue([]);
  });

  test('returns null when the ledger has no record', async () => {
    ledger.getRecord.mockReturnValue(null);
    expect(await assemble('nope')).toBeNull();
  });

  test('passes ledger hops through, marked source=emit', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    const out = await assemble('c1');
    expect(out.hops).toHaveLength(2);
    expect(out.hops.every((h) => h.source === 'emit')).toBe(true);
  });

  test('derives a token.exchange hop from a matching token-chain event', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    tokenChainService.getTokenChain.mockResolvedValue([
      {
        id: 'evt-1',
        correlationId: 'c1',
        eventType: 'exchange',
        tokenType: 'exchanged_token',
        timestamp: '2026-07-18T00:00:05.000Z',
        tokenSub: 'demoUser',
        tokenAct: { client_id: 'agent-gw' },
        scopes: ['banking:read'],
        audience: 'mcp-server',
        expiry: '2026-07-18T01:00:00.000Z',
      },
    ]);
    const out = await assemble('c1');
    const derived = out.hops.filter((h) => h.phase === 'token.exchange');
    expect(derived).toHaveLength(1);
    expect(derived[0].source).toBe('derived');
    expect(derived[0].identity).toMatchObject({
      sub: 'demoUser',
      act: ['agent-gw'],
      aud: 'mcp-server',
      scopes: ['banking:read'],
      tokenType: 'exchanged_token',
    });
  });

  test('ignores token-chain events for a different correlation id', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    tokenChainService.getTokenChain.mockResolvedValue([
      { id: 'e', correlationId: 'other', eventType: 'exchange', timestamp: '2026-07-18T00:00:05.000Z' },
    ]);
    const out = await assemble('c1');
    expect(out.hops.filter((h) => h.phase === 'token.exchange')).toHaveLength(0);
  });

  test('skips jest fixture records that carry a `type` key', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    tokenChainService.getTokenChain.mockResolvedValue([
      { id: 'token-event-1', userId: 'persist-test-user', type: 'TOKEN_EXCHANGE', timestamp: 1783949866168, correlationId: 'c1' },
    ]);
    const out = await assemble('c1');
    expect(out.hops.filter((h) => h.phase === 'token.exchange')).toHaveLength(0);
  });

  test('merges derived hops in timestamp order and re-sequences', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    tokenChainService.getTokenChain.mockResolvedValue([
      { id: 'e', correlationId: 'c1', eventType: 'exchange', timestamp: '2026-07-18T00:00:05.000Z', tokenSub: 'u' },
    ]);
    const out = await assemble('c1');
    expect(out.hops.map((h) => h.phase)).toEqual(['ui.request', 'token.exchange', 'mcp.tool']);
    expect(out.hops.map((h) => h.seq)).toEqual([1, 2, 3]);
  });

  test('degrades to ledger-only hops when the token chain read throws', async () => {
    ledger.getRecord.mockReturnValue(JSON.parse(JSON.stringify(LEDGER_RECORD)));
    tokenChainService.getTokenChain.mockRejectedValue(new Error('boom'));
    const out = await assemble('c1');
    expect(out.hops).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionAssembler.test.js`
Expected: FAIL — `Cannot find module '../../services/transactionAssembler'`

- [ ] **Step 3: Record `correlationId` on token events**

In `demo_api_server/services/tokenChainService.js`, add the require next to the existing ones at the top:

```js
const { getCorrelationId } = require('../utils/correlationContext');
```

In the `event` object literal inside `trackTokenEvent` (around line 111), add one field immediately after `id`:

```js
  const event = {
    id: crypto.randomUUID(),
    // Read from AsyncLocalStorage so every existing call site gains transaction
    // attribution with no change — routes/oauth.js and services/oauthService.js
    // are REGRESSION_PLAN §1 protected and must not be edited.
    correlationId: getCorrelationId() || null,
    timestamp: new Date().toISOString(),
```

- [ ] **Step 4: Write the assembler**

Create `demo_api_server/services/transactionAssembler.js`:

```js
'use strict';
/**
 * Assemble the full chain of custody for one transaction.
 *
 * Emitted hops come from the ledger. token.exchange hops are DERIVED at read
 * time from tokenChainService rather than emitted, because the code that
 * performs RFC 8693 exchanges lives in REGRESSION_PLAN §1 protected files.
 * Derived hops are labelled source:'derived' so the UI and the reconciler can
 * tell a read-time reconstruction from a first-hand record.
 */
const ledger = require('./lmdb/transactionLedger.lmdb');
const tokenChainService = require('./tokenChainService');

/**
 * demo_api_server/data/token-chains/*.json are jest fixtures, not production
 * output: they use `type` (not `eventType`), a numeric epoch timestamp, and
 * `scope`. reloadFromDisk() validates only Array.isArray, so they load into the
 * in-memory map on boot. The `type` key is the reliable fixture marker.
 */
function _isFixtureRecord(evt) {
  return evt && typeof evt === 'object' && 'type' in evt;
}

function _actArray(tokenAct) {
  if (!tokenAct) return [];
  if (Array.isArray(tokenAct)) return tokenAct.map((a) => a?.client_id || a?.sub || String(a));
  return [tokenAct.client_id || tokenAct.sub || String(tokenAct)];
}

function _toDerivedHop(evt) {
  return {
    ts: evt.timestamp,
    service: 'demo-api-server',
    phase: 'token.exchange',
    op: evt.eventType,
    identity: {
      sub: evt.tokenSub || null,
      act: _actArray(evt.tokenAct),
      aud: evt.audience || null,
      scopes: Array.isArray(evt.scopes) ? evt.scopes : [],
      tokenType: evt.tokenType || null,
      jti: evt.id || null,
      exp: evt.expiry || null,
    },
    decision: { outcome: 'n/a', by: 'gateway', reason: null },
    status: 'ok',
    source: 'derived',
  };
}

async function _derivedTokenHops(correlationId) {
  try {
    const events = await tokenChainService.getTokenChain();
    return (Array.isArray(events) ? events : [])
      .filter((e) => !_isFixtureRecord(e))
      .filter((e) => e && e.correlationId === correlationId)
      .filter((e) => e.eventType === 'exchange' || e.eventType === 'refresh')
      .map(_toDerivedHop);
  } catch (err) {
    // A token-chain read failure must not blank the whole trace — the emitted
    // hops are still a valid, if narrower, chain.
    // eslint-disable-next-line no-console
    console.warn('[transactionAssembler] token chain read failed:', err?.message);
    return [];
  }
}

/**
 * @param {string} correlationId
 * @returns {Promise<object|null>} { correlationId, startedAt, endedAt, hops }
 */
async function assemble(correlationId) {
  const record = ledger.getRecord(correlationId);
  if (!record) return null;

  const emitted = (record.hops || []).map((h) => ({ ...h, source: h.source || 'emit' }));
  const derived = await _derivedTokenHops(correlationId);

  const hops = [...emitted, ...derived]
    .sort((a, b) => (String(a.ts) < String(b.ts) ? -1 : String(a.ts) > String(b.ts) ? 1 : 0))
    .map((h, i) => ({ ...h, seq: i + 1 }));

  return {
    correlationId: record.correlationId,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    hops,
  };
}

module.exports = { assemble };
```

- [ ] **Step 5: Use the assembler in the detail route**

In `demo_api_server/routes/transactionTrace.js`, add the require:

```js
const { assemble } = require('../services/transactionAssembler');
```

Replace the `/:correlationId` handler body:

```js
router.get('/:correlationId', async (req, res) => {
  let record;
  try {
    record = await assemble(req.params.correlationId);
  } catch (err) {
    console.warn('[transactionTrace] read failed:', err?.message);
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!record) return res.status(404).json({ error: 'not_found' });

  return res.json({
    ...record,
    traceId: traceIdFromCorrelation(record.correlationId),
  });
});
```

Update `demo_api_server/tests/routes/transactionTrace.test.js` for the new dependency — add this mock next to the existing `jest.mock` call, and change the two detail tests to stub `assemble` instead of `getRecord`:

```js
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
```

```js
const { assemble } = require('../../services/transactionAssembler');
```

In `'404 for an unknown correlation id'` replace `ledger.getRecord.mockReturnValue(null);` with `assemble.mockResolvedValue(null);`. In `'returns the record with a derived traceId'` replace `ledger.getRecord.mockReturnValue({...})` with `assemble.mockResolvedValue({...})`, same object.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionAssembler.test.js tests/routes/transactionTrace.test.js`
Expected: PASS, 7 + 6 tests.

Run: `cd demo_api_server && CI=true npx jest --testPathPattern='tokenChain'`
Expected: PASS — the new field is additive; no existing token-chain assertion breaks.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/services/tokenChainService.js \
        demo_api_server/services/transactionAssembler.js \
        demo_api_server/routes/transactionTrace.js \
        demo_api_server/tests/services/transactionAssembler.test.js \
        demo_api_server/tests/routes/transactionTrace.test.js
git commit -m "feat(ledger): derive token-exchange hops from the token chain by correlation id"
```

**P1 acceptance gate.** Before starting P2, confirm the stack produces a real trace:

```bash
./run-docker.sh
# drive one banking balance chip in the UI at https://api.ping.demo:4000, then:
curl -sk --cookie-jar /tmp/cj --cookie /tmp/cj https://api.ping.demo:3001/api/transaction-trace | head -40
```

Expected: at least one transaction with `hopCount >= 6`. Fetch its detail and confirm `hops` spans four or more distinct `service` values. If `hopCount` is 1-2, the remote emitters are not reaching the BFF — check that `BFF_TRANSACTION_HOP_URL` and `BFF_INTERNAL_SECRET` are set in each service's compose environment.

---

## Phase P2 — Invariants

### Task 11: Invariant engine — identity chain (INV-1 … INV-4)

**Files:**
- Create: `demo_api_server/services/transactionInvariants.js`
- Test: `demo_api_server/tests/services/transactionInvariants.identity.test.js`

**Interfaces:**
- Consumes: an assembled record from Task 10 — `{ correlationId, hops: [...] }`. No I/O whatsoever; this module must stay a pure function so it is testable with fixtures and no running stack.
- Produces:
  - `evaluate(record) => { status: 'PASS'|'FAIL'|'INCOMPLETE', violations: Violation[] }`
  - `Violation = { id, severity: 'error'|'incomplete', hopSeq: number|null, detail: string }`
  - Internal named checks `inv1ActorChain`, `inv2SubjectStability`, `inv3NoScopeEscalation`, `inv4AudienceMinted`, each `(hops) => Violation[]`. Task 12 adds `inv5`…`inv8` to the same `CHECKS` array.

Status precedence: any `error` violation ⇒ `FAIL`; otherwise any `incomplete` ⇒ `INCOMPLETE`; otherwise `PASS`.

INV-4 is self-contained by design: rather than mapping audiences to services through an external table that would drift, it asserts that any audience a hop presents was actually minted by an earlier `token.exchange` hop **in the same transaction**. A token presented with an audience nobody minted here is the replay signal.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/services/transactionInvariants.identity.test.js`:

```js
'use strict';
const { evaluate } = require('../../services/transactionInvariants');

function rec(hops) {
  return { correlationId: 'c1', hops: hops.map((h, i) => ({ seq: i + 1, ts: `2026-07-18T00:00:0${i}.000Z`, ...h })) };
}
function ids(result) {
  return result.violations.map((v) => v.id).sort();
}

describe('INV-1 actor chain continuity', () => {
  test('passes when every exchanged token carries an act chain', () => {
    const r = evaluate(rec([
      { service: 'demo-api-server', phase: 'token.exchange', identity: { sub: 'u', tokenType: 'exchanged_token', act: ['agent-gw'], aud: 'mcp' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance', identity: { sub: 'u', tokenType: 'exchanged_token', act: ['agent-gw'], aud: 'mcp' } },
    ]));
    expect(ids(r)).not.toContain('INV-1');
  });

  test('fails when an exchanged token has an empty act chain', () => {
    const r = evaluate(rec([
      { service: 'demo-api-server', phase: 'token.exchange', identity: { sub: 'u', tokenType: 'exchanged_token', act: [], aud: 'mcp' } },
    ]));
    expect(ids(r)).toContain('INV-1');
    expect(r.status).toBe('FAIL');
  });

  test('does not fire on a plain user token', () => {
    const r = evaluate(rec([
      { service: 'demo-api-server', phase: 'ui.request', identity: { sub: 'u', tokenType: 'user_token', act: [] } },
    ]));
    expect(ids(r)).not.toContain('INV-1');
  });
});

describe('INV-2 subject stability', () => {
  test('passes when every hop names the same subject', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'ui.request', identity: { sub: 'u1' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u1' } },
    ]));
    expect(ids(r)).not.toContain('INV-2');
  });

  test('fails when the subject changes mid-transaction', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'ui.request', identity: { sub: 'u1' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u2' } },
    ]));
    expect(ids(r)).toContain('INV-2');
    expect(r.violations.find((v) => v.id === 'INV-2').detail).toMatch(/u1.*u2|u2.*u1/);
  });

  test('hops with no subject are ignored, not treated as a change', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'ui.request', identity: { sub: 'u1' } },
      { service: 'b', phase: 'agent.reason' },
      { service: 'c', phase: 'mcp.tool', op: 't', identity: { sub: 'u1' } },
    ]));
    expect(ids(r)).not.toContain('INV-2');
  });
});

describe('INV-3 no scope escalation', () => {
  test('passes when scopes narrow monotonically', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', scopes: ['banking:read', 'banking:write'], aud: 'x' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', scopes: ['banking:read'], aud: 'x' } },
    ]));
    expect(ids(r)).not.toContain('INV-3');
  });

  test('fails when a later hop gains a scope', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', scopes: ['banking:read'], aud: 'x' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', scopes: ['banking:read', 'banking:transfer'], aud: 'x' } },
    ]));
    expect(ids(r)).toContain('INV-3');
    expect(r.violations.find((v) => v.id === 'INV-3').detail).toContain('banking:transfer');
  });

  test('hops with no scopes do not break the chain', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', scopes: ['banking:read'], aud: 'x' } },
      { service: 'b', phase: 'agent.reason' },
      { service: 'c', phase: 'mcp.tool', op: 't', identity: { sub: 'u', scopes: ['banking:read'], aud: 'x' } },
    ]));
    expect(ids(r)).not.toContain('INV-3');
  });
});

describe('INV-4 audience minted in this transaction', () => {
  test('passes when a presented audience was minted by an earlier exchange', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', aud: 'mcp-server' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', aud: 'mcp-server' } },
    ]));
    expect(ids(r)).not.toContain('INV-4');
  });

  test('fails when a hop presents an audience nobody minted here', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', aud: 'mcp-server' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', aud: 'payments-api' } },
    ]));
    expect(ids(r)).toContain('INV-4');
    expect(r.violations.find((v) => v.id === 'INV-4').detail).toContain('payments-api');
  });

  test('does not evaluate when the transaction has no exchange hop', () => {
    const r = evaluate(rec([
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', aud: 'anything' } },
    ]));
    expect(ids(r)).not.toContain('INV-4');
  });

  test('accepts an array-valued aud when one entry was minted', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', aud: 'mcp-server' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', aud: ['mcp-server', 'other'] } },
    ]));
    expect(ids(r)).not.toContain('INV-4');
  });
});

describe('evaluate status', () => {
  test('a clean record is PASS with no violations', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'ui.request', identity: { sub: 'u' } },
      { service: 'b', phase: 'response' },
    ]));
    expect(r.status).toBe('PASS');
    expect(r.violations).toEqual([]);
  });

  test('an empty record is PASS, not a crash', () => {
    expect(evaluate({ correlationId: 'c1', hops: [] }).status).toBe('PASS');
    expect(evaluate({ correlationId: 'c1' }).status).toBe('PASS');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionInvariants.identity.test.js`
Expected: FAIL — `Cannot find module '../../services/transactionInvariants'`

- [ ] **Step 3: Write the engine and the four identity checks**

Create `demo_api_server/services/transactionInvariants.js`:

```js
'use strict';
/**
 * Identity invariants over one assembled transaction record.
 *
 * PURE — no I/O, no requires beyond this file. Every check is a
 * (hops) => Violation[] function so the whole engine is testable from fixtures
 * with nothing running. Task 12 appends INV-5..INV-8 to CHECKS.
 *
 * Severity:
 *   'error'      — the invariant was evaluated and violated  → FAIL
 *   'incomplete' — the record lacks the evidence to evaluate → INCOMPLETE
 * Absence of evidence is reported as absence, never as a violation.
 */

const DECISION_PHASES = new Set(['authz.decision', 'gateway.authorize']);

function _v(id, severity, hopSeq, detail) {
  return { id, severity, hopSeq, detail };
}

function _audList(aud) {
  if (!aud) return [];
  return Array.isArray(aud) ? aud.filter(Boolean).map(String) : [String(aud)];
}

/** INV-1 — once delegation starts, every exchanged token carries an act chain. */
function inv1ActorChain(hops) {
  const out = [];
  for (const h of hops) {
    if (h.identity?.tokenType !== 'exchanged_token') continue;
    const act = h.identity?.act;
    if (!Array.isArray(act) || act.length === 0) {
      out.push(_v('INV-1', 'error', h.seq,
        `${h.service} presented an exchanged token with no act (delegation) claim`));
    }
  }
  return out;
}

/** INV-2 — one transaction, one subject. A change mid-flight is a confused deputy. */
function inv2SubjectStability(hops) {
  const subs = [...new Set(hops.map((h) => h.identity?.sub).filter(Boolean).map(String))];
  if (subs.length <= 1) return [];
  const offender = hops.find((h) => h.identity?.sub && String(h.identity.sub) !== subs[0]);
  return [_v('INV-2', 'error', offender ? offender.seq : null,
    `transaction spans more than one subject: ${subs.join(', ')}`)];
}

/** INV-3 — RFC 8693 downscoping is monotonic; a later hop must not gain scope. */
function inv3NoScopeEscalation(hops) {
  const out = [];
  let prev = null;
  for (const h of hops) {
    const scopes = h.identity?.scopes;
    if (!Array.isArray(scopes) || scopes.length === 0) continue;
    if (prev) {
      const gained = scopes.filter((s) => !prev.scopes.includes(s));
      if (gained.length) {
        out.push(_v('INV-3', 'error', h.seq,
          `${h.service} gained scope not held at ${prev.service}: ${gained.join(', ')}`));
      }
    }
    prev = { scopes, service: h.service };
  }
  return out;
}

/**
 * INV-4 — every audience presented must have been minted by an earlier
 * token.exchange hop in THIS transaction. Self-contained on purpose: an
 * external service→audience table would drift out of date and start lying.
 */
function inv4AudienceMinted(hops) {
  const exchanges = hops.filter((h) => h.phase === 'token.exchange');
  if (exchanges.length === 0) return []; // no evidence — INV-5 covers missing hops
  const out = [];
  const minted = new Set();
  for (const h of hops) {
    if (h.phase === 'token.exchange') {
      for (const a of _audList(h.identity?.aud)) minted.add(a);
      continue;
    }
    const presented = _audList(h.identity?.aud);
    if (presented.length === 0) continue;
    if (!presented.some((a) => minted.has(a))) {
      out.push(_v('INV-4', 'error', h.seq,
        `${h.service} presented audience "${presented.join(', ')}" which was never minted in this transaction`));
    }
  }
  return out;
}

const CHECKS = [inv1ActorChain, inv2SubjectStability, inv3NoScopeEscalation, inv4AudienceMinted];

/**
 * @param {object} record  assembled transaction ({ correlationId, hops })
 * @returns {{status: 'PASS'|'FAIL'|'INCOMPLETE', violations: object[]}}
 */
function evaluate(record) {
  const hops = [...((record && record.hops) || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const violations = CHECKS.flatMap((check) => check(hops));
  const status = violations.some((v) => v.severity === 'error')
    ? 'FAIL'
    : violations.some((v) => v.severity === 'incomplete')
      ? 'INCOMPLETE'
      : 'PASS';
  return { status, violations };
}

module.exports = {
  evaluate,
  inv1ActorChain,
  inv2SubjectStability,
  inv3NoScopeEscalation,
  inv4AudienceMinted,
  DECISION_PHASES,
  CHECKS,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionInvariants.identity.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/transactionInvariants.js \
        demo_api_server/tests/services/transactionInvariants.identity.test.js
git commit -m "feat(invariants): add identity-chain checks INV-1 through INV-4"
```

---

### Task 12: Invariant engine — decision, consent, time (INV-5 … INV-8)

**Files:**
- Modify: `demo_api_server/services/transactionInvariants.js` (append four checks to `CHECKS`)
- Modify: `demo_api_server/routes/transactionTrace.js` (attach `verdict`)
- Test: `demo_api_server/tests/services/transactionInvariants.decision.test.js`

**Interfaces:**
- Consumes: the same `hops` array and `_v` / `DECISION_PHASES` helpers from Task 11.
- Produces: `inv5DecisionCoverage`, `inv6DenyHonored`, `inv7ConsentBinding`, `inv8TemporalSanity`, all `(hops) => Violation[]`; and `GET /api/transaction-trace/:correlationId` now returns `verdict: { status, violations }`.

INV-5 is the headline check — a tool that executed with no authorization decision. It distinguishes two cases deliberately: if the transaction has **no** decision hops at all, the evidence is missing (`incomplete`); if decision hops exist but none precede this tool call, that is a real violation (`error`).

INV-7 mirrors `verifyHitlReceipt` (`demo_mcp_gateway/src/hitlClient.ts:132-222`) rather than the intent token, per deviation #5: the intent token carries `permitted_tools` and `prompt_hash` but no parameters at all. The bound fields are `amount` plus `to_account_id`, `from_account_id`, `account_id`, `toAccountId`, `fromAccountId`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/services/transactionInvariants.decision.test.js`:

```js
'use strict';
const { evaluate } = require('../../services/transactionInvariants');

function rec(hops) {
  return { correlationId: 'c1', hops: hops.map((h, i) => ({ seq: i + 1, ts: `2026-07-18T00:00:0${i}.000Z`, ...h })) };
}
function ids(result) {
  return result.violations.map((v) => v.id);
}
const PERMIT = { outcome: 'permit', by: 'pingauthorize', reason: 'ok' };
const DENY = { outcome: 'deny', by: 'pingauthorize', reason: 'Amount > 2000' };

describe('INV-5 decision coverage', () => {
  test('passes when a decision precedes the tool call', () => {
    const r = evaluate(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: PERMIT },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_withdrawal' },
    ]));
    expect(ids(r)).not.toContain('INV-5');
    expect(r.status).toBe('PASS');
  });

  test('a gateway.authorize hop also satisfies coverage', () => {
    const r = evaluate(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: PERMIT },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(ids(r)).not.toContain('INV-5');
  });

  test('INCOMPLETE when the record has no decision hop at all', () => {
    const r = evaluate(rec([
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(ids(r)).toContain('INV-5');
    expect(r.status).toBe('INCOMPLETE');
    expect(r.violations.find((v) => v.id === 'INV-5').severity).toBe('incomplete');
  });

  test('FAIL when decisions exist but none precedes the tool call', () => {
    const r = evaluate(rec([
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_withdrawal' },
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: PERMIT },
    ]));
    expect(ids(r)).toContain('INV-5');
    expect(r.status).toBe('FAIL');
    expect(r.violations.find((v) => v.id === 'INV-5').severity).toBe('error');
  });
});

describe('INV-6 deny honored', () => {
  test('passes when a deny is followed by no tool call — the demo happy path for a blocked withdrawal', () => {
    const r = evaluate(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: DENY },
      { service: 'demo-api-server', phase: 'response', op: '403' },
    ]));
    expect(ids(r)).not.toContain('INV-6');
  });

  test('fails when the tool ran after a deny for the same op', () => {
    const r = evaluate(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: DENY },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_withdrawal' },
    ]));
    expect(ids(r)).toContain('INV-6');
    expect(r.status).toBe('FAIL');
  });

  test('a deny for a different op does not block an unrelated tool', () => {
    const r = evaluate(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: DENY },
      { service: 'authz-server', phase: 'authz.decision', op: 'get_balance', decision: PERMIT },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(ids(r)).not.toContain('INV-6');
  });

  test('a deny with no op recorded blocks any later tool — an unattributable deny is not a free pass', () => {
    const r = evaluate(rec([
      { service: 'authz-server', phase: 'authz.decision', op: null, decision: DENY },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(ids(r)).toContain('INV-6');
  });
});

describe('INV-7 consent binding', () => {
  test('passes when consented params match the executed params', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: PERMIT, params: { amount: 250, to_account_id: 'acc-1' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 250, to_account_id: 'acc-1' } },
    ]));
    expect(ids(r)).not.toContain('INV-7');
  });

  test('fails when the executed amount differs from the consented amount', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: PERMIT, params: { amount: 250, to_account_id: 'acc-1' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 5000, to_account_id: 'acc-1' } },
    ]));
    expect(ids(r)).toContain('INV-7');
    expect(r.violations.find((v) => v.id === 'INV-7').detail).toMatch(/amount/);
  });

  test('fails on a same-amount recipient swap', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: PERMIT, params: { amount: 250, to_account_id: 'acc-1' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 250, to_account_id: 'acc-999' } },
    ]));
    expect(ids(r)).toContain('INV-7');
    expect(r.violations.find((v) => v.id === 'INV-7').detail).toMatch(/to_account_id/);
  });

  test('fails when the tool ran after consent was denied', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: DENY, params: { amount: 250 } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 250 } },
    ]));
    expect(ids(r)).toContain('INV-7');
  });

  test('fails when the tool declares consentRequired but no consent hop precedes it', () => {
    const r = evaluate(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'create_transfer', decision: PERMIT },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', consentRequired: true, params: { amount: 250 } },
    ]));
    expect(ids(r)).toContain('INV-7');
  });

  test('a tool with no consent hop and no consentRequired flag is not evaluated', () => {
    const r = evaluate(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: PERMIT },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(ids(r)).not.toContain('INV-7');
  });

  test('numeric and string amounts compare equal', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: PERMIT, params: { amount: '250.00' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 250 } },
    ]));
    expect(ids(r)).not.toContain('INV-7');
  });
});

describe('INV-8 temporal sanity', () => {
  test('passes on monotonic timestamps within token expiry', () => {
    const r = evaluate({
      correlationId: 'c1',
      hops: [
        { seq: 1, ts: '2026-07-18T00:00:00.000Z', service: 'a', phase: 'ui.request', identity: { exp: '2026-07-18T01:00:00.000Z' } },
        { seq: 2, ts: '2026-07-18T00:00:05.000Z', service: 'b', phase: 'response' },
      ],
    });
    expect(ids(r)).not.toContain('INV-8');
  });

  test('fails when a later seq has an earlier timestamp', () => {
    const r = evaluate({
      correlationId: 'c1',
      hops: [
        { seq: 1, ts: '2026-07-18T00:00:10.000Z', service: 'a', phase: 'ui.request' },
        { seq: 2, ts: '2026-07-18T00:00:00.000Z', service: 'b', phase: 'response' },
      ],
    });
    expect(ids(r)).toContain('INV-8');
    expect(r.violations.find((v) => v.id === 'INV-8').detail).toMatch(/order/i);
  });

  test('fails when a hop uses a token past its expiry', () => {
    const r = evaluate({
      correlationId: 'c1',
      hops: [
        { seq: 1, ts: '2026-07-18T02:00:00.000Z', service: 'b', phase: 'mcp.tool', op: 't', identity: { exp: '2026-07-18T01:00:00.000Z' } },
      ],
    });
    expect(ids(r)).toContain('INV-8');
    expect(r.violations.find((v) => v.id === 'INV-8').detail).toMatch(/expir/i);
  });

  test('an unparseable timestamp is skipped, not reported as a violation', () => {
    const r = evaluate({
      correlationId: 'c1',
      hops: [
        { seq: 1, ts: 'not-a-date', service: 'a', phase: 'ui.request' },
        { seq: 2, ts: '2026-07-18T00:00:00.000Z', service: 'b', phase: 'response' },
      ],
    });
    expect(ids(r)).not.toContain('INV-8');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionInvariants.decision.test.js`
Expected: FAIL — no `INV-5`…`INV-8` violations are produced.

- [ ] **Step 3: Add the four checks**

In `demo_api_server/services/transactionInvariants.js`, insert these before the `CHECKS` array:

```js
/** Fields HITL binds a consent receipt to. Mirrors demo_mcp_gateway/src/hitlClient.ts. */
const CONSENT_BOUND_KEYS = [
  'to_account_id', 'from_account_id', 'account_id', 'toAccountId', 'fromAccountId',
];

function _normAmount(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function _normField(v) {
  if (v === undefined || v === null || v === '') return null;
  return String(v);
}

/**
 * INV-5 — no tool executes without a prior authorization decision.
 *
 * Two distinct outcomes: no decision hop anywhere means the evidence is
 * missing (incomplete); decisions that exist but all land AFTER the tool call
 * is a real ordering violation (error).
 */
function inv5DecisionCoverage(hops) {
  const decisions = hops.filter((h) => DECISION_PHASES.has(h.phase));
  const out = [];
  for (const tool of hops.filter((h) => h.phase === 'mcp.tool')) {
    const preceding = decisions.filter((d) => (d.seq || 0) < (tool.seq || 0));
    if (preceding.length > 0) continue;
    out.push(decisions.length === 0
      ? _v('INV-5', 'incomplete', tool.seq,
        `no authorization decision recorded anywhere for "${tool.op}" — cannot evaluate coverage`)
      : _v('INV-5', 'error', tool.seq,
        `"${tool.op}" executed before any authorization decision in this transaction`));
  }
  return out;
}

/** INV-6 — a denied operation must not then run. */
function inv6DenyHonored(hops) {
  const out = [];
  for (const tool of hops.filter((h) => h.phase === 'mcp.tool')) {
    const blocking = hops.find((d) =>
      DECISION_PHASES.has(d.phase) &&
      (d.seq || 0) < (tool.seq || 0) &&
      d.decision?.outcome === 'deny' &&
      // A deny with no op recorded is unattributable, so it blocks everything
      // after it. Treating it as "not my tool" would be a free pass.
      (!d.op || d.op === tool.op));
    if (blocking) {
      out.push(_v('INV-6', 'error', tool.seq,
        `"${tool.op}" executed after a deny at hop ${blocking.seq} (${blocking.decision.reason || 'no reason recorded'})`));
    }
  }
  return out;
}

/**
 * INV-7 — a consented operation must execute with the consented parameters.
 *
 * Mirrors verifyHitlReceipt in demo_mcp_gateway/src/hitlClient.ts: the intent
 * token carries permitted_tools and prompt_hash but NO parameters, so the HITL
 * challenge context is the only parameter-level binding that exists.
 */
function inv7ConsentBinding(hops) {
  const out = [];
  for (const tool of hops.filter((h) => h.phase === 'mcp.tool')) {
    const consents = hops.filter((c) =>
      c.phase === 'hitl.consent' && c.op === tool.op && (c.seq || 0) < (tool.seq || 0));

    if (consents.length === 0) {
      if (tool.consentRequired === true) {
        out.push(_v('INV-7', 'error', tool.seq,
          `"${tool.op}" requires consent but no consent was recorded before it`));
      }
      continue;
    }

    const consent = consents[consents.length - 1];
    if (consent.decision?.outcome !== 'permit') {
      out.push(_v('INV-7', 'error', tool.seq,
        `"${tool.op}" executed after consent was ${consent.decision?.outcome || 'not granted'}`));
      continue;
    }

    const consented = consent.params || {};
    const executed = tool.params || {};

    const cAmt = _normAmount(consented.amount);
    const eAmt = _normAmount(executed.amount);
    if ((cAmt !== null || eAmt !== null) && cAmt !== eAmt) {
      out.push(_v('INV-7', 'error', tool.seq,
        `"${tool.op}" consented amount ${cAmt} but executed amount ${eAmt}`));
      continue;
    }

    for (const key of CONSENT_BOUND_KEYS) {
      const cVal = _normField(consented[key]);
      const eVal = _normField(executed[key]);
      if (cVal === null && eVal === null) continue;
      if (cVal !== eVal) {
        out.push(_v('INV-7', 'error', tool.seq,
          `"${tool.op}" consented ${key}=${cVal} but executed ${key}=${eVal}`));
        break;
      }
    }
  }
  return out;
}

/** INV-8 — hops advance in time, and no hop uses a token past its expiry. */
function inv8TemporalSanity(hops) {
  const out = [];
  let prev = null;
  for (const h of hops) {
    const t = Date.parse(h.ts);
    if (Number.isFinite(t)) {
      if (prev && t < prev.t) {
        out.push(_v('INV-8', 'error', h.seq,
          `hop ${h.seq} is out of order — timestamp precedes hop ${prev.seq}`));
      }
      const exp = Date.parse(h.identity?.exp);
      if (Number.isFinite(exp) && t > exp) {
        out.push(_v('INV-8', 'error', h.seq,
          `${h.service} used a token that expired at ${h.identity.exp}`));
      }
      prev = { t, seq: h.seq };
    }
  }
  return out;
}
```

Replace the `CHECKS` array and extend the exports:

```js
const CHECKS = [
  inv1ActorChain,
  inv2SubjectStability,
  inv3NoScopeEscalation,
  inv4AudienceMinted,
  inv5DecisionCoverage,
  inv6DenyHonored,
  inv7ConsentBinding,
  inv8TemporalSanity,
];
```

```js
module.exports = {
  evaluate,
  inv1ActorChain,
  inv2SubjectStability,
  inv3NoScopeEscalation,
  inv4AudienceMinted,
  inv5DecisionCoverage,
  inv6DenyHonored,
  inv7ConsentBinding,
  inv8TemporalSanity,
  CONSENT_BOUND_KEYS,
  DECISION_PHASES,
  CHECKS,
};
```

- [ ] **Step 4: Attach the verdict to the detail route**

In `demo_api_server/routes/transactionTrace.js`, add:

```js
const { evaluate } = require('../services/transactionInvariants');
```

and extend the detail response:

```js
  return res.json({
    ...record,
    traceId: traceIdFromCorrelation(record.correlationId),
    verdict: evaluate(record),
  });
```

Add a test to `demo_api_server/tests/routes/transactionTrace.test.js`:

```js
  test('attaches a verdict computed from the assembled hops', async () => {
    assemble.mockResolvedValue({
      correlationId: 'c1',
      startedAt: 'A',
      endedAt: 'B',
      hops: [
        { seq: 1, ts: '2026-07-18T00:00:00.000Z', service: 'authz-server', phase: 'authz.decision', op: 'x', decision: { outcome: 'deny', by: 'mock', reason: 'nope' } },
        { seq: 2, ts: '2026-07-18T00:00:01.000Z', service: 'mcp-server', phase: 'mcp.tool', op: 'x' },
      ],
    });
    const res = await request(app()).get('/api/transaction-trace/c1');
    expect(res.body.verdict.status).toBe('FAIL');
    expect(res.body.verdict.violations.map((v) => v.id)).toContain('INV-6');
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionInvariants.decision.test.js tests/services/transactionInvariants.identity.test.js tests/routes/transactionTrace.test.js`
Expected: PASS, 19 + 15 + 7 tests.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/transactionInvariants.js \
        demo_api_server/routes/transactionTrace.js \
        demo_api_server/tests/services/transactionInvariants.decision.test.js \
        demo_api_server/tests/routes/transactionTrace.test.js
git commit -m "feat(invariants): add decision, consent, and temporal checks INV-5 through INV-8"
```

---

## Phase P3 — Reconciliation

### Task 13: Second-witness reconciler

**Files:**
- Create: `demo_api_server/services/transactionReconciler.js`
- Modify: `demo_api_server/routes/transactionTrace.js` (attach `reconciliation`)
- Test: `demo_api_server/tests/services/transactionReconciler.test.js`

**Interfaces:**
- Consumes: `query` from `services/lmdb/mcpAuditStore.lmdb`; `getMcpTrafficLog` from `services/mcpTrafficLogger`; an assembled record from Task 10.
- Produces: `reconcile(record) => { status: 'MATCH'|'MISMATCH'|'SOURCE_UNAVAILABLE', diffs: Diff[], sources: {...} }` where `Diff = { source, side: 'ledger_only'|'witness_only', op, detail }`.

**This task is the spec's INV-CROSS.** It is deliberately not an entry in `CHECKS` alongside INV-1..INV-8: those are pure functions of one record, while this one does I/O against two external stores. Keeping it out of the engine is what lets the engine stay testable from fixtures with nothing running. It surfaces in the API as `reconciliation`, not inside `verdict.violations`, for the same reason — a reconciliation gap is evidence about the *record keeping*, not about the transaction's identity chain.

**Witnesses used — and the two deliberately excluded.**

| Source | Used? | Why |
|---|---|---|
| `mcpAuditStore.lmdb` | yes | Written by the gateway over a separate HTTP path; corroborates `gateway.authorize` |
| `mcpTrafficLogger` | yes | Written by the BFF to NDJSON; corroborates `authz.decision` via its `authorize_response` lines |
| `tokenChainService` | **no** | Task 10 already *derives* `token.exchange` hops from it. Using it as a witness would corroborate a record against itself — circular, and would always report MATCH |
| authz `auditDecision` | **no** | stdout only; no file, no store, no reader in the repo. Joining it would mean scraping container logs |
| `mcpToolAuditStore` | **no** | Its own header documents it as a 200-event non-durable ring buffer for live debug; it would report false mismatches after every restart |

**The empty-store rule.** A witness that is readable but holds **zero rows for any transaction** is reported `SOURCE_UNAVAILABLE`, not `MISMATCH` — that is a fresh restart, not evidence of tampering. A witness holding rows for *other* transactions but none for this one, while the ledger has hops it should have seen, is a real `MISMATCH`. `SOURCE_UNAVAILABLE` must never render as a violation.

Note `mcpAuditStore.query()` has no `correlationId` filter and gateway-written rows carry no `eventType`, so this scans and filters in JavaScript.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/services/transactionReconciler.test.js`:

```js
'use strict';

jest.mock('../../services/lmdb/mcpAuditStore.lmdb', () => ({ query: jest.fn() }));
jest.mock('../../services/mcpTrafficLogger', () => ({ getMcpTrafficLog: jest.fn() }));

const auditStore = require('../../services/lmdb/mcpAuditStore.lmdb');
const trafficLogger = require('../../services/mcpTrafficLogger');
const { reconcile } = require('../../services/transactionReconciler');

function rec(hops) {
  return { correlationId: 'c1', hops: hops.map((h, i) => ({ seq: i + 1, ...h })) };
}

describe('transactionReconciler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditStore.query.mockReturnValue([]);
    trafficLogger.getMcpTrafficLog.mockReturnValue([]);
  });

  test('MATCH when the gateway witness agrees with the ledger', () => {
    auditStore.query.mockReturnValue([
      { correlationId: 'c1', operation: 'get_balance', outcome: 'success', userId: 'u1', agentId: 'a1' },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
    ]));
    expect(out.status).toBe('MATCH');
    expect(out.diffs).toEqual([]);
  });

  test('MISMATCH when the ledger has a gateway hop the witness never saw', () => {
    auditStore.query.mockReturnValue([
      { correlationId: 'other', operation: 'get_balance', outcome: 'success' },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'create_transfer', decision: { outcome: 'permit' } },
    ]));
    expect(out.status).toBe('MISMATCH');
    expect(out.diffs).toContainEqual(expect.objectContaining({
      source: 'mcpAuditStore', side: 'ledger_only', op: 'create_transfer',
    }));
  });

  test('MISMATCH when the witness saw a call the ledger has no hop for', () => {
    auditStore.query.mockReturnValue([
      { correlationId: 'c1', operation: 'create_transfer', outcome: 'success' },
      { correlationId: 'other', operation: 'x', outcome: 'success' },
    ]);
    const out = reconcile(rec([
      { service: 'demo-api-server', phase: 'ui.request' },
    ]));
    expect(out.status).toBe('MISMATCH');
    expect(out.diffs).toContainEqual(expect.objectContaining({
      source: 'mcpAuditStore', side: 'witness_only', op: 'create_transfer',
    }));
  });

  test('SOURCE_UNAVAILABLE when every witness store is empty — a fresh restart is not tampering', () => {
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
    ]));
    expect(out.status).toBe('SOURCE_UNAVAILABLE');
    expect(out.diffs).toEqual([]);
    expect(out.sources.mcpAuditStore.status).toBe('SOURCE_UNAVAILABLE');
  });

  test('SOURCE_UNAVAILABLE when a witness throws', () => {
    auditStore.query.mockImplementation(() => { throw new Error('lmdb down'); });
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
    ]));
    expect(out.sources.mcpAuditStore.status).toBe('SOURCE_UNAVAILABLE');
    expect(out.diffs).toEqual([]);
  });

  test('corroborates authz decisions against the traffic log', () => {
    trafficLogger.getMcpTrafficLog.mockReturnValue([
      { correlationId: 'c1', type: 'authorize_response', tool: 'create_withdrawal', ok: false },
    ]);
    const out = reconcile(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: { outcome: 'deny' } },
    ]));
    expect(out.sources.mcpTrafficLog.status).toBe('MATCH');
    expect(out.status).toBe('MATCH');
  });

  test('MISMATCH when an authz hop has no traffic-log counterpart', () => {
    trafficLogger.getMcpTrafficLog.mockReturnValue([
      { correlationId: 'other', type: 'authorize_response', tool: 'x', ok: true },
    ]);
    const out = reconcile(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: { outcome: 'deny' } },
    ]));
    expect(out.status).toBe('MISMATCH');
    expect(out.diffs).toContainEqual(expect.objectContaining({
      source: 'mcpTrafficLog', side: 'ledger_only', op: 'create_withdrawal',
    }));
  });

  test('a witness with nothing to corroborate is MATCH, not MISMATCH', () => {
    auditStore.query.mockReturnValue([{ correlationId: 'other', operation: 'x', outcome: 'success' }]);
    trafficLogger.getMcpTrafficLog.mockReturnValue([{ correlationId: 'other', type: 'authorize_response', tool: 'x' }]);
    const out = reconcile(rec([{ service: 'demo-api-server', phase: 'ui.request' }]));
    expect(out.status).toBe('MATCH');
    expect(out.diffs).toEqual([]);
  });

  test('duplicate ops are compared by count, so a replayed call surfaces', () => {
    auditStore.query.mockReturnValue([
      { correlationId: 'c1', operation: 'get_balance', outcome: 'success' },
      { correlationId: 'c1', operation: 'get_balance', outcome: 'success' },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
    ]));
    expect(out.status).toBe('MISMATCH');
    expect(out.diffs).toContainEqual(expect.objectContaining({ side: 'witness_only', op: 'get_balance' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionReconciler.test.js`
Expected: FAIL — `Cannot find module '../../services/transactionReconciler'`

- [ ] **Step 3: Write the reconciler**

Create `demo_api_server/services/transactionReconciler.js`:

```js
'use strict';
/**
 * Second-witness reconciliation for one transaction.
 *
 * The ledger is the primary witness. These sources are written by DIFFERENT
 * code paths, at different times, to different stores, so agreement between
 * them is real evidence — tampering with one and not the other is detectable.
 *
 * Deliberately NOT witnesses:
 *   - tokenChainService — transactionAssembler already derives token.exchange
 *     hops from it, so it would corroborate the record against itself.
 *   - authz auditDecision — stdout only; no file, no store, no reader.
 *   - mcpToolAuditStore — self-documented as a non-durable 200-event ring
 *     buffer; it would report false mismatches after every restart.
 *
 * SOURCE_UNAVAILABLE is never a violation. An empty or unreadable witness means
 * we cannot corroborate, not that someone tampered.
 */
const auditStore = require('./lmdb/mcpAuditStore.lmdb');
const trafficLogger = require('./mcpTrafficLogger');

const SCAN_LIMIT = 5000; // mcpAuditStore.query has no correlationId filter

/**
 * Compare two multisets of operation names and report both directions.
 * Counts matter: a witness that saw one call twice while the ledger recorded it
 * once is exactly the replay signal this exists to surface.
 */
function _diffOps(source, ledgerOps, witnessOps) {
  const diffs = [];
  const counts = new Map();
  for (const op of ledgerOps) counts.set(op, (counts.get(op) || 0) + 1);
  for (const op of witnessOps) counts.set(op, (counts.get(op) || 0) - 1);

  for (const [op, delta] of counts) {
    if (delta === 0) continue;
    const side = delta > 0 ? 'ledger_only' : 'witness_only';
    diffs.push({
      source,
      side,
      op,
      detail: delta > 0
        ? `ledger recorded "${op}" ${delta} more time(s) than ${source} did`
        : `${source} recorded "${op}" ${-delta} more time(s) than the ledger did`,
    });
  }
  return diffs;
}

function _reconcileGatewayAudit(record) {
  let rows;
  try {
    rows = auditStore.query({ limit: SCAN_LIMIT });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[transactionReconciler] mcpAuditStore read failed:', err?.message);
    return { status: 'SOURCE_UNAVAILABLE', diffs: [], reason: 'read_failed' };
  }
  // Zero rows for ANY transaction means the store was wiped or never written —
  // a fresh restart, not evidence of tampering.
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: 'SOURCE_UNAVAILABLE', diffs: [], reason: 'store_empty' };
  }

  const ledgerOps = record.hops
    .filter((h) => h.phase === 'gateway.authorize' && h.op)
    .map((h) => String(h.op));
  const witnessOps = rows
    .filter((r) => r.correlationId === record.correlationId && r.operation)
    .map((r) => String(r.operation));

  const diffs = _diffOps('mcpAuditStore', ledgerOps, witnessOps);
  return { status: diffs.length ? 'MISMATCH' : 'MATCH', diffs };
}

function _reconcileTrafficLog(record) {
  let lines;
  try {
    lines = trafficLogger.getMcpTrafficLog(SCAN_LIMIT);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[transactionReconciler] traffic log read failed:', err?.message);
    return { status: 'SOURCE_UNAVAILABLE', diffs: [], reason: 'read_failed' };
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return { status: 'SOURCE_UNAVAILABLE', diffs: [], reason: 'buffer_empty' };
  }

  const ledgerOps = record.hops
    .filter((h) => h.phase === 'authz.decision' && h.op)
    .map((h) => String(h.op));
  const witnessOps = lines
    .filter((l) => l.correlationId === record.correlationId && l.type === 'authorize_response' && l.tool)
    .map((l) => String(l.tool));

  const diffs = _diffOps('mcpTrafficLog', ledgerOps, witnessOps);
  return { status: diffs.length ? 'MISMATCH' : 'MATCH', diffs };
}

/**
 * @param {object} record  assembled transaction ({ correlationId, hops })
 * @returns {{status: string, diffs: object[], sources: object}}
 */
function reconcile(record) {
  const safe = { correlationId: record?.correlationId, hops: (record && record.hops) || [] };
  const sources = {
    mcpAuditStore: _reconcileGatewayAudit(safe),
    mcpTrafficLog: _reconcileTrafficLog(safe),
  };
  const diffs = Object.values(sources).flatMap((s) => s.diffs);
  const values = Object.values(sources);

  const status = diffs.length
    ? 'MISMATCH'
    : values.every((s) => s.status === 'SOURCE_UNAVAILABLE')
      ? 'SOURCE_UNAVAILABLE'
      : 'MATCH';

  return { status, diffs, sources };
}

module.exports = { reconcile };
```

- [ ] **Step 4: Attach reconciliation to the detail route**

In `demo_api_server/routes/transactionTrace.js`, add:

```js
const { reconcile } = require('../services/transactionReconciler');
```

and extend the detail response once more:

```js
  return res.json({
    ...record,
    traceId: traceIdFromCorrelation(record.correlationId),
    verdict: evaluate(record),
    reconciliation: reconcile(record),
  });
```

Add a mock and a test to `demo_api_server/tests/routes/transactionTrace.test.js`:

```js
jest.mock('../../services/transactionReconciler', () => ({
  reconcile: jest.fn(() => ({ status: 'MATCH', diffs: [], sources: {} })),
}));
```

```js
  test('attaches reconciliation to the detail payload', async () => {
    assemble.mockResolvedValue({ correlationId: 'c1', startedAt: 'A', endedAt: 'B', hops: [] });
    const res = await request(app()).get('/api/transaction-trace/c1');
    expect(res.body.reconciliation.status).toBe('MATCH');
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionReconciler.test.js tests/routes/transactionTrace.test.js`
Expected: PASS, 9 + 8 tests.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/transactionReconciler.js \
        demo_api_server/routes/transactionTrace.js \
        demo_api_server/tests/services/transactionReconciler.test.js \
        demo_api_server/tests/routes/transactionTrace.test.js
git commit -m "feat(reconcile): corroborate the ledger against gateway audit and traffic log"
```

---

## Phase P4 — Feature flag and UI

### Task 14: `ff_transaction_ledger` three-point wiring

**Files:**
- Modify: `demo_api_server/routes/featureFlags.js` (Observability block, after `ff_tracing` at line 174)
- Modify: `demo_api_server/services/configStore.js:276` (next to `ff_tracing`)
- Modify: `demo_api_ui/src/components/QuickFlagsPill.js:30` (next to the `ff_tracing` row)
- Modify: `demo_api_server/middleware/transactionTurn.js`, `demo_api_server/routes/transactionTrace.js`
- Test: `demo_api_server/tests/featureFlagsPinned.test.js` (extend), `demo_api_server/tests/routes/transactionTrace.test.js` (extend)

**Interfaces:**
- Consumes: `configStore.getEffective` (existing).
- Produces: flag id `ff_transaction_ledger`, boolean, default `true`, category `Observability`. OFF ⇒ the turn middleware emits nothing and `GET /api/transaction-trace*` returns `403 {error:'feature_disabled'}`.

The three points mirror `ff_tracing` exactly: registry entry (`featureFlags.js`), effective-value default (`configStore.js`), and quick-toggle row (`QuickFlagsPill.js`).

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_server/tests/featureFlagsPinned.test.js`:

```js
describe('ff_transaction_ledger flag registration', () => {
  test('exists in registry as a boolean defaulting to true', () => {
    const f = flagById('ff_transaction_ledger');
    expect(f).toBeDefined();
    expect(f.type).toBe('boolean');
    expect(f.defaultValue).toBe(true);
    expect(f.category).toBe('Observability');
  });
});
```

Append to `demo_api_server/tests/routes/transactionTrace.test.js`. Add this mock beside the others at the top of the file:

```js
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true') }));
```

```js
const configStore = require('../../services/configStore');
```

```js
  test('403 feature_disabled on the list route when the flag is off', async () => {
    configStore.getEffective.mockReturnValue('false');
    const res = await request(app()).get('/api/transaction-trace');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'feature_disabled' });
    configStore.getEffective.mockReturnValue('true');
  });

  test('403 feature_disabled on the detail route when the flag is off', async () => {
    configStore.getEffective.mockReturnValue('false');
    const res = await request(app()).get('/api/transaction-trace/c1');
    expect(res.status).toBe(403);
    configStore.getEffective.mockReturnValue('true');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest tests/featureFlagsPinned.test.js tests/routes/transactionTrace.test.js`
Expected: FAIL — flag undefined; routes return 200 instead of 403.

- [ ] **Step 3: Register the flag (point 1 of 3)**

In `demo_api_server/routes/featureFlags.js`, immediately after the `ff_tracing` entry (which closes at line 174), add:

```js
  {
    id:           'ff_transaction_ledger',
    name:         'Transaction Chain of Custody',
    category:     'Observability',
    description:
      'Record every hop of an agent turn — UI request, token exchange, gateway authorization, ' +
      'authz decision, HITL consent, MCP tool call, response — into a durable per-transaction ledger, ' +
      'then check identity invariants over it and corroborate it against independently written audit sinks. ' +
      'Viewable at Telemetry → Transaction Trace.',
    impact:       'ON = services emit hops and the Transaction Trace page shows the chain of custody with a PASS/FAIL verdict. OFF = no hops are recorded and the page reports the feature is disabled.',
    type:         'boolean',
    defaultValue: true,
  },
```

- [ ] **Step 4: Add the effective-value default (point 2 of 3)**

In `demo_api_server/services/configStore.js`, immediately after the `ff_tracing` line (276), add:

```js
  ff_transaction_ledger:       { public: true, default: 'true'  }, // per-transaction chain of custody + identity invariants
```

- [ ] **Step 5: Add the quick-toggle row (point 3 of 3)**

In `demo_api_ui/src/components/QuickFlagsPill.js`, immediately after the `ff_tracing` row (line 30), add:

```js
  { id: 'ff_transaction_ledger',        group: 'Observability',   control: 'toggle',    label: 'Transaction Chain of Custody' },
```

- [ ] **Step 6: Gate emission and the read routes**

In `demo_api_server/middleware/transactionTurn.js`, add the require and an early return:

```js
const configStore = require('../services/configStore');
```

```js
function transactionTurnMiddleware(req, res, next) {
  if (configStore.getEffective('ff_transaction_ledger') === 'false') return next();

  const startedAt = Date.now();
```

In `demo_api_server/routes/transactionTrace.js`, add the require and a router-level guard above both handlers:

```js
const configStore = require('../services/configStore');
```

```js
// OFF means the ledger is not being written, so serving a partial chain would
// misrepresent it as complete. Report the feature state instead.
router.use((req, res, next) => {
  if (configStore.getEffective('ff_transaction_ledger') === 'false') {
    return res.status(403).json({ error: 'feature_disabled' });
  }
  next();
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/featureFlagsPinned.test.js tests/routes/transactionTrace.test.js`
Expected: PASS, all tests including the two new 403 cases.

Run: `npm run topology:verify`
Expected: PASS — the flag is additive and introduces no scope drift.

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/routes/featureFlags.js \
        demo_api_server/services/configStore.js \
        demo_api_ui/src/components/QuickFlagsPill.js \
        demo_api_server/middleware/transactionTurn.js \
        demo_api_server/routes/transactionTrace.js \
        demo_api_server/tests/featureFlagsPinned.test.js \
        demo_api_server/tests/routes/transactionTrace.test.js
git commit -m "feat(flags): add ff_transaction_ledger and gate emission and read routes"
```

---

### Task 15: Transaction Trace page

**Files:**
- Create: `demo_api_ui/src/pages/TransactionTracePage.jsx`, `demo_api_ui/src/pages/TransactionTracePage.css`
- Test: `demo_api_ui/src/pages/__tests__/TransactionTracePage.test.jsx`

**Interfaces:**
- Consumes: `GET /api/transaction-trace?limit=` and `GET /api/transaction-trace/:correlationId` (Tasks 6, 12, 13).
- Produces: default-exported `TransactionTracePage` React component. Task 16 imports it.

Vertical chain of custody: hop cards stacked top to bottom, violations rendered inline as red bands anchored at the offending hop. Matches `TracingPage.jsx`'s idiom — `fetch` with `credentials: "include"`, a sibling `.css` file, no component library.

**Emoji are restricted to the REGRESSION_PLAN §0 allowlist:** ✅ PASS, ❌ FAIL, ⚠️ INCOMPLETE, 🔐 token hops, 👤 subject, 🔑 scopes. No others.

The UI test harness is **vitest + React Testing Library**, not jest — `vi.stubGlobal("fetch", ...)`, per `TracingPage.test.jsx`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/pages/__tests__/TransactionTracePage.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransactionTracePage from "../TransactionTracePage";

function jsonOk(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function jsonFail(status, body = {}) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) });
}

const LIST = {
  transactions: [
    { correlationId: "c-fail", startedAt: "2026-07-18T14:19:44.000Z", endedAt: "2026-07-18T14:19:45.000Z", hopCount: 4 },
    { correlationId: "c-pass", startedAt: "2026-07-18T14:22:07.000Z", endedAt: "2026-07-18T14:22:08.000Z", hopCount: 6 },
  ],
};

const DETAIL_FAIL = {
  correlationId: "c-fail",
  traceId: "abcd1234abcd1234abcd1234abcd1234",
  startedAt: "2026-07-18T14:19:44.000Z",
  endedAt: "2026-07-18T14:19:45.000Z",
  hops: [
    { seq: 1, ts: "2026-07-18T14:19:44.000Z", service: "demo-api-server", phase: "ui.request", op: "POST /message", identity: { sub: "demoUser" }, source: "emit" },
    { seq: 2, ts: "2026-07-18T14:19:44.100Z", service: "authz-server", phase: "authz.decision", op: "create_withdrawal", decision: { outcome: "deny", by: "mock", reason: "Amount > 2000" }, source: "emit" },
    { seq: 3, ts: "2026-07-18T14:19:44.300Z", service: "mcp-server", phase: "mcp.tool", op: "create_withdrawal", source: "emit" },
  ],
  verdict: {
    status: "FAIL",
    violations: [{ id: "INV-6", severity: "error", hopSeq: 3, detail: '"create_withdrawal" executed after a deny at hop 2 (Amount > 2000)' }],
  },
  reconciliation: { status: "MATCH", diffs: [], sources: {} },
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("TransactionTracePage", () => {
  it("lists transactions newest-first with their hop counts", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    expect(screen.getByText("c-pass")).toBeInTheDocument();
    expect(screen.getByText("6 hops")).toBeInTheDocument();
  });

  it("expands a row into a hop chain with the verdict badge", async () => {
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(DETAIL_FAIL) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => expect(screen.getByText("authz-server")).toBeInTheDocument());
    expect(screen.getByText("mcp-server")).toBeInTheDocument();
    expect(screen.getByText(/❌ FAIL/)).toBeInTheDocument();
  });

  it("renders a violation band anchored at the offending hop", async () => {
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(DETAIL_FAIL) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => expect(screen.getByText(/INV-6/)).toBeInTheDocument());
    const band = screen.getByTestId("violation-3");
    expect(band).toHaveTextContent("INV-6");
    expect(band).toHaveTextContent("executed after a deny");
  });

  it("shows a Jaeger deep link built from the traceId", async () => {
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(DETAIL_FAIL) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => {
      const link = screen.getByRole("link", { name: "Jaeger" });
      expect(link.getAttribute("href")).toContain("abcd1234abcd1234abcd1234abcd1234");
    });
  });

  it("renders SOURCE_UNAVAILABLE as unknown, visually distinct from a mismatch", async () => {
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail")
        ? jsonOk({ ...DETAIL_FAIL, reconciliation: { status: "SOURCE_UNAVAILABLE", diffs: [], sources: {} } })
        : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => {
      const pill = screen.getByTestId("reconciliation-pill");
      expect(pill).toHaveTextContent(/not corroborated/i);
      expect(pill.className).toContain("unknown");
      expect(pill.className).not.toContain("mismatch");
    });
  });

  it("reports the disabled feature instead of an empty list on 403", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonFail(403, { error: "feature_disabled" })));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText(/Transaction Chain of Custody is off/i)).toBeInTheDocument());
  });

  it("shows an empty-state explainer when no transactions have been recorded", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonOk({ transactions: [] })));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText(/No transactions recorded yet/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/TransactionTracePage.test.jsx`
Expected: FAIL — cannot resolve `../TransactionTracePage`.

- [ ] **Step 3: Write the page**

Create `demo_api_ui/src/pages/TransactionTracePage.jsx`:

```jsx
// demo_api_ui/src/pages/TransactionTracePage.jsx
import React, { useCallback, useEffect, useState } from "react";
import "./TransactionTracePage.css";

const REFRESH_MS = 15000;
const TOKEN_CHAIN_HREF = "/monitoring/token-chain";
const JAEGER_TRACE_HREF = "/jaeger/trace/";

// REGRESSION_PLAN §0 allowlist only.
const VERDICT_BADGE = {
  PASS: "✅ PASS",
  FAIL: "❌ FAIL",
  INCOMPLETE: "⚠️ INCOMPLETE",
};

const PHASE_ICON = {
  "token.exchange": "🔐",
};

const RECONCILIATION_LABEL = {
  MATCH: "corroborated",
  MISMATCH: "does not match second witness",
  SOURCE_UNAVAILABLE: "not corroborated — second witness unavailable",
};

const RECONCILIATION_CLASS = {
  MATCH: "match",
  MISMATCH: "mismatch",
  SOURCE_UNAVAILABLE: "unknown",
};

function fmtTime(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString() : "—";
}

function Identity({ identity }) {
  if (!identity) return null;
  const scopes = Array.isArray(identity.scopes) ? identity.scopes : [];
  const act = Array.isArray(identity.act) ? identity.act : [];
  return (
    <div className="ttrace-identity">
      {identity.sub ? <span>👤 {identity.sub}</span> : null}
      {act.length ? <span>act[{act.join(" → ")}]</span> : null}
      {scopes.length ? <span>🔑 {scopes.join(" ")}</span> : null}
      {identity.aud ? <span>aud={String(identity.aud)}</span> : null}
    </div>
  );
}

function Decision({ decision }) {
  if (!decision || decision.outcome === "n/a") return null;
  const denied = decision.outcome === "deny";
  return (
    <div className={`ttrace-decision ${denied ? "deny" : "permit"}`}>
      {denied ? "❌ DENY" : "✓ PERMIT"}
      {decision.reason ? <span className="ttrace-reason">{decision.reason}</span> : null}
    </div>
  );
}

function HopCard({ hop, violations }) {
  return (
    <>
      <li className="ttrace-hop">
        <span className="ttrace-seq">{hop.seq}</span>
        <div className="ttrace-hop-body">
          <div className="ttrace-hop-head">
            <strong>{hop.service}</strong>
            <span className="ttrace-phase">
              {PHASE_ICON[hop.phase] ? `${PHASE_ICON[hop.phase]} ` : ""}
              {hop.phase}
            </span>
            {hop.op ? <span className="ttrace-op">{hop.op}</span> : null}
            {Number.isFinite(hop.durationMs) ? <span className="ttrace-ms">{hop.durationMs}ms</span> : null}
            {hop.source === "derived" ? <span className="ttrace-derived">derived</span> : null}
          </div>
          <Identity identity={hop.identity} />
          <Decision decision={hop.decision} />
        </div>
      </li>
      {violations.map((v) => (
        <li key={v.id + v.detail} className="ttrace-violation" data-testid={`violation-${hop.seq}`}>
          ❌ {v.id} — {v.detail}
        </li>
      ))}
    </>
  );
}

function TraceDetail({ detail }) {
  const byHop = new Map();
  for (const v of detail.verdict?.violations || []) {
    const key = v.hopSeq ?? "unanchored";
    if (!byHop.has(key)) byHop.set(key, []);
    byHop.get(key).push(v);
  }
  const rStatus = detail.reconciliation?.status || "SOURCE_UNAVAILABLE";

  return (
    <div className="ttrace-detail">
      <div className="ttrace-detail-head">
        <span className={`ttrace-verdict ${(detail.verdict?.status || "").toLowerCase()}`}>
          {VERDICT_BADGE[detail.verdict?.status] || "⚠️ INCOMPLETE"}
        </span>
        <span
          className={`ttrace-recon ${RECONCILIATION_CLASS[rStatus] || "unknown"}`}
          data-testid="reconciliation-pill"
        >
          {RECONCILIATION_LABEL[rStatus] || RECONCILIATION_LABEL.SOURCE_UNAVAILABLE}
        </span>
        <span className="ttrace-links">
          {detail.traceId ? (
            <a href={`${JAEGER_TRACE_HREF}${detail.traceId}`} target="_blank" rel="noreferrer">Jaeger</a>
          ) : null}
          <a href={TOKEN_CHAIN_HREF}>Token Chain</a>
        </span>
      </div>

      {(byHop.get("unanchored") || []).map((v) => (
        <div key={v.id + v.detail} className="ttrace-violation">❌ {v.id} — {v.detail}</div>
      ))}

      <ul className="ttrace-hops">
        {(detail.hops || []).map((hop) => (
          <HopCard key={hop.seq} hop={hop} violations={byHop.get(hop.seq) || []} />
        ))}
      </ul>
    </div>
  );
}

export default function TransactionTracePage() {
  const [transactions, setTransactions] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/transaction-trace?limit=50", { credentials: "include" });
      if (res.status === 403) {
        setDisabled(true);
        setLoaded(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setDisabled(false);
      setError(null);
      setTransactions(body.transactions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, REFRESH_MS);
    return () => clearInterval(t);
  }, [loadList]);

  const toggle = useCallback(async (correlationId) => {
    if (expanded === correlationId) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(correlationId);
    setDetail(null);
    try {
      const res = await fetch(`/api/transaction-trace/${encodeURIComponent(correlationId)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail(await res.json());
    } catch (err) {
      setError(err.message);
    }
  }, [expanded]);

  return (
    <div className="ttrace-page">
      <header className="ttrace-header">
        <h1>Transaction Trace</h1>
        <p className="ttrace-sub">
          One agent turn, hop by hop — who acted, under whose delegation, with what authorization.
        </p>
      </header>

      {disabled ? (
        <div className="ttrace-notice">
          ⚠️ Transaction Chain of Custody is off. Enable <code>ff_transaction_ledger</code> on the
          Feature Flags page to start recording.
        </div>
      ) : null}

      {error && !disabled ? <div className="ttrace-notice">⚠️ {error}</div> : null}

      {loaded && !disabled && transactions.length === 0 ? (
        <div className="ttrace-notice">
          No transactions recorded yet. Run one agent turn, then refresh.
        </div>
      ) : null}

      <ul className="ttrace-list">
        {transactions.map((t) => (
          <li key={t.correlationId}>
            <button
              type="button"
              className="ttrace-row"
              onClick={() => toggle(t.correlationId)}
              aria-expanded={expanded === t.correlationId}
            >
              <span className="ttrace-time">{fmtTime(t.startedAt)}</span>
              <span className="ttrace-cid">{t.correlationId}</span>
              <span className="ttrace-count">{t.hopCount} hops</span>
            </button>
            {expanded === t.correlationId && detail ? <TraceDetail detail={detail} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

Create `demo_api_ui/src/pages/TransactionTracePage.css`:

```css
.ttrace-page {
  padding: 20px;
  background: #f9fafb;
  min-height: 100vh;
  max-width: 1200px;
  margin: 0 auto;
}

.ttrace-header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}

.ttrace-sub {
  margin: 4px 0 16px;
  color: #6b7280;
  font-size: 14px;
}

.ttrace-notice {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 12px;
  font-size: 14px;
}

.ttrace-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.ttrace-row {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.ttrace-row:hover { background: #f3f4f6; }
.ttrace-time { color: #6b7280; font-variant-numeric: tabular-nums; }
.ttrace-cid { font-family: ui-monospace, monospace; flex: 1; }
.ttrace-count { color: #6b7280; }

.ttrace-detail {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 14px;
  margin: 0 0 12px;
}

.ttrace-detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 12px;
}

.ttrace-verdict { font-weight: 700; }
.ttrace-verdict.fail { color: #b91c1c; }
.ttrace-verdict.pass { color: #047857; }
.ttrace-verdict.incomplete { color: #b45309; }

.ttrace-recon {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
}

/* Unknown must not read as a failure — an unavailable witness is not tampering. */
.ttrace-recon.match { background: #ecfdf5; color: #047857; }
.ttrace-recon.mismatch { background: #fef2f2; color: #b91c1c; }
.ttrace-recon.unknown { background: #f3f4f6; color: #6b7280; }

.ttrace-links { margin-left: auto; display: flex; gap: 12px; font-size: 13px; }

.ttrace-hops { list-style: none; margin: 0; padding: 0; }

.ttrace-hop {
  display: flex;
  gap: 12px;
  padding: 10px 0 10px 12px;
  border-left: 2px solid #d1d5db;
}

.ttrace-seq { color: #9ca3af; font-variant-numeric: tabular-nums; min-width: 18px; }
.ttrace-hop-body { flex: 1; }

.ttrace-hop-head {
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
  font-size: 14px;
}

.ttrace-phase { color: #6b7280; font-family: ui-monospace, monospace; font-size: 12px; }
.ttrace-op { font-family: ui-monospace, monospace; font-size: 12px; }
.ttrace-ms { color: #9ca3af; font-size: 12px; margin-left: auto; }

.ttrace-derived {
  font-size: 11px;
  color: #6b7280;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0 6px;
}

.ttrace-identity {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 4px;
  font-size: 12px;
  color: #4b5563;
}

.ttrace-decision { margin-top: 4px; font-size: 12px; font-weight: 600; }
.ttrace-decision.deny { color: #b91c1c; }
.ttrace-decision.permit { color: #047857; }
.ttrace-reason { font-weight: 400; color: #6b7280; margin-left: 8px; }

.ttrace-violation {
  list-style: none;
  background: #fef2f2;
  border-left: 3px solid #b91c1c;
  color: #b91c1c;
  padding: 8px 12px;
  margin: 4px 0;
  font-size: 13px;
  font-weight: 600;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/TransactionTracePage.test.jsx`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/TransactionTracePage.jsx \
        demo_api_ui/src/pages/TransactionTracePage.css \
        demo_api_ui/src/pages/__tests__/TransactionTracePage.test.jsx
git commit -m "feat(ui): add Transaction Trace chain-of-custody page"
```

---

### Task 16: Nav and routing

**Files:**
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx:156`, `:708-715`
- Modify: `demo_api_ui/src/App.js:118` (imports), `:567-581` (routes)
- Test: `demo_api_ui/src/components/__tests__/AdminSideNav.telemetry.test.jsx`

**Interfaces:**
- Consumes: `TransactionTracePage` (Task 15).
- Produces: route `/transaction-trace`, reachable from Telemetry → Transaction Trace.

`/transactions` is already the banking transactions route (`App.js:1176`) and is claimed by the `users-accounts` auto-expand group (`AdminSideNav.jsx:153`), so this uses `/transaction-trace` throughout (deviation #1).

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/AdminSideNav.telemetry.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import AdminSideNav from "../AdminSideNav";

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminSideNav user={{ role: "admin", name: "demoAdmin" }} />
    </MemoryRouter>,
  );
}

describe("AdminSideNav Telemetry group", () => {
  it("lists Transaction Trace beside Tracing and Health Check", async () => {
    renderAt("/transaction-trace");
    expect(await screen.findByText("Transaction Trace")).toBeInTheDocument();
    expect(screen.getByText("Tracing")).toBeInTheDocument();
    expect(screen.getByText("Health Check")).toBeInTheDocument();
  });

  it("links Transaction Trace to /transaction-trace, not /transactions", async () => {
    renderAt("/transaction-trace");
    const link = (await screen.findByText("Transaction Trace")).closest("a");
    expect(link.getAttribute("href")).toBe("/transaction-trace");
  });

  it("auto-expands Telemetry when the route is /transaction-trace", async () => {
    renderAt("/transaction-trace");
    expect(await screen.findByText("Transaction Trace")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AdminSideNav.telemetry.test.jsx`
Expected: FAIL — "Transaction Trace" is not in the document.

- [ ] **Step 3: Add the nav child**

In `demo_api_ui/src/components/AdminSideNav.jsx`, replace the Telemetry group (lines 708-715) with:

```jsx
    {
      label: "Telemetry",
      icon: "log",
      children: [
        { label: "Tracing", path: "/tracing", icon: "log" },
        { label: "Transaction Trace", path: "/transaction-trace", icon: "log" },
        { label: "Health Check", path: "/check", icon: "clk" },
      ],
    },
```

- [ ] **Step 4: Add the auto-expand path**

Replace line 156:

```jsx
  { id: "telemetry", paths: ["/tracing", "/transaction-trace", "/check"] },
```

- [ ] **Step 5: Register the route**

In `demo_api_ui/src/App.js`, add the import next to the `TracingPage` import at line 118:

```jsx
import TransactionTracePage from "./pages/TransactionTracePage";
```

Immediately after the `/tracing` route block (which closes at line 581), add a matching block:

```jsx
                <Route
                  path="/transaction-trace"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <TransactionTracePage />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
```

- [ ] **Step 6: Run tests and the build gate**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AdminSideNav.telemetry.test.jsx src/pages/__tests__/TransactionTracePage.test.jsx`
Expected: PASS, 3 + 7 tests.

Run: `cd demo_api_ui && npm run build`
Expected: build succeeds. This is the REGRESSION_PLAN UI gate — the work is not done until it is green.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/AdminSideNav.jsx \
        demo_api_ui/src/App.js \
        demo_api_ui/src/components/__tests__/AdminSideNav.telemetry.test.jsx
git commit -m "feat(ui): add Transaction Trace to the Telemetry nav group and routing"
```

---

## Phase P5 — Acceptance

### Task 17: End-to-end verification

**Files:**
- Create: `docs/superpowers/plans/2026-07-18-transaction-chain-of-custody-acceptance.md` (the recorded evidence)
- No source changes. If a criterion fails, fix it in the task that owns the code and re-run.

**Interfaces:**
- Consumes: every prior task.
- Produces: recorded evidence that the four spec acceptance criteria hold.

This task exists because the unit tests prove the engine is correct in isolation, not that six services actually agree at runtime. Do not mark the plan complete without pasting real output into the evidence file.

- [ ] **Step 1: Bring up the stack and confirm the flag is on**

```bash
./run-docker.sh
curl -sk https://api.ping.demo:3001/api/config/public | grep -o 'ff_transaction_ledger[^,]*'
```

Expected: `ff_transaction_ledger":"true"`.

- [ ] **Step 2: Criterion 1 — a happy-path turn produces a complete chain**

Drive one banking balance chip in the UI at `https://api.ping.demo:4000`, then:

```bash
curl -sk --cookie /tmp/cj https://api.ping.demo:3001/api/transaction-trace?limit=1
CID=<correlationId from the response>
curl -sk --cookie /tmp/cj "https://api.ping.demo:3001/api/transaction-trace/$CID" > /tmp/trace.json
node -e "const t=require('/tmp/trace.json'); console.log('hops', t.hops.length, 'services', [...new Set(t.hops.map(h=>h.service))].join(','), 'verdict', t.verdict.status, 'recon', t.reconciliation.status)"
```

Expected: `hops >= 6`, four or more distinct services, `verdict PASS`, `recon MATCH`.

If `verdict` is `INCOMPLETE` with INV-5, no decision hop reached the ledger — check `BFF_TRANSACTION_HOP_URL` on `authz-server` and `mcp-gateway`. If `recon` is `SOURCE_UNAVAILABLE`, the witness stores are empty; run a second turn and re-check.

- [ ] **Step 3: Criterion 2 — a deny is recorded and INV-6 stays PASS**

Turn on `ff_authorize_group_policy` on the Feature Flags page, then ask the agent for a `create_withdrawal` above $2000. Fetch that transaction and assert:

```bash
node -e "const t=require('/tmp/trace2.json'); const deny=t.hops.find(h=>h.decision&&h.decision.outcome==='deny'); console.log('deny hop', !!deny, 'INV-6 fired', t.verdict.violations.some(v=>v.id==='INV-6'))"
```

Expected: `deny hop true`, `INV-6 fired false`. The deny was honored — the tool did not run. This proves the engine does not simply fire on the presence of any deny.

- [ ] **Step 4: Criterion 3 — a tampered record trips INV-5**

```bash
node -e "
const t = require('/tmp/trace.json');
t.hops = t.hops.filter(h => h.phase !== 'authz.decision' && h.phase !== 'gateway.authorize');
const { evaluate } = require('./demo_api_server/services/transactionInvariants');
const v = evaluate(t);
console.log(v.status, v.violations.map(x => x.id + ':' + x.severity).join(','));
"
```

Expected: `INCOMPLETE INV-5:incomplete` — with every decision hop removed there is no evidence to evaluate, which is reported as absence, not as a violation. To see the `error` form, instead move the decision hop *after* the tool hop by swapping their `seq` values; that yields `FAIL INV-5:error`.

- [ ] **Step 5: Jaeger deep-link resolves to a real trace**

Open Telemetry → Transaction Trace, expand the transaction from Step 2, and click **Jaeger**. Confirm the Jaeger UI opens that exact trace rather than a "Trace not found" page.

```bash
node -e "const t=require('/tmp/trace.json'); console.log(t.traceId)"
curl -s "http://localhost:16686/api/traces/$(node -e "console.log(require('/tmp/trace.json').traceId)")" | head -c 200
```

**Expect a partial trace, and do not treat that as a failure.** The ledger's `traceId` is *derived* from the correlation id; the OTel SDK mints its own trace-id for each root span. These coincide only where a service adopted the incoming `traceparent` that `outboundTracing.js` stamps — that is, the **downstream** services (gateway, mcp-server, authz-server), not the BFF's own root span, which the SDK created before any header existed.

So the correct expectation is: the deep-link resolves and shows the downstream spans of the transaction. It will **not** show a single trace rooted at the BFF request.

Expected: a JSON body containing at least one span, not `{"data":null}`. If it returns null, the derived-trace-id link is not viable in this environment — record that in the evidence file and treat the Jaeger link as best-effort. Making the BFF root span adopt the derived trace-id would require a custom OTel `IdGenerator` or an explicit root-span context, which is deliberately out of scope: the ledger, not Jaeger, is the chain of custody.

- [ ] **Step 6: Criterion 4 — full suites and gates green**

```bash
./run-tests.sh unit
cd demo_api_ui && npm run build && cd ..
npm run topology:verify
npm run hygiene:check
```

Expected: all green. Per repo memory, GitHub Actions is billing-blocked, so local runs are the real gate — a red CI badge is not evidence of a problem here.

- [ ] **Step 7: Record the evidence and commit**

Write the actual command output from Steps 2-5 into `docs/superpowers/plans/2026-07-18-transaction-chain-of-custody-acceptance.md` — real output, not a summary of it.

```bash
git add docs/superpowers/plans/2026-07-18-transaction-chain-of-custody-acceptance.md
git commit -m "docs: record transaction chain-of-custody acceptance evidence"
```

---

## Definition of done

- [ ] All 17 tasks committed on `worktree-transaction-chain-of-custody`
- [ ] `./run-tests.sh unit` green with `CI=true`
- [ ] `cd demo_api_ui && npm run build` green
- [ ] `npm run topology:verify` and `npm run hygiene:check` green
- [ ] Acceptance evidence file contains real output for all four criteria
- [ ] No modification to `demo_api_server/routes/oauth.js`, `demo_api_server/services/oauthService.js`, or the BFF session layer — verify with `git diff --stat main...HEAD -- demo_api_server/routes/oauth.js demo_api_server/services/oauthService.js` returning empty
- [ ] No emoji outside the REGRESSION_PLAN §0 allowlist — verify with `git diff main...HEAD -- demo_api_ui | grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' | grep -vP '[⚠️✅❌🔐✕✓👤🔑🪟📚]'` returning empty
