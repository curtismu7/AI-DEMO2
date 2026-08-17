# Prompt Flow Backend Ledger + Read API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `demo_api_server` a `backend.request` hop in the shared transaction ledger for every correlation-tagged request, plus two admin-gated read endpoints (`GET /api/prompt-flow`, `GET /api/prompt-flow/:correlationId`) that the Prompt Flow Inspector UI (a sibling plan) will consume.

**Architecture:** `middleware/activityLogger.js` already builds a rich per-request log entry and writes it to `dataStore` (the `activityLog` store). This plan adds a second, in-process write of the same detail into `services/lmdb/transactionLedger.lmdb.js` via the existing `services/transactionHop.js#emitHop()` helper — no HTTP hop, no new store. A new `routes/promptFlow.js` router then reads that same ledger (already populated by Agent/LLM-proxy/Gateway/P1AZ hops from sibling plans) and exposes a paginated run list and a per-run hop detail view, gated in `server.js` with the identical inline admin-session check `routes/mcpAudit.js` already uses.

**Tech Stack:** Node >= 22, CommonJS, Express 4.18, `lmdb`, Jest 29.7 + supertest.

**Spec:** docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md

## Global Constraints

- No schema migration: the ledger's `details` field already accepts an arbitrary object (spec §2).
- Backend currently has NO ledger entry at all; `activityLogger` writes its own `activityLog` record — this plan adds a *second*, in-process write of `phase:'backend.request'` into `transactionLedger.lmdb.js` alongside it, carrying the same detail already captured for the activity log (spec §2).
- The write is in-process (the ledger lives in this same service) — no HTTP hop needed (spec §2).
- Both read endpoints are pure reads against `transactionLedger.lmdb.js` filtered by `correlationId` — no new store (spec §4).
- Both read endpoints are admin-session gated, same pattern as existing `GET /api/mcp/audit` (spec §4).
- All hop emissions follow the established fire-and-forget pattern: swallow errors, never block or fail a user-facing request (spec §6).
- Missing/unknown `correlationId` at the read endpoint → empty result, not an error (spec §6).
- Backend unit tests must cover the two new endpoints against a fixture ledger with full `details` payloads (spec §7).
- Do not modify `services/lmdb/transactionLedger.lmdb.js`'s exported interface — four sibling plans (gateway, P1AZ, LLM proxy, agent) already write to it through `appendHop`/`emitHop`; changing its signatures would break work happening in parallel.

---

### Task 1: Backend → ledger write (`activityLogger.js`)

**Files:**
- Modify: `demo_api_server/middleware/activityLogger.js:1-2` (add `emitHop` import), `demo_api_server/middleware/activityLogger.js:128-147` (emit the hop alongside the existing `dataStore.createActivityLog` call)
- Test: `demo_api_server/tests/middleware/activityLogger.ledgerHop.test.js` (new file; no `tests/middleware/` directory exists yet)

**Interfaces:**
- Consumes: `emitHop(hop)` from `demo_api_server/services/transactionHop.js` — existing, unchanged. Shape: `{ phase, op?, identity?, decision?, durationMs?, status?, correlationId?, service?, details? }`. Resolves `correlationId` from `AsyncLocalStorage` via `getCorrelationId()` when not passed explicitly, and no-ops if none is in scope (see `demo_api_server/utils/correlationContext.js`).
- Produces: no new exports. After this task, any request that arrives carrying an inbound `x-request-id`/`x-correlation-id` header gets one `phase:'backend.request'` hop appended to its `transactionLedger.lmdb` record.

**Design note (documented here so a reviewer can override it):** `middleware/correlationId.js` mints a fresh id for *every* request (client header, else `randomUUID()`), so gating purely on "a correlationId is present" would write a ledger record for every GET/POST the API serves (session polls, static-adjacent calls, etc.) and flood the ledger's 500-record cap (`transactionLedger.lmdb.js`'s `MAX_TRANSACTIONS`) with single-hop noise unrelated to any traced prompt flow — the same concern `middleware/transactionTurn.js` documents for why it's mounted only on two routes rather than app-wide. This plan instead gates on the request having *carried* the id (an inbound `x-request-id`/`x-correlation-id` header), which is true precisely when an upstream layer (agent, gateway, or a client replaying a traced flow) already tagged the request — i.e., exactly the traffic the Prompt Flow Inspector cares about.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/middleware/activityLogger.ledgerHop.test.js`:

```js
'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  appendHop: jest.fn(),
}));
jest.mock('../../data/store', () => ({
  createActivityLog: jest.fn().mockResolvedValue({}),
}));

const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const { runWithCorrelation } = require('../../utils/correlationContext');
const { logActivity } = require('../../middleware/activityLogger');

function makeReq(overrides = {}) {
  return {
    path: '/api/balance',
    originalUrl: '/api/balance',
    method: 'GET',
    headers: {},
    user: { id: 'u1', username: 'demoUser' },
    get: (name) => (name === 'User-Agent' ? 'jest-agent' : null),
    ip: '127.0.0.1',
    connection: {},
    ...overrides,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    send(data) { return data; },
  };
}

describe('activityLogger — backend.request ledger hop', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writes a backend.request hop when the request carries an inbound correlation id', () => {
    const req = makeReq({ headers: { 'x-correlation-id': 'c-inbound-1' } });
    const res = makeRes();

    runWithCorrelation('c-inbound-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ ok: true }));
    });

    expect(ledger.appendHop).toHaveBeenCalledWith('c-inbound-1', expect.objectContaining({
      phase: 'backend.request',
      op: 'GET /api/balance',
      service: 'demo-api-server',
      status: 'ok',
      identity: { sub: 'u1' },
    }));
  });

  test('does NOT write a ledger hop when no inbound correlation id header was present', () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();

    runWithCorrelation('c-generated-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ ok: true }));
    });

    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('marks the hop status "error" for a >=400 response', () => {
    const req = makeReq({ headers: { 'x-request-id': 'c-err-1' } });
    const res = makeRes();
    res.statusCode = 500;

    runWithCorrelation('c-err-1', () => {
      logActivity(req, res, () => {});
      res.send(JSON.stringify({ error: 'boom' }));
    });

    expect(ledger.appendHop).toHaveBeenCalledWith('c-err-1', expect.objectContaining({ status: 'error' }));
  });

  test('skips /health entirely — pre-existing early-return behavior preserved', () => {
    const req = makeReq({ path: '/health', headers: { 'x-correlation-id': 'c-health' } });
    const res = makeRes();
    const next = jest.fn();

    runWithCorrelation('c-health', () => {
      logActivity(req, res, next);
    });

    expect(next).toHaveBeenCalled();
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/middleware/activityLogger.ledgerHop.test.js --forceExit`
Expected: FAIL — `expect(ledger.appendHop).toHaveBeenCalledWith(...)` receives 0 calls (the hop isn't emitted yet).

- [ ] **Step 3: Write minimal implementation**

In `demo_api_server/middleware/activityLogger.js`, add the import at the top (after the existing `dataStore` require):

```js
const dataStore = require('../data/store');
const { emitHop } = require('../services/transactionHop');
```

Then, inside `logActivity`'s `res.send` override, immediately after the `logEntry` object is built (right after the closing brace of the `const logEntry = { ... };` block, before the `dataStore.createActivityLog(logEntry)` call), add:

```js
      // Also chain this request into the shared transaction ledger as a
      // 'backend.request' hop — but only when the request arrived carrying an
      // upstream correlation id (agent/gateway/P1AZ already tagged it), not
      // for ordinary UI-direct calls where middleware/correlationId.js had to
      // mint a fresh id locally. Every BFF request gets *some* correlationId,
      // so gating on presence alone would write a ledger record for every
      // GET/POST the API serves and flood the 500-record cap
      // (services/lmdb/transactionLedger.lmdb.js MAX_TRANSACTIONS) with
      // single-hop noise unrelated to any traced prompt flow.
      const hadInboundCorrelationId = Boolean(
        req.headers['x-request-id'] || req.headers['x-correlation-id']
      );
      if (hadInboundCorrelationId) {
        emitHop({
          phase: 'backend.request',
          op: logEntry.endpoint,
          identity: { sub: userId ? String(userId) : null },
          durationMs: duration,
          status: res.statusCode >= 400 ? 'error' : 'ok',
          details: {
            username: logEntry.username,
            action: logEntry.action,
            ipAddress: logEntry.ipAddress,
            userAgent: logEntry.userAgent,
            authorization: logEntry.authorization,
            requestBody: logEntry.requestBody,
            responseStatus: logEntry.responseStatus,
          },
        });
      }

```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/middleware/activityLogger.ledgerHop.test.js --forceExit`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/middleware/activityLogger.js demo_api_server/tests/middleware/activityLogger.ledgerHop.test.js
git commit -m "$(cat <<'EOF'
Write backend.request hops into the transaction ledger

activityLogger now emits a phase:'backend.request' hop into
transactionLedger.lmdb (in-process, no HTTP hop) whenever a request carries
an inbound correlation id, so the Prompt Flow Inspector's ledger record
includes the backend layer alongside Agent/LLM proxy/Gateway/P1AZ hops.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Read API — `GET /api/prompt-flow` list endpoint

**Files:**
- Create: `demo_api_server/routes/promptFlow.js`
- Test: `demo_api_server/tests/routes/promptFlow.list.test.js`

**Interfaces:**
- Consumes: `ledger.listRecords({ limit })` and `ledger.getRecord(correlationId)` from `demo_api_server/services/lmdb/transactionLedger.lmdb.js` (existing, unmodified). `listRecords` returns newest-first `[{ correlationId, startedAt, endedAt, hopCount, principal }]`; `getRecord` returns `{ correlationId, startedAt, endedAt, hops: [...], principal } | null`.
- Produces: `router` (Express Router) exported from `demo_api_server/routes/promptFlow.js`, mounted at `/api/prompt-flow` in Task 4. `GET /` responds `{ runs: [{ correlationId, startedAt, endedAt, hopCount, principal, status, vertical }], limit, offset }`. Also exports (module-internal, not part of the public interface but reused by Task 3) helper functions `_resolveVertical(hops)` and `_resolveStatus(hops)` defined in this file.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/routes/promptFlow.list.test.js`:

```js
'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  listRecords: jest.fn(),
  getRecord: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const promptFlowRouter = require('../../routes/promptFlow');

function app() {
  const a = express();
  a.use('/api/prompt-flow', promptFlowRouter);
  return a;
}

describe('GET /api/prompt-flow', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns one summary per correlationId with status/vertical derived from hops', async () => {
    ledger.listRecords.mockReturnValue([
      { correlationId: 'c1', startedAt: '2026-08-16T00:00:00.000Z', endedAt: '2026-08-16T00:00:01.000Z', hopCount: 2, principal: 'u1' },
      { correlationId: 'c2', startedAt: '2026-08-16T00:01:00.000Z', endedAt: '2026-08-16T00:01:01.000Z', hopCount: 1, principal: null },
    ]);
    ledger.getRecord.mockImplementation((id) => {
      if (id === 'c1') {
        return { hops: [
          { phase: 'agent.step', status: 'ok', details: { vertical: 'sporting-goods' } },
          { phase: 'backend.request', status: 'ok' },
        ] };
      }
      if (id === 'c2') {
        return { hops: [{ phase: 'gateway.authorize', status: 'error' }] };
      }
      return null;
    });

    const res = await request(app()).get('/api/prompt-flow');

    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([
      expect.objectContaining({ correlationId: 'c1', status: 'ok', vertical: 'sporting-goods' }),
      expect.objectContaining({ correlationId: 'c2', status: 'error', vertical: null }),
    ]);
  });

  test('applies limit and offset for pagination', async () => {
    ledger.listRecords.mockReturnValue([
      { correlationId: 'c1', startedAt: 't1', endedAt: 't1', hopCount: 1, principal: null },
      { correlationId: 'c2', startedAt: 't2', endedAt: 't2', hopCount: 1, principal: null },
      { correlationId: 'c3', startedAt: 't3', endedAt: 't3', hopCount: 1, principal: null },
    ]);
    ledger.getRecord.mockReturnValue({ hops: [] });

    const res = await request(app()).get('/api/prompt-flow?limit=1&offset=1');

    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].correlationId).toBe('c2');
    expect(res.body.limit).toBe(1);
    expect(res.body.offset).toBe(1);
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: 2 });
  });

  test('defaults to limit 50 / offset 0 when no query params are given', async () => {
    ledger.listRecords.mockReturnValue([]);
    const res = await request(app()).get('/api/prompt-flow');
    expect(res.body).toEqual({ runs: [], limit: 50, offset: 0 });
    expect(ledger.listRecords).toHaveBeenCalledWith({ limit: 50 });
  });

  test('degrades to an empty list on a store read failure', async () => {
    ledger.listRecords.mockImplementation(() => { throw new Error('lmdb down'); });
    const res = await request(app()).get('/api/prompt-flow');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [], limit: 50, offset: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/routes/promptFlow.list.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../routes/promptFlow'`.

- [ ] **Step 3: Write minimal implementation**

Create `demo_api_server/routes/promptFlow.js`:

```js
'use strict';
/**
 * /api/prompt-flow — read-only view over transactionLedger.lmdb.js for the
 * Prompt Flow Inspector UI. Admin-session gated at the server.js mount level,
 * same pattern as GET /api/mcp/audit (routes/mcpAudit.js) — this router
 * itself carries no auth check.
 *
 * Both endpoints are pure reads against the ledger already populated by every
 * instrumented layer's hop emitter (Agent/LLM proxy/Gateway/P1AZ/Backend) —
 * no new store, no query-time join across services.
 */
const express = require('express');
const router = express.Router();
const ledger = require('../services/lmdb/transactionLedger.lmdb');

/** First non-empty `vertical` value found on any hop, else null. */
function _resolveVertical(hops) {
  for (const hop of hops) {
    const vertical = (hop && hop.details && hop.details.vertical) || (hop && hop.vertical);
    if (vertical) return vertical;
  }
  return null;
}

/** 'error' if any hop in the run reports status 'error', else 'ok'. */
function _resolveStatus(hops) {
  return hops.some((hop) => hop && hop.status === 'error') ? 'error' : 'ok';
}

/**
 * GET /api/prompt-flow — list recent runs: distinct correlationId + latest
 * timestamp + summary status + vertical, paginated.
 * Query params: limit (default 50), offset (default 0)
 */
router.get('/', (req, res) => {
  const limitParam = parseInt(String(req.query.limit), 10);
  const offsetParam = parseInt(String(req.query.offset), 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0;

  try {
    const summaries = ledger.listRecords({ limit: offset + limit });
    const page = summaries.slice(offset, offset + limit);

    const runs = page.map((summary) => {
      const record = ledger.getRecord(summary.correlationId);
      const hops = (record && record.hops) || [];
      return {
        correlationId: summary.correlationId,
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        hopCount: summary.hopCount,
        principal: summary.principal,
        status: _resolveStatus(hops),
        vertical: _resolveVertical(hops),
      };
    });

    return res.json({ runs, limit, offset });
  } catch (err) {
    // A read failure should degrade to an empty list, not a 500 that breaks
    // the admin page — mirrors routes/mcpAudit.js.
    console.warn('[promptFlow] list failed:', err?.message);
    return res.json({ runs: [], limit, offset });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/routes/promptFlow.list.test.js --forceExit`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/promptFlow.js demo_api_server/tests/routes/promptFlow.list.test.js
git commit -m "$(cat <<'EOF'
Add GET /api/prompt-flow list endpoint

Reads transactionLedger.lmdb for a paginated, newest-first list of runs
(one entry per correlationId) with a status and vertical summarized from
that run's hops. No new store — pure read over the existing ledger.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Read API — `GET /api/prompt-flow/:correlationId` detail endpoint

**Files:**
- Modify: `demo_api_server/routes/promptFlow.js` (append the detail route, after the `router.get('/', ...)` handler from Task 2 and before `module.exports`)
- Test: `demo_api_server/tests/routes/promptFlow.detail.test.js`

**Interfaces:**
- Consumes: `ledger.getRecord(correlationId)` (same as Task 2).
- Produces: `GET /:correlationId` responds `{ correlationId, startedAt, endedAt, principal, hops: [...] }` where `hops` is timestamp-ordered and each hop carries its full original `details` payload untouched. Unknown `correlationId` responds `200 { correlationId, hops: [] }` (no `startedAt`/`endedAt`/`principal`) — never an error.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/routes/promptFlow.detail.test.js`:

```js
'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  listRecords: jest.fn(),
  getRecord: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const promptFlowRouter = require('../../routes/promptFlow');

function app() {
  const a = express();
  a.use('/api/prompt-flow', promptFlowRouter);
  return a;
}

describe('GET /api/prompt-flow/:correlationId', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns hops ordered by timestamp with full details per hop', async () => {
    ledger.getRecord.mockReturnValue({
      correlationId: 'c1',
      startedAt: '2026-08-16T00:00:00.000Z',
      endedAt: '2026-08-16T00:00:05.000Z',
      principal: 'u1',
      hops: [
        { phase: 'backend.request', ts: '2026-08-16T00:00:05.000Z', seq: 3, details: { endpoint: 'GET /api/balance' } },
        { phase: 'agent.step', ts: '2026-08-16T00:00:00.000Z', seq: 1, details: { content: 'reasoning...' } },
        { phase: 'llm.call', ts: '2026-08-16T00:00:02.000Z', seq: 2, details: { model: 'llama' } },
      ],
    });

    const res = await request(app()).get('/api/prompt-flow/c1');

    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBe('c1');
    expect(res.body.principal).toBe('u1');
    expect(res.body.hops.map((h) => h.phase)).toEqual(['agent.step', 'llm.call', 'backend.request']);
    expect(res.body.hops[0].details).toEqual({ content: 'reasoning...' });
  });

  test('returns an empty hops array for an unknown correlationId, not an error', async () => {
    ledger.getRecord.mockReturnValue(null);
    const res = await request(app()).get('/api/prompt-flow/nope');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ correlationId: 'nope', hops: [] });
  });

  test('degrades to an empty hops array on a store read failure', async () => {
    ledger.getRecord.mockImplementation(() => { throw new Error('lmdb down'); });
    const res = await request(app()).get('/api/prompt-flow/c1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ correlationId: 'c1', hops: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/routes/promptFlow.detail.test.js --forceExit`
Expected: FAIL — 404s from `supertest` (no `:correlationId` route registered yet), so `res.status` is `404` not `200`.

- [ ] **Step 3: Write minimal implementation**

Append to `demo_api_server/routes/promptFlow.js`, after the `router.get('/', ...)` handler and before `module.exports = router;`:

```js
/**
 * GET /api/prompt-flow/:correlationId — all ledger hops for that run,
 * ordered by timestamp, each carrying its full `details` payload.
 */
router.get('/:correlationId', (req, res) => {
  try {
    const record = ledger.getRecord(req.params.correlationId);
    if (!record) {
      // Missing/unknown correlationId -> empty result, not an error.
      return res.json({ correlationId: req.params.correlationId, hops: [] });
    }
    const hops = [...record.hops].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return res.json({
      correlationId: record.correlationId,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      principal: record.principal,
      hops,
    });
  } catch (err) {
    console.warn('[promptFlow] detail failed:', err?.message);
    return res.json({ correlationId: req.params.correlationId, hops: [] });
  }
});

```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/routes/promptFlow.detail.test.js --forceExit`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/promptFlow.js demo_api_server/tests/routes/promptFlow.detail.test.js
git commit -m "$(cat <<'EOF'
Add GET /api/prompt-flow/:correlationId detail endpoint

Returns every ledger hop for one run, timestamp-ordered, with each hop's
full details payload intact. Unknown correlationId degrades to an empty
hops array rather than a 404/500, per the spec's read-endpoint error rule.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Admin-session gate + mount in `server.js`

**Files:**
- Modify: `demo_api_server/server.js:157` (require, alongside `mcpAuditRouter`), `demo_api_server/server.js:1173-1182` (mount, immediately after the existing `/api/mcp/audit` gate block)
- Test: `demo_api_server/tests/routes/promptFlow.gate.test.js`

**Interfaces:**
- Consumes: `promptFlowRouter` from `demo_api_server/routes/promptFlow.js` (Tasks 2–3).
- Produces: `/api/prompt-flow` and `/api/prompt-flow/:correlationId`, reachable only with `req.session.user.role === 'admin'`; otherwise `401 { error: 'admin_required', message: 'Admin session required to access prompt flow trace.' }` — same shape and status the `/api/mcp/audit` gate already returns.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/routes/promptFlow.gate.test.js`:

```js
'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  listRecords: jest.fn().mockReturnValue([]),
  getRecord: jest.fn().mockReturnValue(null),
}));

const express = require('express');
const request = require('supertest');
const promptFlowRouter = require('../../routes/promptFlow');

// Mirrors the exact admin gate server.js applies at the /api/prompt-flow
// mount point (server.js, immediately after the /api/mcp/audit gate) — the
// router itself carries no auth check, same as routes/mcpAudit.js.
function adminGate(req, res, next) {
  if (!req.session?.user || req.session.user.role !== 'admin') {
    return res.status(401).json({
      error: 'admin_required',
      message: 'Admin session required to access prompt flow trace.'
    });
  }
  next();
}

function makeApp(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/prompt-flow', adminGate, promptFlowRouter);
  return app;
}

describe('GET /api/prompt-flow — admin gate', () => {
  test('401 with no session', async () => {
    const res = await request(makeApp(undefined)).get('/api/prompt-flow');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: 'admin_required',
      message: 'Admin session required to access prompt flow trace.',
    });
  });

  test('401 for a non-admin session', async () => {
    const res = await request(makeApp({ user: { role: 'customer' } })).get('/api/prompt-flow');
    expect(res.status).toBe(401);
  });

  test('200 for an admin session', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } })).get('/api/prompt-flow');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [], limit: 50, offset: 0 });
  });

  test('the gate also protects the detail route', async () => {
    const res = await request(makeApp({ user: { role: 'customer' } })).get('/api/prompt-flow/c1');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

This test only exercises a local re-implementation of the gate plus the already-built router, so it passes as soon as Tasks 1–3 are done — it does not depend on `server.js`. Run it now to confirm the router itself behaves correctly under the gate:

Run: `cd demo_api_server && CI=true npx jest tests/routes/promptFlow.gate.test.js --forceExit`
Expected: PASS already (this step exists to confirm the router's shape is gate-compatible before wiring `server.js` — the real "failing" verification for this task is Step 2b below, that `server.js` does NOT yet expose the route at all).

Run: `cd demo_api_server && grep -n "app.use('/api/prompt-flow'" server.js`
Expected: no output (the mount doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `demo_api_server/server.js`, add the require next to `mcpAuditRouter` (line 157):

```js
const mcpAuditRouter = require('./routes/mcpAudit');
const promptFlowRouter = require('./routes/promptFlow');
```

Then, immediately after the existing `/api/mcp/audit` mount block (server.js lines ~1173–1182):

```js
// MCP Audit: admin-only route — proxies to MCP server /audit internal endpoint (D-11)
app.use('/api/mcp/audit', (req, res, next) => {
    if (!req.session ?.user || req.session.user.role !== 'admin') {
        return res.status(401).json({
            error: 'admin_required',
            message: 'Admin session required to access audit log.'
        });
    }
    next();
}, mcpAuditRouter);
// Prompt Flow Inspector: admin-only route — reads transactionLedger.lmdb
// filtered by correlationId. Same gate pattern as /api/mcp/audit above.
app.use('/api/prompt-flow', (req, res, next) => {
    if (!req.session ?.user || req.session.user.role !== 'admin') {
        return res.status(401).json({
            error: 'admin_required',
            message: 'Admin session required to access prompt flow trace.'
        });
    }
    next();
}, promptFlowRouter);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && grep -n "app.use('/api/prompt-flow'" server.js`
Expected: one match, the new mount block.

Run: `cd demo_api_server && CI=true npx jest tests/routes/promptFlow.gate.test.js tests/routes/promptFlow.list.test.js tests/routes/promptFlow.detail.test.js tests/middleware/activityLogger.ledgerHop.test.js --forceExit`
Expected: PASS — all 4 suites green (11 tests total across the plan).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/server.js demo_api_server/tests/routes/promptFlow.gate.test.js
git commit -m "$(cat <<'EOF'
Mount /api/prompt-flow behind the same admin gate as /api/mcp/audit

Wires routes/promptFlow.js into server.js with an inline admin-session
check identical in shape to the existing /api/mcp/audit gate, so only an
admin session can read the transaction ledger's prompt-flow trace.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage** (spec §2 Backend paragraph + §4 Read API, the two paragraphs in this plan's scope):

- §2 "Backend (`demo_api_server`) — currently has NO ledger entry at all... `activityLogger` also writes a `phase:'backend.request'` entry directly into `transactionLedger.lmdb.js`... in-process write, no HTTP hop... carrying the same detail already captured for the activity log" → Task 1.
- §4 "`GET /api/prompt-flow` — list recent runs: distinct correlationId + latest timestamp + summary status + vertical, paginated" → Task 2.
- §4 "`GET /api/prompt-flow/:correlationId` — all ledger hops for that ID, ordered by timestamp, each carrying its full `details` payload per layer" → Task 3.
- §4 "Admin-session gated, same pattern as existing `GET /api/mcp/audit`" → Task 4.
- §4 "Both are pure reads against `transactionLedger.lmdb.js` filtered by `correlationId` — no new store" → satisfied by Tasks 2–3 (only `listRecords`/`getRecord` are used; no new LMDB db opened).
- §6 "Missing/unknown `correlationId` at the read endpoint → empty result, not an error" → Task 3, Step 1 test 2 and Step 3 implementation.
- §6 fire-and-forget / swallow errors for hop emission → Task 1 relies on `emitHop`'s existing fail-open behavior (already tested in `tests/services/transactionHop.test.js`); Tasks 2–3 wrap ledger reads in try/catch and degrade to an empty result rather than a 500.
- §7 "unit tests for the two new endpoints against a fixture ledger covering all 5 phases with full `details` payloads" → Task 3's Step 1 test exercises a fixture record spanning `backend.request`, `agent.step`, and `llm.call` phases with distinct `details` payloads per hop, verifying ordering and payload passthrough; Task 2's tests cover multi-phase status/vertical derivation.

Everything else in the spec (correlation propagation at other layers, P1AZ/Gateway/LLM-proxy/agent hop emitters, redaction porting, the UI) belongs to the five sibling plans and is intentionally out of scope here.

**Placeholder scan:** No "TBD"/"TODO"/"implement later"/"add appropriate error handling" strings appear anywhere in this plan. Every step has literal, runnable code and an exact command with an expected result.

**Type/interface consistency across tasks:**
- `promptFlowRouter` (the `module.exports = router` from `routes/promptFlow.js`) is the same identifier used in Task 2 (created), Task 3 (extended), and Task 4 (required + mounted) — no renames.
- `_resolveVertical(hops)` / `_resolveStatus(hops)` are defined once in Task 2 and never redefined or renamed in Task 3.
- The list response shape `{ runs, limit, offset }` (Task 2) and the detail response shape `{ correlationId, startedAt, endedAt, principal, hops }` / `{ correlationId, hops: [] }` (Task 3) are used identically in Task 4's gate test.
- The admin-gate error body `{ error: 'admin_required', message: 'Admin session required to access prompt flow trace.' }` in Task 4's Step 3 implementation matches exactly what Task 4's Step 1 test asserts.
- Task 1's hop shape (`phase`, `op`, `identity: { sub }`, `durationMs`, `status`, `details`) matches the `emitHop(hop)` signature documented in Task 1's Interfaces block and used identically in `middleware/transactionTurn.js`'s existing calls.
