# Pre-Demo Check — Backend Engine & API (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend check engine and `/api/check` API (catalog + streaming run) with the "clean" checks that reuse existing services — Servers, PingOne Authorize (real force-live decision), Config/Secrets, and LLM proxy status — so the demo environment's readiness is queryable over HTTP.

**Architecture:** A registry of small check descriptors (`services/checks/*.js`) is driven by a stateless engine (`services/checkService.js`). Each check declares `appliesWhen(flags)` so the engine unions the always-on fixed suite with flag-driven checks. A thin Express route (`routes/check.js`) exposes `GET /api/check/catalog` (what would run) and `POST /api/check/run` (runs and streams results over SSE). Checks call underlying **services** directly (never authed HTTP self-calls), so no token minting is needed in this plan.

**Tech Stack:** Node.js, Express, Jest + supertest (existing `demo_api_server` test setup), axios (already a dep).

## Global Constraints

- **Work in a git worktree, never the main checkout** (CLAUDE.md). A global hook hard-blocks Write/Edit in the shared checkout. Create/enter a worktree first; one branch per worktree; stage files explicitly (`git add <files>`, never `git add -A`); verify `git branch --show-current` before each commit.
- **Emoji allowlist** (CLAUDE.md §0): the only emoji permitted in code/tests/UI are `⚠️ ✅ ❌ 🔐 ✕ ✓`. Everything else is plain text or CSS/semantic icons. (Backend detail strings: prefer plain text.)
- Do **not** change any feature flag, OAuth scope, or PingOne configuration. Checks are read/probe-only. (Spec: Non-Goals; memory: no-scope-changes.)
- Reuse existing services, never re-implement: `pingOneAuthorizeService`, `data/serverInventory`, `routes/featureFlags` exports (`FLAG_REGISTRY`, `serializeFlag`).
- Status vocabulary is exactly `pass | fail | warn | skip`. No other values.
- Access: any logged-in user — mount behind `authenticateToken` only (not admin gate). (Spec: Users & Access.)
- New files stay focused: one check category per file under `services/checks/`.
- Follow the existing supertest test pattern (mock services with `jest.mock` before requiring the router; mount on a fresh `express()` app).

---

### Task 1: Check engine core (`checkService`)

**Files:**
- Create: `demo_api_server/services/checkService.js`
- Create: `demo_api_server/services/checks/registry.js`
- Test: `demo_api_server/tests/checkService.test.js`

**Interfaces:**
- Consumes: `routes/featureFlags` → `{ FLAG_REGISTRY, serializeFlag }`.
- Produces:
  - `currentFlags(): Record<string, boolean|string>` — `{flagId: value}` from the live registry.
  - A **check descriptor**: `{ id: string, name: string, category: string, heavy?: boolean, appliesWhen?: (flags) => boolean, run: (ctx) => Promise<{status, detail, meta?}> }`.
  - `selectChecks(flags, { includeHeavy = false }): descriptor[]` — checks whose `appliesWhen` (default `() => true`) passes, excluding `heavy` ones unless `includeHeavy`.
  - `aggregateVerdict(results): 'ready' | 'ready_with_warnings' | 'not_ready'` — any `fail` ⇒ `not_ready`; else any `warn` ⇒ `ready_with_warnings`; else `ready` (skips ignored).
  - `async runChecks(checks, ctx, onResult): Promise<result[]>` where `result = { id, name, category, status, detail, meta, durationMs }`; `onResult(result)` is called as each completes; a thrown check becomes `{status:'fail', detail: err.message}` (never aborts the batch).
  - `registry.ALL_CHECKS: descriptor[]` — the assembled list (empty array for now; later tasks push into it).

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/checkService.test.js
'use strict';

jest.mock('../routes/featureFlags', () => ({
  FLAG_REGISTRY: [
    { id: 'ff_a', name: 'A', category: 'X', type: 'boolean', defaultValue: false },
    { id: 'ff_b', name: 'B', category: 'X', type: 'boolean', defaultValue: true },
  ],
  serializeFlag: (f) => ({ id: f.id, value: f.id === 'ff_b' }),
}));

const svc = require('../services/checkService');

describe('checkService core', () => {
  test('currentFlags maps id -> value', () => {
    expect(svc.currentFlags()).toEqual({ ff_a: false, ff_b: true });
  });

  test('selectChecks honors appliesWhen and heavy', () => {
    const checks = [
      { id: 'always', run: async () => ({ status: 'pass' }) },
      { id: 'only_b', appliesWhen: (f) => f.ff_b === true, run: async () => ({ status: 'pass' }) },
      { id: 'only_a', appliesWhen: (f) => f.ff_a === true, run: async () => ({ status: 'pass' }) },
      { id: 'heavy', heavy: true, run: async () => ({ status: 'pass' }) },
    ];
    const flags = svc.currentFlags();
    expect(svc.selectChecks(flags, {}, checks).map((c) => c.id)).toEqual(['always', 'only_b']);
    expect(svc.selectChecks(flags, { includeHeavy: true }, checks).map((c) => c.id))
      .toEqual(['always', 'only_b', 'heavy']);
  });

  test('aggregateVerdict precedence', () => {
    expect(svc.aggregateVerdict([{ status: 'pass' }, { status: 'skip' }])).toBe('ready');
    expect(svc.aggregateVerdict([{ status: 'pass' }, { status: 'warn' }])).toBe('ready_with_warnings');
    expect(svc.aggregateVerdict([{ status: 'warn' }, { status: 'fail' }])).toBe('not_ready');
  });

  test('runChecks streams results, times each, and isolates throws', async () => {
    const seen = [];
    const checks = [
      { id: 'ok', name: 'ok', category: 'C', run: async () => ({ status: 'pass', detail: 'fine' }) },
      { id: 'boom', name: 'boom', category: 'C', run: async () => { throw new Error('kaboom'); } },
    ];
    const results = await svc.runChecks(checks, {}, (r) => seen.push(r.id));
    expect(seen).toEqual(['ok', 'boom']);
    expect(results[1]).toMatchObject({ id: 'boom', status: 'fail', detail: 'kaboom' });
    expect(typeof results[0].durationMs).toBe('number');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/checkService.test.js`
Expected: FAIL — `Cannot find module '../services/checkService'`.

- [ ] **Step 3: Write the registry**

```js
// demo_api_server/services/checks/registry.js
'use strict';
// Assembled list of check descriptors. Each check file pushes its descriptors
// here at require time. checkService requires this module once at startup.
const ALL_CHECKS = [];
function register(...descriptors) { ALL_CHECKS.push(...descriptors); }
module.exports = { ALL_CHECKS, register };
```

- [ ] **Step 4: Write the engine**

```js
// demo_api_server/services/checkService.js
'use strict';
const { FLAG_REGISTRY, serializeFlag } = require('../routes/featureFlags');

/** Current feature-flag values as { id: value }. */
function currentFlags() {
  const out = {};
  for (const f of FLAG_REGISTRY) out[f.id] = serializeFlag(f).value;
  return out;
}

/** Filter checks by appliesWhen + heavy. `list` defaults to the shared registry. */
function selectChecks(flags, { includeHeavy = false } = {}, list) {
  const checks = list || require('./checks/registry').ALL_CHECKS;
  return checks.filter((c) => {
    if (c.heavy && !includeHeavy) return false;
    return typeof c.appliesWhen === 'function' ? !!c.appliesWhen(flags) : true;
  });
}

const VERDICT = { READY: 'ready', WARN: 'ready_with_warnings', NOT_READY: 'not_ready' };
function aggregateVerdict(results) {
  if (results.some((r) => r.status === 'fail')) return VERDICT.NOT_READY;
  if (results.some((r) => r.status === 'warn')) return VERDICT.WARN;
  return VERDICT.READY;
}

/** Run checks in order, streaming each result via onResult. Never throws. */
async function runChecks(checks, ctx, onResult = () => {}) {
  const results = [];
  for (const check of checks) {
    const start = Date.now();
    let outcome;
    try {
      outcome = await check.run(ctx);
    } catch (err) {
      outcome = { status: 'fail', detail: err.message };
    }
    const result = {
      id: check.id, name: check.name, category: check.category,
      status: outcome.status, detail: outcome.detail || '', meta: outcome.meta || null,
      durationMs: Date.now() - start,
    };
    results.push(result);
    onResult(result);
  }
  return results;
}

module.exports = { currentFlags, selectChecks, aggregateVerdict, runChecks, VERDICT };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/checkService.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/checkService.js demo_api_server/services/checks/registry.js demo_api_server/tests/checkService.test.js
git commit -m "feat(check): check engine core — select, aggregate, stream"
```

---

### Task 2: Servers check

**Files:**
- Create: `demo_api_server/services/checks/serversCheck.js`
- Test: `demo_api_server/tests/checks/serversCheck.test.js`

**Interfaces:**
- Consumes: `data/serverInventory` → `{ SERVER_INVENTORY }` (array of `{key,name,probe,candidates,healthPath,...}`); `axios`.
- Produces (into registry): descriptor `{ id:'servers.all_up', name:'All servers running', category:'Servers', run }`. `run` probes every inventory entry with `probe === true` and returns `pass` when all up, else `fail`; `meta.services = [{key,name,up,latencyMs?,error?}]`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/checks/serversCheck.test.js
'use strict';
jest.mock('../../data/serverInventory', () => ({
  SERVER_INVENTORY: [
    { key: 'api', name: 'API', probe: true, healthPath: '/health', candidates: ['http://api:1'] },
    { key: 'self', name: 'Self', probe: 'self' },
    { key: 'gw', name: 'Gateway', probe: true, healthPath: '/health', candidates: ['http://gw:2'] },
  ],
}));
const axios = require('axios');
jest.mock('axios');

const { run } = require('../../services/checks/serversCheck');

describe('serversCheck', () => {
  afterEach(() => jest.clearAllMocks());

  test('pass when all probed services are up', async () => {
    axios.get.mockResolvedValue({ status: 200 });
    const r = await run({});
    expect(r.status).toBe('pass');
    expect(r.meta.services.find((s) => s.key === 'api').up).toBe(true);
    expect(r.meta.services.find((s) => s.key === 'self').up).toBe(true); // probe:'self' assumed up
  });

  test('fail lists the down service', async () => {
    axios.get.mockImplementation((url) =>
      url.includes('gw') ? Promise.reject({ code: 'ECONNREFUSED' }) : Promise.resolve({ status: 200 }));
    const r = await run({});
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/Gateway/);
    expect(r.meta.services.find((s) => s.key === 'gw').up).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/checks/serversCheck.test.js`
Expected: FAIL — cannot find `serversCheck`.

- [ ] **Step 3: Write the check**

```js
// demo_api_server/services/checks/serversCheck.js
'use strict';
const axios = require('axios');
const https = require('https');
const { SERVER_INVENTORY } = require('../../data/serverInventory');
const { register } = require('./registry');

const agent = new https.Agent({ rejectUnauthorized: false });

async function probe(entry) {
  const path = entry.healthPath || '/health';
  let lastError = 'no_candidates';
  for (const base of entry.candidates || []) {
    const url = `${base.replace(/\/$/, '')}${path}`;
    const start = Date.now();
    try {
      await axios.get(url, { timeout: 2500, httpsAgent: agent, validateStatus: () => true });
      return { up: true, latencyMs: Date.now() - start };
    } catch (e) { lastError = e.code || e.message; }
  }
  return { up: false, error: lastError };
}

async function run() {
  const services = await Promise.all(
    SERVER_INVENTORY.map(async (e) => {
      const meta = { key: e.key, name: e.name };
      if (e.probe === 'self') return { ...meta, up: true };
      if (e.probe !== true) return { ...meta, up: null };
      return { ...meta, ...(await probe(e)) };
    })
  );
  const down = services.filter((s) => s.up === false);
  const upCount = services.filter((s) => s.up === true).length;
  const probed = services.filter((s) => s.up !== null).length;
  return {
    status: down.length ? 'fail' : 'pass',
    detail: down.length ? `Down: ${down.map((s) => s.name).join(', ')}` : `${upCount}/${probed} up`,
    meta: { services },
  };
}

const descriptor = { id: 'servers.all_up', name: 'All servers running', category: 'Servers', run };
register(descriptor);
module.exports = { ...descriptor, run };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/checks/serversCheck.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/checks/serversCheck.js demo_api_server/tests/checks/serversCheck.test.js
git commit -m "feat(check): servers-up check via server inventory probe"
```

---

### Task 3: PingOne Authorize — real force-live decision check

**Files:**
- Create: `demo_api_server/services/checks/authorizeCheck.js`
- Test: `demo_api_server/tests/checks/authorizeCheck.test.js`

**Interfaces:**
- Consumes: `services/pingOneAuthorizeService` → `{ isConfigured(): boolean, evaluateTransaction({decisionEndpointId,userId,amount,type,acr}): Promise<{decision,decisionId,stepUpRequired,...}> }`; `services/configStore` → `getEffective(key)`.
- Produces two descriptors:
  - `authorize.mode` (always) — reports Real vs Demo from `flags.ff_authorize_simulated`; always `pass`; `meta.mode`.
  - `authorize.real_decision` (always) — runs a small PERMIT-expected and a large DENY/step-up-expected force-live evaluation via `evaluateTransaction`. `fail` if not configured or the call throws; `pass` when both return a `decision` with a `decisionId`; `warn` if the policy did not discriminate (both same decision). `meta` carries both decisions + ids. When `ff_authorize_simulated` is on, detail notes "real path verified; simulated active for demo".
  - `authorize.fail_open` (always) — `warn` when `flags.ff_authorize_fail_open === false`, else `pass`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/checks/authorizeCheck.test.js
'use strict';
jest.mock('../../services/pingOneAuthorizeService', () => ({
  isConfigured: jest.fn(() => true),
  evaluateTransaction: jest.fn(),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'ep-123') }));

const p1az = require('../../services/pingOneAuthorizeService');
const { mode, realDecision, failOpen } = require('../../services/checks/authorizeCheck');

describe('authorizeCheck', () => {
  afterEach(() => jest.clearAllMocks());

  test('mode reports Real when not simulated', async () => {
    const r = await mode.run({ flags: { ff_authorize_simulated: false } });
    expect(r.status).toBe('pass');
    expect(r.meta.mode).toBe('real');
  });

  test('real_decision passes when both eval calls return a decision + id', async () => {
    p1az.evaluateTransaction
      .mockResolvedValueOnce({ decision: 'PERMIT', decisionId: 'a1' })
      .mockResolvedValueOnce({ decision: 'DENY', decisionId: 'a2' });
    const r = await realDecision.run({ flags: { ff_authorize_simulated: false } });
    expect(r.status).toBe('pass');
    expect(r.meta.decisions.map((d) => d.decision)).toEqual(['PERMIT', 'DENY']);
  });

  test('real_decision fails when not configured', async () => {
    p1az.isConfigured.mockReturnValue(false);
    const r = await realDecision.run({ flags: {} });
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/not configured/i);
  });

  test('real_decision fails when PingOne call throws', async () => {
    p1az.evaluateTransaction.mockRejectedValue(new Error('policy_not_found'));
    const r = await realDecision.run({ flags: {} });
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/policy_not_found/);
  });

  test('real_decision warns when policy does not discriminate', async () => {
    p1az.evaluateTransaction
      .mockResolvedValueOnce({ decision: 'PERMIT', decisionId: 'a1' })
      .mockResolvedValueOnce({ decision: 'PERMIT', decisionId: 'a2' });
    const r = await realDecision.run({ flags: {} });
    expect(r.status).toBe('warn');
  });

  test('failOpen warns when fail-open is off', async () => {
    expect((await failOpen.run({ flags: { ff_authorize_fail_open: false } })).status).toBe('warn');
    expect((await failOpen.run({ flags: { ff_authorize_fail_open: true } })).status).toBe('pass');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/checks/authorizeCheck.test.js`
Expected: FAIL — cannot find `authorizeCheck`.

- [ ] **Step 3: Write the check**

```js
// demo_api_server/services/checks/authorizeCheck.js
'use strict';
const p1az = require('../../services/pingOneAuthorizeService');
const configStore = require('../../services/configStore');
const { register } = require('./registry');

const SMALL = { amount: 2500,  type: 'transfer' };   // expect PERMIT
const LARGE = { amount: 75000, type: 'transfer' };   // expect DENY / step-up
const TEST_USER = 'check-preflight-user';

const mode = {
  id: 'authorize.mode', name: 'Authorize mode', category: 'PingOne Authorize',
  async run({ flags }) {
    const simulated = flags.ff_authorize_simulated === true;
    return {
      status: 'pass',
      detail: simulated ? 'Demo / simulated mode active' : 'Real PingOne Authorize',
      meta: { mode: simulated ? 'demo' : 'real' },
    };
  },
};

const realDecision = {
  id: 'authorize.real_decision', name: 'Real decision (force-live)', category: 'PingOne Authorize',
  async run({ flags }) {
    if (!p1az.isConfigured()) {
      return { status: 'fail', detail: 'PingOne Authorize worker credentials + decision endpoint are not configured' };
    }
    const decisionEndpointId = configStore.getEffective('authorize_decision_endpoint_id') || undefined;
    const evalOne = (t) => p1az.evaluateTransaction({ decisionEndpointId, userId: TEST_USER, amount: t.amount, type: t.type });
    let decisions;
    try {
      decisions = await Promise.all([evalOne(SMALL), evalOne(LARGE)]);
    } catch (err) {
      return { status: 'fail', detail: err.message };
    }
    if (decisions.some((d) => !d || !d.decision || !d.decisionId)) {
      return { status: 'fail', detail: 'PingOne returned no decision id', meta: { decisions } };
    }
    const discriminates = decisions[0].decision !== decisions[1].decision;
    const note = flags.ff_authorize_simulated ? ' (simulated active for demo; real path verified)' : '';
    return {
      status: discriminates ? 'pass' : 'warn',
      detail: discriminates
        ? `${decisions[0].decision} / ${decisions[1].decision}${note}`
        : `Both inputs returned ${decisions[0].decision} — policy may not discriminate${note}`,
      meta: { decisions: decisions.map((d) => ({ decision: d.decision, decisionId: d.decisionId })) },
    };
  },
};

const failOpen = {
  id: 'authorize.fail_open', name: 'Fail-open awareness', category: 'PingOne Authorize',
  async run({ flags }) {
    return flags.ff_authorize_fail_open === false
      ? { status: 'warn', detail: 'Fail-open is OFF — Authorize errors will hard-deny mid-demo' }
      : { status: 'pass', detail: 'Fail-open is on' };
  },
};

register(mode, realDecision, failOpen);
module.exports = { mode, realDecision, failOpen };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/checks/authorizeCheck.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/checks/authorizeCheck.js demo_api_server/tests/checks/authorizeCheck.test.js
git commit -m "feat(check): real force-live PingOne Authorize decision check"
```

---

### Task 4: Config / Secrets check

**Files:**
- Create: `demo_api_server/services/checks/configCheck.js`
- Test: `demo_api_server/tests/checks/configCheck.test.js`

**Interfaces:**
- Consumes: `services/configStore` → `getEffective(key)`; `process.env`.
- Produces descriptor `config.prereqs` (always) — verifies prerequisites for the **current** flag combo:
  - real P1AZ (`ff_authorize_simulated === false`) requires `authorize_worker_client_id` and `authorize_decision_endpoint_id`.
  - simulated + gateway + local JWKS (`ff_authorize_simulated && ff_mcp_gateway_pinggateway && ff_mcp_gateway_jwks`) requires `process.env.AUTHZ_JWT_SECRET`.
  - `fail` listing each missing key; else `pass`. `meta.missing = [...]`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/checks/configCheck.test.js
'use strict';
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => null) }));
const configStore = require('../../services/configStore');
const { prereqs } = require('../../services/checks/configCheck');

describe('configCheck', () => {
  const OLD_ENV = process.env;
  beforeEach(() => { jest.clearAllMocks(); process.env = { ...OLD_ENV }; });
  afterAll(() => { process.env = OLD_ENV; });

  test('fails when real P1AZ prereqs missing', async () => {
    configStore.getEffective.mockReturnValue(null);
    const r = await prereqs.run({ flags: { ff_authorize_simulated: false } });
    expect(r.status).toBe('fail');
    expect(r.meta.missing).toEqual(expect.arrayContaining(['authorize_worker_client_id', 'authorize_decision_endpoint_id']));
  });

  test('passes when real P1AZ prereqs present', async () => {
    configStore.getEffective.mockReturnValue('set');
    const r = await prereqs.run({ flags: { ff_authorize_simulated: false } });
    expect(r.status).toBe('pass');
  });

  test('fails when simulated+gateway+jwks needs AUTHZ_JWT_SECRET', async () => {
    delete process.env.AUTHZ_JWT_SECRET;
    const r = await prereqs.run({ flags: { ff_authorize_simulated: true, ff_mcp_gateway_pinggateway: true, ff_mcp_gateway_jwks: true } });
    expect(r.status).toBe('fail');
    expect(r.meta.missing).toContain('AUTHZ_JWT_SECRET');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/checks/configCheck.test.js`
Expected: FAIL — cannot find `configCheck`.

- [ ] **Step 3: Write the check**

```js
// demo_api_server/services/checks/configCheck.js
'use strict';
const configStore = require('../../services/configStore');
const { register } = require('./registry');

const prereqs = {
  id: 'config.prereqs', name: 'Config & secrets for current flags', category: 'Config / Secrets',
  async run({ flags }) {
    const missing = [];
    const needStore = (key) => { if (!configStore.getEffective(key)) missing.push(key); };
    const needEnv = (key) => { if (!process.env[key]) missing.push(key); };

    if (flags.ff_authorize_simulated === false) {
      needStore('authorize_worker_client_id');
      needStore('authorize_decision_endpoint_id');
    }
    if (flags.ff_authorize_simulated && flags.ff_mcp_gateway_pinggateway && flags.ff_mcp_gateway_jwks) {
      needEnv('AUTHZ_JWT_SECRET');
    }
    return missing.length
      ? { status: 'fail', detail: `Missing: ${missing.join(', ')}`, meta: { missing } }
      : { status: 'pass', detail: 'All required config present', meta: { missing: [] } };
  },
};

register(prereqs);
module.exports = { prereqs };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/checks/configCheck.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/checks/configCheck.js demo_api_server/tests/checks/configCheck.test.js
git commit -m "feat(check): flag-driven config/secrets prerequisite check"
```

---

### Task 5: LLM proxy status check

**Files:**
- Create: `demo_api_server/services/checks/llmCheck.js`
- Test: `demo_api_server/tests/checks/llmCheck.test.js`

**Interfaces:**
- Consumes: `axios`; proxy origin `process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8090'` → `GET /status` returns `{ models: [{name, port, size, healthy, load}], ... }`.
- Produces descriptor `llm.status` (always) — reads proxy `/status`, reports which models are healthy/loadable. `pass` when at least one model is healthy; `warn` when the proxy responds but no model is currently healthy; `fail` when the proxy is unreachable. `meta.models` echoes the list. (The heavy "deep test all models" probe is Plan 2.)

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/checks/llmCheck.test.js
'use strict';
const axios = require('axios');
jest.mock('axios');
const { status } = require('../../services/checks/llmCheck');

describe('llmCheck', () => {
  afterEach(() => jest.clearAllMocks());

  test('pass when a model is healthy', async () => {
    axios.get.mockResolvedValue({ data: { models: [{ name: 'gpt-oss-20b', healthy: true }, { name: 'phi-4', healthy: false }] } });
    const r = await status.run({});
    expect(r.status).toBe('pass');
    expect(r.meta.models).toHaveLength(2);
    expect(r.detail).toMatch(/1\/2/);
  });

  test('warn when proxy responds but nothing healthy', async () => {
    axios.get.mockResolvedValue({ data: { models: [{ name: 'phi-4', healthy: false }] } });
    expect((await status.run({})).status).toBe('warn');
  });

  test('fail when proxy unreachable', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await status.run({});
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/ECONNREFUSED/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/checks/llmCheck.test.js`
Expected: FAIL — cannot find `llmCheck`.

- [ ] **Step 3: Write the check**

```js
// demo_api_server/services/checks/llmCheck.js
'use strict';
const axios = require('axios');
const { register } = require('./registry');

const PROXY = (process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');

const status = {
  id: 'llm.status', name: 'LLM models', category: 'LLM',
  async run() {
    let models;
    try {
      const { data } = await axios.get(`${PROXY}/status`, { timeout: 3000 });
      models = Array.isArray(data.models) ? data.models : [];
    } catch (err) {
      return { status: 'fail', detail: `LLM proxy unreachable: ${err.message}` };
    }
    const healthy = models.filter((m) => m.healthy).length;
    if (!models.length) return { status: 'warn', detail: 'Proxy responded with no models', meta: { models } };
    return {
      status: healthy ? 'pass' : 'warn',
      detail: `${healthy}/${models.length} model(s) loaded/healthy`,
      meta: { models },
    };
  },
};

register(status);
module.exports = { status };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/checks/llmCheck.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/checks/llmCheck.js demo_api_server/tests/checks/llmCheck.test.js
git commit -m "feat(check): LLM proxy status check"
```

---

### Task 6: `/api/check` route (catalog + streaming run) and mount

**Files:**
- Create: `demo_api_server/routes/check.js`
- Modify: `demo_api_server/server.js` (add mount next to other `/api/*` mounts, ~line 1060 near `app.use('/api/authorize', ...)`)
- Create: `demo_api_server/services/checks/index.js` (requires every check file so registration runs)
- Test: `demo_api_server/tests/checkRoute.test.js`

**Interfaces:**
- Consumes: `checkService` (`currentFlags, selectChecks, runChecks, aggregateVerdict`); `services/checks` (side-effect require to populate registry).
- Produces HTTP:
  - `GET /api/check/catalog` → `{ flags, checks: [{id,name,category,heavy}] }` for the current flags (includes heavy).
  - `POST /api/check/run` (body `{ only?: string[], includeHeavy?: boolean }`) → **SSE** stream: `event: result` per check with the result JSON, then `event: done` with `{ verdict, total }`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/checkRoute.test.js
'use strict';
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'u1', role: 'user' }; next(); },
}));
// Deterministic registry: two light checks + one heavy.
jest.mock('../services/checks', () => {
  const { register } = require('../services/checks/registry');
  register(
    { id: 'a', name: 'A', category: 'C', run: async () => ({ status: 'pass', detail: 'ok' }) },
    { id: 'warnable', name: 'W', category: 'C', run: async () => ({ status: 'warn', detail: 'meh' }) },
    { id: 'heavy1', name: 'H', category: 'C', heavy: true, run: async () => ({ status: 'pass' }) },
  );
}, { virtual: false });
jest.mock('../routes/featureFlags', () => ({
  FLAG_REGISTRY: [{ id: 'ff_x', type: 'boolean', defaultValue: true }],
  serializeFlag: () => ({ id: 'ff_x', value: true }),
}));

const express = require('express');
const request = require('supertest');
const { router } = require('../routes/check');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/check', router);
  return app;
}

describe('/api/check', () => {
  test('catalog lists checks incl. heavy for current flags', async () => {
    const res = await request(makeApp()).get('/api/check/catalog');
    expect(res.status).toBe(200);
    expect(res.body.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['a', 'warnable', 'heavy1']));
    expect(res.body.flags).toEqual({ ff_x: true });
  });

  test('run streams SSE results + done verdict (light only by default)', async () => {
    const res = await request(makeApp()).post('/api/check/run').send({});
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toMatch(/event: result/);
    expect(res.text).toContain('"id":"a"');
    expect(res.text).not.toContain('"id":"heavy1"'); // heavy excluded by default
    expect(res.text).toMatch(/event: done/);
    expect(res.text).toMatch(/"verdict":"ready_with_warnings"/);
  });

  test('run with includeHeavy runs heavy checks', async () => {
    const res = await request(makeApp()).post('/api/check/run').send({ includeHeavy: true });
    expect(res.text).toContain('"id":"heavy1"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/checkRoute.test.js`
Expected: FAIL — cannot find `../routes/check`.

- [ ] **Step 3: Write the checks index (side-effect registration)**

```js
// demo_api_server/services/checks/index.js
'use strict';
// Requiring each check file runs its register(...) call. Order = display order.
require('./serversCheck');
require('./authorizeCheck');
require('./configCheck');
require('./llmCheck');
module.exports = require('./registry');
```

- [ ] **Step 4: Write the route**

```js
// demo_api_server/routes/check.js
'use strict';
const express = require('express');
const router = express.Router();
require('../services/checks'); // populate the registry
const { currentFlags, selectChecks, runChecks, aggregateVerdict } = require('../services/checkService');

router.get('/catalog', (_req, res) => {
  const flags = currentFlags();
  const checks = selectChecks(flags, { includeHeavy: true })
    .map((c) => ({ id: c.id, name: c.name, category: c.category, heavy: !!c.heavy }));
  res.json({ flags, checks });
});

router.post('/run', async (req, res) => {
  const { only, includeHeavy = false } = req.body || {};
  const flags = currentFlags();
  let checks = selectChecks(flags, { includeHeavy });
  if (Array.isArray(only) && only.length) {
    const want = new Set(only);
    checks = checks.filter((c) => want.has(c.id) || want.has(c.category));
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const results = await runChecks(checks, { flags }, (r) => send('result', r));
  send('done', { verdict: aggregateVerdict(results), total: results.length });
  res.end();
});

module.exports = { router };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/checkRoute.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Mount the route in server.js**

Add after the `app.use('/api/authorize', authorizeRoutes);` line (~1060):

```js
// Pre-Demo Check — readiness checks for the demo. Any logged-in user.
const { authenticateToken: authForCheck } = require('./middleware/auth');
app.use('/api/check', authForCheck, require('./routes/check').router);
```

- [ ] **Step 7: Verify the server boots and the route is live**

Run: `cd demo_api_server && node -e "require('./routes/check'); require('./services/checks'); console.log('check route loads; registered:', require('./services/checks/registry').ALL_CHECKS.map(c=>c.id).join(', '))"`
Expected: prints the registered check ids (`servers.all_up, authorize.mode, authorize.real_decision, authorize.fail_open, config.prereqs, llm.status`).

- [ ] **Step 8: Run the full check test suite**

Run: `cd demo_api_server && npx jest tests/checkService.test.js tests/checkRoute.test.js tests/checks/`
Expected: PASS (all check tests green).

- [ ] **Step 9: Commit**

```bash
git add demo_api_server/routes/check.js demo_api_server/services/checks/index.js demo_api_server/server.js demo_api_server/tests/checkRoute.test.js
git commit -m "feat(check): /api/check catalog + streaming run route, mounted"
```

---

## Self-Review

**Spec coverage (Plan 1 scope):**
- Fixed suite + flag-driven engine → Task 1 (`selectChecks` + `appliesWhen`). ✓
- Servers up → Task 2. ✓
- Real P1AZ specific test (force-live, PERMIT+DENY, decisionId) → Task 3. ✓
- Config/secrets prereqs (flag-driven) → Task 4. ✓
- LLM status (default probe) → Task 5. ✓
- Backend `/api/check/catalog` + `/api/check/run` SSE, any-logged-in-user → Task 6. ✓
- **Deferred to Plan 2:** real Agent Gateway probes (introspect/authorize/mcp-call — need a minted demo token), real end-to-end chip run (session-coupled `/api/agent/run`), deep LLM all-model probe (forced swaps).
- **Deferred to Plan 3:** frontend Check page (4 views over the results model), TopNav entry, `/check` route.

**Placeholder scan:** none — every step has runnable code/commands.

**Type consistency:** descriptor shape `{id,name,category,heavy?,appliesWhen?,run}` and result shape `{id,name,category,status,detail,meta,durationMs}` are used identically across Tasks 1–6. Status vocabulary `pass|fail|warn|skip` consistent. `register(...)`/`ALL_CHECKS` consistent between registry, checks, and index.

---

## Next plans (to be written)

- **Plan 2 — Gateway + chip + deep-LLM checks:** mint a demo MCP token (reuse `scripts/mint-gateway-token.js` logic), add `gatewayCheck` (introspect → authorize → mcp-call via `pinggatewayTestRoutes` handlers or the underlying `callPingGateway`), a real end-to-end `chipCheck` driving `/api/agent/run` with a headless agent context, and the deep-LLM forced-swap probe. All register as `heavy: true` descriptors so they slot into the existing engine with zero route changes.
- **Plan 3 — Frontend Check page:** `demo_api_ui/src/pages/CheckPage.jsx` + `/check` route in `App.js`, consuming `GET /catalog` and the `POST /run` SSE stream, rendering one results model as four switchable views (traffic-light cards default, pre-flight stepper run mode, grouped checklist, rail+detail). Constraints:
  - **Side-nav entry, any user:** add `{ label: "Check", path: "/check", icon }` to `demo_api_ui/src/components/AdminSideNav.jsx` **without** `adminOnly` (the nav renders for all logged-in users; adminOnly items get an admin badge). Place it near the Servers item (~line 711).
  - **Traffic lights are CSS/semantic dots, never emoji** — obey the CLAUDE.md §0 allowlist (`⚠️ ✅ ❌ 🔐 ✕ ✓` only). Reuse the mock's `.light` CSS-dot approach.
  - Must invoke the `regression-guard` skill (touches `demo_api_ui`) and run the UI build gate (`npm run test:ui` / the build) before calling it done.
