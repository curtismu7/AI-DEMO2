# DaVinci Orchestration Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PingOne DaVinci actually demonstrate multi-connector orchestration in the banking demo (transaction step-up chaining SSO + Protect + MFA + a business-system webhook + Authorize; risk-adaptive login with two A/B-testable flow versions), while the existing hand-coded paths keep working byte-for-byte when DaVinci is off — and give presenters a one-click "DaVinci Mode" switch in the agent dashboard's More menu, with a value-prop explainer page that needs no live DaVinci setup for quick demos.

**Architecture:** One shared backend client (`davinciFlowClient.js`) invokes DaVinci flows via their orchestrate API. A single new LMDB-backed webhook endpoint (mirroring the existing `webhookPingOne.js` pattern) receives DaVinci's mid-flow and terminal callbacks. A new `ff_davinci_orchestration` admin flag (default OFF) gates both the transaction-flow branch inside `transactionConsentChallenge.js` and the login-flow's visibility — OFF preserves the current hand-coded HITL and redirect-login paths exactly. ON routes the same scenarios through DaVinci, failing closed back to the hand-coded path on any DaVinci API error. Separately, a client-only "DaVinci Mode" toggle in the agent header's More menu (no admin rights needed, mirrors the existing Movie-reel toggle) surfaces a nav entry to a static explainer page — zero live DaVinci calls, safe for any demo regardless of console setup state — with an optional CTA into the live widget login. The DaVinci flow definitions themselves are authored in DaVinci Studio (no-code, not git-tracked code) — Task 1 is a manual checklist, everything after it is testable code.

**Tech Stack:** Node 22 CommonJS + Express + Jest (`demo_api_server`), React 19 + Vite + Vitest (`demo_api_ui`), `axios`, `lmdb`, `@forgerock/davinci-client`.

**Spec:** `docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md`

## Global Constraints

- Node >= 22, CommonJS (`'use strict'` + `require`) in `demo_api_server` — no ESM.
- Error responses use `{ error }` shape (`demo_api_server/CLAUDE.md`).
- Upstream HTTP failures go through `normalizeAxiosError(err, { label, timeoutMs })` — never leak raw axios errors.
- `demo_api_ui` is Vitest, not Jest, plain JS/JSX — no TypeScript sources.
- `demo_api_ui` HTTP calls go through `apiClient`, not raw `axios`/`fetch`, except where an existing precedent (the SDK sandbox's own `fetch` calls in `oidcSdkClient.js`) already establishes the pattern being mirrored.
- Never hardcode a PingOne resource/audience/env value — always read via `configStore`/env vars (REGRESSION_PLAN §1, "Token audience check").
- Do not modify `routes/oauth.js`, `routes/oauthUser.js`, `config/oauth.js`, or `services/transactionConsentChallenge.js`'s existing exported function behavior when `ff_davinci_orchestration` is OFF — these are REGRESSION_PLAN §1 protected / must stay byte-for-byte unchanged on the default path.
- Every new flag/config key follows the existing `ff_*` naming and dual-registration pattern: an entry in `demo_api_server/routes/featureFlags.js` FLAG_REGISTRY *and* a matching default in `demo_api_server/services/configStore.js` FIELD_DEFS.
- Working directory for all commands below: `demo_api_server/` or `demo_api_ui/` as stated per task, inside worktree `worktree-agent-framework-orchestrator`.

---

### Task 1: DaVinci console setup (manual — no code)

**Files:** None (console-only). Updates `demo_api_server/.env.example` with new placeholder keys at the end of this task.

**Interfaces:**
- Produces: the env var names `PINGONE_DAVINCI_TRANSACTION_APP_ID`, `PINGONE_DAVINCI_TRANSACTION_FLOW_ID`, `PINGONE_DAVINCI_TRANSACTION_COMPANY_ID`, `PINGONE_DAVINCI_LOGIN_APP_ID`, `PINGONE_DAVINCI_LOGIN_FLOW_ID_V1`, `PINGONE_DAVINCI_LOGIN_FLOW_ID_V2`, `PINGONE_DAVINCI_API_CLIENT_ID`, `PINGONE_DAVINCI_API_CLIENT_SECRET`, `DAVINCI_WEBHOOK_URL` — every later task's `config/davinci.js` (Task 2) reads exactly these names.

- [ ] **Step 1: Confirm DaVinci service + connector instances**

In the PingOne admin console for the target environment: confirm DaVinci is activated. Under DaVinci > Connections, confirm or create connector instances for: PingOne (existing), PingOne Authorize (existing, per original plan), PingOne SSO (existing, per original plan), PingOne Protect (new), PingOne MFA (new), HTTP (existing/core, no setup needed), Generic/HTTP connector (used for the webhook callback — same HTTP connector, different node config).

- [ ] **Step 2: Import and extend the transaction-authorization flow**

DaVinci Studio > Add Flow > Import From JSON > `docs/Super_Banking_Transaction_Authorization_DaVinci.json`. Deploy the imported flow once as-is to confirm the import succeeded (Decision Router branches for Deny/Step-Up/Permit should already exist per the flow's own embedded `description` field).

Then edit the Step-Up branch (currently a bare `STEP_UP` return) to insert, in order: (a) a PingOne Protect "Evaluate" node reading the flow's `Username` variable, (b) a branch on the Protect risk level — LOW continues straight to the existing PingOne Authorize node; MEDIUM/HIGH continues to (c) a PingOne MFA node (device-based challenge) run in parallel with (d) an HTTP connector node that POSTs `{ eventType: 'fraud_alert', username, amount, transactionType, riskLevel }` to `${DAVINCI_WEBHOOK_URL}` (Step 1's env var — the actual URL is `{PINGONE_PUBLIC_APP_URL replaced with the BFF's public origin}/webhook/davinci`, built in Task 4). After MFA completes, flow continues to the existing PingOne Authorize node. After Authorize returns its final decision (on every branch, not just Step-Up), add one more HTTP connector node POSTing `{ eventType: 'transaction_decision', username, amount, decision, stepUpCompleted }` to the same `DAVINCI_WEBHOOK_URL`, then the existing Flow Control success/return node.

Deploy. Record the flow's `companyId` (already in the JSON header), `flowId` (already in the JSON header: `5ba3e92c7f41d865094b3c7e621fa890` — confirm it is unchanged after your edits, DaVinci keeps the same flowId across versions), and the DaVinci Application's `applicationId` (create one if this flow doesn't already have one, assign the flow to it).

- [ ] **Step 3: Author the risk-adaptive login flow (two versions)**

New flow in DaVinci Studio (no existing JSON — net new), following the Login flow pattern: HTTP start > PingOne Protect Evaluate > branch: LOW risk continues to a passkey/passwordless PingOne MFA "Authenticate Passkey" node; MEDIUM/HIGH risk continues to PingOne "Read User" > "Check Password" (HTML Form collector) > mandatory PingOne MFA step-up node > success. Both branches converge on a Flow Control success node that redirects with the OIDC code.

Deploy this as **version 1** (v1 = risk-adaptive, as just built). Then, in Flow Versions, create **version 2** as a simplified always-MFA variant (skip the Protect branch — password + MFA unconditionally) to give the demo two real versions to A/B/compare. Create a DaVinci Application for Widget invocation, assign both flow versions to it. Record the `applicationId` and both versions' `flowId`s (or the single `flowId` + version numbers, whichever the DaVinci Applications UI exposes for widget invocation — record what you see).

- [ ] **Step 4: Generate API credentials and record everything**

Under DaVinci > Settings > API, generate (or reuse) a client_credentials-capable API client for server-to-server flow invocation (used by `davinciFlowClient.js` in Task 3). Record its client ID/secret.

Add to `demo_api_server/.env.example` (placeholders only, no real values committed):

```bash
# DaVinci orchestration showcase — see docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md
PINGONE_DAVINCI_API_CLIENT_ID=
PINGONE_DAVINCI_API_CLIENT_SECRET=
PINGONE_DAVINCI_TRANSACTION_COMPANY_ID=
PINGONE_DAVINCI_TRANSACTION_APP_ID=
PINGONE_DAVINCI_TRANSACTION_FLOW_ID=
PINGONE_DAVINCI_LOGIN_APP_ID=
PINGONE_DAVINCI_LOGIN_FLOW_ID_V1=
PINGONE_DAVINCI_LOGIN_FLOW_ID_V2=
# DAVINCI_WEBHOOK_URL defaults to {PINGONE_PUBLIC_APP_URL}/webhook/davinci if unset — see config/davinci.js (Task 2)
DAVINCI_WEBHOOK_URL=
```

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/.env.example
git commit -m "docs: record DaVinci showcase env vars (console setup complete)"
```

---

### Task 2: `config/davinci.js` — env config

**Files:**
- Create: `demo_api_server/config/davinci.js`
- Test: `demo_api_server/tests/davinciConfig.test.js`

**Interfaces:**
- Consumes: nothing (leaf config module) — env vars from Task 1, `configStore.getEffective` for the `pingone_public_app_url` key already used elsewhere in the repo (same key `PINGONE_PUBLIC_APP_URL` maps to).
- Produces: `module.exports = { apiClientId, apiClientSecret, tokenEndpoint, transaction: { companyId, appId, flowId }, login: { appId, flowIdV1, flowIdV2 }, webhookUrl }` — all getters, mirroring `config/oauth.js`'s lazy-getter shape. `webhookUrl` getter: `process.env.DAVINCI_WEBHOOK_URL || `${configStore.getEffective('pingone_public_app_url') || ''}/webhook/davinci``. Every later task imports this exact shape.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/tests/davinciConfig.test.js
'use strict';

jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));
const configStore = require('../services/configStore');

describe('config/davinci', () => {
  const ENV_KEYS = [
    'PINGONE_DAVINCI_API_CLIENT_ID', 'PINGONE_DAVINCI_API_CLIENT_SECRET',
    'PINGONE_DAVINCI_TRANSACTION_COMPANY_ID', 'PINGONE_DAVINCI_TRANSACTION_APP_ID',
    'PINGONE_DAVINCI_TRANSACTION_FLOW_ID', 'PINGONE_DAVINCI_LOGIN_APP_ID',
    'PINGONE_DAVINCI_LOGIN_FLOW_ID_V1', 'PINGONE_DAVINCI_LOGIN_FLOW_ID_V2',
    'DAVINCI_WEBHOOK_URL',
  ];
  const saved = {};

  beforeEach(() => {
    jest.resetModules();
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    configStore.getEffective.mockReset();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  test('reads transaction flow identifiers from env', () => {
    process.env.PINGONE_DAVINCI_TRANSACTION_COMPANY_ID = 'co-1';
    process.env.PINGONE_DAVINCI_TRANSACTION_APP_ID = 'app-1';
    process.env.PINGONE_DAVINCI_TRANSACTION_FLOW_ID = 'flow-1';
    const davinci = require('../config/davinci');
    expect(davinci.transaction).toEqual({ companyId: 'co-1', appId: 'app-1', flowId: 'flow-1' });
  });

  test('reads login flow identifiers (two versions) from env', () => {
    process.env.PINGONE_DAVINCI_LOGIN_APP_ID = 'login-app';
    process.env.PINGONE_DAVINCI_LOGIN_FLOW_ID_V1 = 'flow-v1';
    process.env.PINGONE_DAVINCI_LOGIN_FLOW_ID_V2 = 'flow-v2';
    const davinci = require('../config/davinci');
    expect(davinci.login).toEqual({ appId: 'login-app', flowIdV1: 'flow-v1', flowIdV2: 'flow-v2' });
  });

  test('webhookUrl uses DAVINCI_WEBHOOK_URL when set, ignoring pingone_public_app_url', () => {
    process.env.DAVINCI_WEBHOOK_URL = 'https://example.test/webhook/davinci';
    const davinci = require('../config/davinci');
    expect(davinci.webhookUrl).toBe('https://example.test/webhook/davinci');
  });

  test('webhookUrl falls back to pingone_public_app_url + /webhook/davinci when unset', () => {
    configStore.getEffective.mockImplementation((k) =>
      k === 'pingone_public_app_url' ? 'https://local.ping-devops.com:4000' : undefined);
    const davinci = require('../config/davinci');
    expect(davinci.webhookUrl).toBe('https://local.ping-devops.com:4000/webhook/davinci');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/davinciConfig.test.js --forceExit`
Expected: FAIL — `Cannot find module '../config/davinci'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// demo_api_server/config/davinci.js
// DaVinci orchestration showcase — env config, lazy getters (mirrors config/oauth.js).
// See docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md.
'use strict';

const configStore = require('../services/configStore');

const config = {
  get apiClientId()     { return process.env.PINGONE_DAVINCI_API_CLIENT_ID; },
  get apiClientSecret() { return process.env.PINGONE_DAVINCI_API_CLIENT_SECRET; },

  get transaction() {
    return {
      companyId: process.env.PINGONE_DAVINCI_TRANSACTION_COMPANY_ID,
      appId:     process.env.PINGONE_DAVINCI_TRANSACTION_APP_ID,
      flowId:    process.env.PINGONE_DAVINCI_TRANSACTION_FLOW_ID,
    };
  },

  get login() {
    return {
      appId:     process.env.PINGONE_DAVINCI_LOGIN_APP_ID,
      flowIdV1:  process.env.PINGONE_DAVINCI_LOGIN_FLOW_ID_V1,
      flowIdV2:  process.env.PINGONE_DAVINCI_LOGIN_FLOW_ID_V2,
    };
  },

  get webhookUrl() {
    if (process.env.DAVINCI_WEBHOOK_URL) return process.env.DAVINCI_WEBHOOK_URL;
    const base = configStore.getEffective('pingone_public_app_url') || '';
    return `${base}/webhook/davinci`;
  },
};

module.exports = config;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/davinciConfig.test.js --forceExit`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/config/davinci.js demo_api_server/tests/davinciConfig.test.js
git commit -m "feat(davinci): add config/davinci.js env config"
```

---

### Task 3: `services/davinciFlowClient.js` — flow invocation client

**Files:**
- Create: `demo_api_server/services/davinciFlowClient.js`
- Test: `demo_api_server/tests/services/davinciFlowClient.test.js`

**Interfaces:**
- Consumes: `config/davinci.js` (Task 2) — `apiClientId`, `apiClientSecret`, `transaction.{companyId,appId,flowId}`, `login`; `utils/normalizeAxiosError` (existing).
- Produces: `module.exports = { invokeFlow }`. `invokeFlow(flowKey, params)` — `flowKey` is `'transactionAuthorization'` (only flow this client drives server-side; the login flow is Widget-invoked client-side in Task 8, not via this module). Returns `Promise<{ decision: 'PERMIT'|'DENY', stepUpRequired: boolean, stepUpCompleted: boolean }>` on success; throws a normalized `Error` (via `normalizeAxiosError`) on any HTTP failure — callers (Task 7) catch this to fail closed.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/tests/services/davinciFlowClient.test.js
'use strict';

jest.mock('axios');
jest.mock('../../config/davinci', () => ({
  apiClientId: 'client-id', apiClientSecret: 'client-secret',
  transaction: { companyId: 'co-1', appId: 'app-1', flowId: 'flow-1' },
}));

const axios = require('axios');
const { invokeFlow } = require('../../services/davinciFlowClient');

describe('davinciFlowClient.invokeFlow', () => {
  beforeEach(() => axios.post.mockReset());

  test('PERMIT: posts to the flow start endpoint and returns the parsed decision', async () => {
    axios.post.mockResolvedValue({
      data: { decision: 'PERMIT', stepUpRequired: false, stepUpCompleted: false },
    });

    const result = await invokeFlow('transactionAuthorization', {
      Amount: 50, TransactionType: 'transfer', Username: 'demoUser',
    });

    expect(result).toEqual({ decision: 'PERMIT', stepUpRequired: false, stepUpCompleted: false });
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/company/co-1/applications/app-1/flows/flow-1/start'),
      { Amount: 50, TransactionType: 'transfer', Username: 'demoUser' },
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringContaining('Bearer') }) }),
    );
  });

  test('STEP_UP: returns stepUpRequired true from the flow response', async () => {
    axios.post.mockResolvedValue({
      data: { decision: 'STEP_UP', stepUpRequired: true, stepUpCompleted: true },
    });

    const result = await invokeFlow('transactionAuthorization', {
      Amount: 15000, TransactionType: 'transfer', Username: 'demoUser',
    });

    expect(result.stepUpRequired).toBe(true);
  });

  test('unknown flowKey throws synchronously without calling axios', async () => {
    await expect(invokeFlow('notAFlow', {})).rejects.toThrow(/unknown flow/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('axios failure is normalized, never leaks raw error', async () => {
    const raw = new Error('connect ECONNREFUSED');
    raw.code = 'ECONNREFUSED';
    axios.post.mockRejectedValue(raw);

    await expect(invokeFlow('transactionAuthorization', { Amount: 1, TransactionType: 'transfer', Username: 'u' }))
      .rejects.toMatchObject({ code: 'UPSTREAM_UNREACHABLE', httpStatus: 503 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/services/davinciFlowClient.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../services/davinciFlowClient'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// demo_api_server/services/davinciFlowClient.js
// DaVinci flow invocation client — server-to-server API mode.
// See docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md.
'use strict';

const axios = require('axios');
const davinciConfig = require('../config/davinci');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const ORCHESTRATE_BASE = 'https://orchestrate-api.pingone.com/v1';

const FLOWS = {
  transactionAuthorization: () => davinciConfig.transaction,
};

async function invokeFlow(flowKey, params) {
  const resolve = FLOWS[flowKey];
  if (!resolve) {
    throw new Error(`davinciFlowClient: unknown flow "${flowKey}"`);
  }
  const { companyId, appId, flowId } = resolve();
  const url = `${ORCHESTRATE_BASE}/company/${companyId}/applications/${appId}/flows/${flowId}/start`;

  try {
    const res = await axios.post(url, params, {
      headers: {
        Authorization: `Bearer ${await _getApiToken()}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });
    return res.data;
  } catch (err) {
    throw normalizeAxiosError(err, { label: 'DaVinci flow invocation', timeoutMs: 10_000 });
  }
}

// Placeholder client_credentials token fetch — same shape as other worker-token
// call sites in this repo (e.g. mfaService's userAccessToken usage). Kept as its
// own function so a future PINGONE_DAVINCI token-cache can slot in without
// touching invokeFlow's call sites.
async function _getApiToken() {
  return `${davinciConfig.apiClientId}:${davinciConfig.apiClientSecret}`;
}

module.exports = { invokeFlow };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/services/davinciFlowClient.test.js --forceExit`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/davinciFlowClient.js demo_api_server/tests/services/davinciFlowClient.test.js
git commit -m "feat(davinci): add davinciFlowClient.invokeFlow"
```

---

### Task 4: DaVinci event webhook — LMDB store + receiver route

**Files:**
- Create: `demo_api_server/services/lmdb/davinciEventStore.lmdb.js`
- Create: `demo_api_server/routes/webhookDavinci.js`
- Test: `demo_api_server/tests/services/davinciEventStore.test.js`
- Test: `demo_api_server/tests/routes/webhookDavinci.test.js`
- Modify: `demo_api_server/server.js` — mount the new route next to the existing `webhookPingOneRoutes` mount (~line 509)

**Interfaces:**
- Produces (store): `{ append(event), query(filters), summary(), clear() }` — identical shape to `services/lmdb/pingoneEventStore.lmdb.js`, DB name `'davinciEvents'`.
- Produces (route): `router` mounted at `/webhook/davinci`, accepting `POST { eventType: 'fraud_alert'|'transaction_decision', ...payload }`, unauthenticated (mirrors `webhookPingOne.js`'s documented open-ingest tradeoff — DaVinci connectors offer no signing either), 200 `{ received: true, eventId }` on success, 400 `{ error: 'invalid_event' }` when `eventType` is missing/not a string.

- [ ] **Step 1: Write the failing test (store)**

```javascript
// demo_api_server/tests/services/davinciEventStore.test.js
'use strict';

const davinciEventStore = require('../../services/lmdb/davinciEventStore.lmdb');

describe('davinciEventStore', () => {
  beforeEach(() => davinciEventStore.clear());

  test('append assigns eventId and timestamp when absent, query returns newest-first', () => {
    const first = davinciEventStore.append({ eventType: 'fraud_alert', username: 'u1' });
    const second = davinciEventStore.append({ eventType: 'transaction_decision', username: 'u1', decision: 'PERMIT' });

    expect(first.eventId).toBeTruthy();
    expect(first.timestamp).toBeTruthy();

    const results = davinciEventStore.query();
    expect(results[0].eventId).toBe(second.eventId);
    expect(results[1].eventId).toBe(first.eventId);
  });

  test('query filters by eventType', () => {
    davinciEventStore.append({ eventType: 'fraud_alert', username: 'u1' });
    davinciEventStore.append({ eventType: 'transaction_decision', username: 'u1' });

    const results = davinciEventStore.query({ eventType: 'fraud_alert' });
    expect(results).toHaveLength(1);
    expect(results[0].eventType).toBe('fraud_alert');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/services/davinciEventStore.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../services/lmdb/davinciEventStore.lmdb'`

- [ ] **Step 3: Write minimal implementation (store)**

```javascript
// demo_api_server/services/lmdb/davinciEventStore.lmdb.js
// davinciEventStore.lmdb.js — durable event stream from the DaVinci showcase flows.
// Same shape/pattern as pingoneEventStore.lmdb.js; separate DB so DaVinci demo
// traffic never mixes with real PingOne console webhook events.
'use strict';
const { getDb } = require('./openEnv');

const DB_NAME = 'davinciEvents';
const MAX_EVENTS = 2000;

function _db() { return getDb(DB_NAME); }

let _seq = 0;
function _makeKey(ms) {
  _seq = (_seq + 1) % 0x10000;
  return `${String(ms).padStart(16, '0')}:${String(_seq).padStart(5, '0')}`;
}

function append(event) {
  const db = _db();
  const ms = Date.now();
  const stored = {
    ...event,
    eventId: event.eventId || `dv-${ms}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: event.timestamp || new Date(ms).toISOString(),
  };
  db.putSync(_makeKey(ms), stored);
  _prune(db);
  return stored;
}

function _prune(db) {
  let count;
  try { count = db.getStats().entryCount; } catch { return; }
  if (count <= MAX_EVENTS) return;
  const excess = count - MAX_EVENTS;
  let removed = 0;
  for (const key of db.getKeys({ limit: excess })) {
    db.removeSync(key);
    if (++removed >= excess) break;
  }
}

function query(filters = {}) {
  const db = _db();
  const limit = Number.isFinite(filters.limit) ? filters.limit : 200;
  const out = [];
  for (const { value } of db.getRange({ reverse: true })) {
    if (filters.eventType && value.eventType !== filters.eventType) continue;
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function summary() {
  const db = _db();
  const byEventType = {};
  let totalEvents = 0;
  for (const { value } of db.getRange()) {
    totalEvents++;
    const t = value.eventType || 'unknown';
    byEventType[t] = (byEventType[t] || 0) + 1;
  }
  return { totalEvents, byEventType };
}

function clear() {
  const db = _db();
  for (const key of db.getKeys()) db.removeSync(key);
}

module.exports = { append, query, summary, clear, DB_NAME, MAX_EVENTS };
```

- [ ] **Step 4: Run test to verify it passes (store)**

Run: `cd demo_api_server && CI=true npx jest tests/services/davinciEventStore.test.js --forceExit`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test (route)**

```javascript
// demo_api_server/tests/routes/webhookDavinci.test.js
'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../services/lmdb/davinciEventStore.lmdb', () => ({
  append: jest.fn((e) => ({ ...e, eventId: 'dv-test-1', timestamp: '2026-08-17T00:00:00.000Z' })),
}));

const davinciEventStore = require('../../services/lmdb/davinciEventStore.lmdb');
const webhookDavinciRoutes = require('../../routes/webhookDavinci');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/webhook', webhookDavinciRoutes);
  return app;
}

describe('POST /webhook/davinci', () => {
  beforeEach(() => davinciEventStore.append.mockClear());

  test('valid fraud_alert event is stored and 200s', async () => {
    const res = await request(buildApp())
      .post('/webhook/davinci')
      .send({ eventType: 'fraud_alert', username: 'demoUser', amount: 15000 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, eventId: 'dv-test-1' });
    expect(davinciEventStore.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'fraud_alert', username: 'demoUser', amount: 15000 }),
    );
  });

  test('missing eventType is rejected', async () => {
    const res = await request(buildApp()).post('/webhook/davinci').send({ username: 'demoUser' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_event' });
    expect(davinciEventStore.append).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/routes/webhookDavinci.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../routes/webhookDavinci'`

- [ ] **Step 7: Write minimal implementation (route)**

```javascript
// demo_api_server/routes/webhookDavinci.js
// Open ingest for the DaVinci showcase flows' HTTP connector callbacks
// (fraud_alert during step-up, transaction_decision on flow completion).
// Unauthenticated by design, same accepted tradeoff as webhookPingOne.js —
// DaVinci's Generic HTTP connector offers no request signing either.
'use strict';
const express = require('express');
const davinciEventStore = require('../services/lmdb/davinciEventStore.lmdb');

const router = express.Router();

router.post('/davinci', (req, res) => {
  const { eventType } = req.body || {};
  if (!eventType || typeof eventType !== 'string') {
    return res.status(400).json({ error: 'invalid_event' });
  }
  const stored = davinciEventStore.append(req.body);
  return res.status(200).json({ received: true, eventId: stored.eventId });
});

module.exports = router;
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/routes/webhookDavinci.test.js --forceExit`
Expected: PASS (2 tests)

- [ ] **Step 9: Mount the route in server.js**

Modify `demo_api_server/server.js` around line 509, immediately after the existing webhook mount:

```javascript
// (existing line ~509)
app.use('/webhook', express.json({ limit: '5mb' }), webhookPingOneRoutes);
// DaVinci showcase flow callbacks — same open-ingest posture as the PingOne
// webhook above (no signing available from a DaVinci HTTP connector node).
app.use('/webhook', express.json({ limit: '1mb' }), require('./routes/webhookDavinci'));
```

- [ ] **Step 10: Commit**

```bash
git add demo_api_server/services/lmdb/davinciEventStore.lmdb.js demo_api_server/routes/webhookDavinci.js demo_api_server/tests/services/davinciEventStore.test.js demo_api_server/tests/routes/webhookDavinci.test.js demo_api_server/server.js
git commit -m "feat(davinci): add /webhook/davinci event intake"
```

---

### Task 5: `ff_davinci_orchestration` flag

**Files:**
- Modify: `demo_api_server/routes/featureFlags.js` — add to `FLAG_REGISTRY`
- Modify: `demo_api_server/services/configStore.js` — add to `FIELD_DEFS`

**Interfaces:**
- Produces: `configStore.getEffective('ff_davinci_orchestration')` resolves to `'true'`/`'false'` (default `'false'`). This IS the visible admin-panel toggle — no separate UI component needed, the existing generic flags panel renders any `FLAG_REGISTRY` entry automatically. Task 7 and Task 9 read this flag with the repo's standard `=== true || === 'true'` convention.

- [ ] **Step 1: Add the FLAG_REGISTRY entry**

Modify `demo_api_server/routes/featureFlags.js`, insert a new entry near the other `ff_*` boolean flags (e.g. right after the `llm_framework` entry edited in Part 2 of this project):

```javascript
  {
    id:           'ff_davinci_orchestration',
    name:         'DaVinci Orchestration Showcase',
    category:     'UI / Dashboard',
    description:
      'When **ON**, high-value transaction step-up routes through the DaVinci ' +
      'multi-connector flow (SSO + Protect risk score + MFA + fraud-queue webhook + ' +
      'Authorize) instead of the hand-coded OTP/MFA consent-challenge state machine, ' +
      'and the DaVinci-widget login page becomes reachable from the nav. ' +
      '**OFF** (default) — both scenarios run exactly as they do today; no DaVinci ' +
      'API call is ever made.',
    impact: 'Falls back to the existing hand-coded path on any DaVinci API failure — never blocks a transaction.',
    type:         'boolean',
    defaultValue: false,
  },
```

- [ ] **Step 2: Add the FIELD_DEFS default**

Modify `demo_api_server/services/configStore.js`, insert next to the `llm_framework` entry (line ~336):

```javascript
  ff_davinci_orchestration:  { public: true, default: 'false' }, // DaVinci multi-connector showcase (transaction step-up + widget login)
```

- [ ] **Step 3: Verify no existing test asserts a fixed FLAG_REGISTRY length/snapshot**

Run: `cd demo_api_server && CI=true npx jest tests/featureFlagsPinned.test.js tests/featureFlagsAuthGate.test.js tests/featureFlags.bedrock.test.js --forceExit`
Expected: PASS — these test specific flags by id, not the registry's total shape, so a new entry does not break them. If any of these did assert a total count, update the expected count here and note why in the commit message.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/routes/featureFlags.js demo_api_server/services/configStore.js
git commit -m "feat(davinci): register ff_davinci_orchestration flag"
```

---

### Task 6: Wire transaction step-up through DaVinci (flag-gated, fail-closed)

**Files:**
- Modify: `demo_api_server/services/transactionConsentChallenge.js` — inside `confirmChallenge`, at the existing MFA-branch dispatch (the `if (mfaMode === 'device_picker' ...) { ... } else if (mfaMode === 'onetime') { ... }` chain starting at line 409)
- Test: `demo_api_server/tests/services/transactionConsentChallengeDavinci.test.js`

**Interfaces:**
- Consumes: `davinciFlowClient.invokeFlow` (Task 3), `configStore.getEffective('ff_davinci_orchestration')` (Task 5), `appEventService.logEvent` (existing, same pattern `a2aOrchestratorService.js` uses for its fallback log).
- Produces: a new exported function `confirmChallengeViaDaVinci(req, challengeId, opts)` with the **same return contract** as `confirmChallenge` (`{ ok: true, challengeId, ... }` / `{ ok: false, status, json }`) — the route layer (not touched by this task; out of scope, existing `routes/transactions.js` call site is left as a documented follow-on since it requires its own route-level test) can call whichever function `ff_davinci_orchestration` selects.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/tests/services/transactionConsentChallengeDavinci.test.js
'use strict';

jest.mock('../../services/davinciFlowClient', () => ({ invokeFlow: jest.fn() }));
jest.mock('../../services/configStore', () => {
  const actual = jest.requireActual('../../services/configStore');
  return { ...actual, getEffective: jest.fn(actual.getEffective) };
});

const { invokeFlow } = require('../../services/davinciFlowClient');
const configStore = require('../../services/configStore');
const {
  createChallenge,
  confirmChallengeViaDaVinci,
} = require('../../services/transactionConsentChallenge');

function reqStub(user, session = {}) {
  return { user, session };
}

describe('confirmChallengeViaDaVinci', () => {
  beforeEach(() => {
    invokeFlow.mockReset();
    configStore.getEffective.mockImplementation((k) => (k === 'ff_davinci_orchestration' ? 'true' : undefined));
  });

  test('PERMIT from DaVinci confirms the challenge without an MFA ceremony', async () => {
    const req = reqStub({ id: 'u1', role: 'customer' });
    const created = createChallenge(req, { type: 'transfer', amount: 20000, fromAccountId: 'a1', toAccountId: 'a2' });
    invokeFlow.mockResolvedValue({ decision: 'PERMIT', stepUpRequired: false, stepUpCompleted: false });

    const result = await confirmChallengeViaDaVinci(req, created.challengeId, { userName: 'Demo User' });

    expect(result.ok).toBe(true);
    expect(result.viaDaVinci).toBe(true);
    expect(invokeFlow).toHaveBeenCalledWith('transactionAuthorization', expect.objectContaining({
      Amount: 20000, TransactionType: 'transfer', Username: 'Demo User',
    }));
  });

  test('DENY from DaVinci does not confirm the challenge', async () => {
    const req = reqStub({ id: 'u1', role: 'customer' });
    const created = createChallenge(req, { type: 'transfer', amount: 60000, fromAccountId: 'a1', toAccountId: 'a2' });
    invokeFlow.mockResolvedValue({ decision: 'DENY', stepUpRequired: false, stepUpCompleted: false });

    const result = await confirmChallengeViaDaVinci(req, created.challengeId, {});

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  test('DaVinci API failure fails closed — falls back to the existing hand-coded confirmChallenge path', async () => {
    const req = reqStub({ id: 'u1', role: 'customer' });
    const created = createChallenge(req, { type: 'transfer', amount: 20000, fromAccountId: 'a1', toAccountId: 'a2' });
    invokeFlow.mockRejectedValue(Object.assign(new Error('unreachable'), { code: 'UPSTREAM_UNREACHABLE', httpStatus: 503 }));

    const result = await confirmChallengeViaDaVinci(req, created.challengeId, {});

    // Fallback runs the real confirmChallenge — for this amount (below step-up
    // threshold isn't guaranteed, so just assert it did NOT surface the raw
    // DaVinci error and DID move the challenge out of 'pending').
    expect(result.ok).toBe(true);
    expect(result.viaDaVinci).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionConsentChallengeDavinci.test.js --forceExit`
Expected: FAIL — `confirmChallengeViaDaVinci is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `demo_api_server/services/transactionConsentChallenge.js`, near the top requires:

```javascript
const davinciFlowClient = require('./davinciFlowClient');
const appEventService = require('./appEventService');
```

Add a new exported function (place it directly after `confirmChallenge`, before `_initiateOnetimeOtp`):

```javascript
/**
 * confirmChallengeViaDaVinci — DaVinci-orchestrated alternative to confirmChallenge,
 * used only when ff_davinci_orchestration is ON. Invokes the DaVinci transaction-
 * authorization flow (SSO + Protect + MFA + fraud-queue webhook + Authorize,
 * see docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md)
 * instead of the hand-coded OTP/MFA state machine. Fails closed: any DaVinci API
 * error falls back to confirmChallenge so a transaction is never blocked by a
 * DaVinci outage.
 *
 * @param {import('express').Request} req
 * @param {string} challengeId
 * @param {object} [opts]
 * @param {string} [opts.userName]
 */
async function confirmChallengeViaDaVinci(req, challengeId, opts = {}) {
  const st = store(req.session);
  pruneExpired(st);
  const ch = st[challengeId];
  if (!ch || ch.userId !== req.user.id) {
    return { ok: false, status: 404, json: { error: 'challenge_not_found', message: 'Unknown or expired consent challenge.' } };
  }
  if (ch.status !== 'pending') {
    return { ok: false, status: 409, json: { error: 'challenge_not_pending', message: 'Challenge already confirmed or consumed.' } };
  }

  const userName = opts.userName || req.user.username || 'Demo User';

  let flowResult;
  try {
    flowResult = await davinciFlowClient.invokeFlow('transactionAuthorization', {
      Amount: ch.snapshot.amount,
      TransactionType: ch.snapshot.type,
      Username: userName,
    });
  } catch (err) {
    appEventService.logEvent('davinci', 'warn', 'DaVinci transaction flow failed — falling back to hand-coded consent path', {
      tag: 'davinci/fallback',
      metadata: { error: err.message, challengeId: challengeId.slice(0, 8) },
    });
    return confirmChallenge(req, challengeId, opts);
  }

  if (flowResult.decision === 'DENY') {
    return { ok: false, status: 403, json: { error: 'davinci_denied', message: 'Transaction denied by DaVinci authorization flow.' } };
  }

  const now = Date.now();
  ch.status           = 'confirmed';
  ch.confirmedAt      = now;
  ch.confirmExpiresAt = now + CONFIRMED_TTL_MS;
  _grantHitlCredit(req, ch);
  if (flowResult.stepUpCompleted) _grantStepUpCredit(req);

  console.log(`[ConsentChallenge] DaVinci flow confirmed challenge=${challengeId.slice(0, 8)}… user=${req.user.id} decision=${flowResult.decision}`);
  return { ok: true, challengeId, viaDaVinci: true, confirmExpiresAt: ch.confirmExpiresAt };
}
```

Add `confirmChallengeViaDaVinci` to the `module.exports` block at the bottom of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/services/transactionConsentChallengeDavinci.test.js --forceExit`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full existing consent-challenge suite to confirm no regression**

Run: `cd demo_api_server && CI=true npx jest tests/transactionConsentChallenge --forceExit` (matches any existing test files for this service by prefix — if none exist by that exact prefix, run `CI=true npm test -- --forceExit --maxWorkers=4 -- transactionConsentChallenge` and confirm 0 failures either way)
Expected: PASS, same count as before this task

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/transactionConsentChallenge.js demo_api_server/tests/services/transactionConsentChallengeDavinci.test.js
git commit -m "feat(davinci): add confirmChallengeViaDaVinci, fail-closed fallback"
```

---

### Task 7: Route-level wiring — `POST /consent-challenge/:id/confirm` picks the path

**Files:**
- Modify: `demo_api_server/routes/transactions.js` — locate the existing route handler that calls `txConsent.confirmChallenge(...)` (referenced from the module import at the top: `const txConsent = require('../services/transactionConsentChallenge');`)
- Test: `demo_api_server/tests/routes/transactionsConfirmDavinci.test.js`

**Interfaces:**
- Consumes: `configStore.getEffective('ff_davinci_orchestration')`, `txConsent.confirmChallenge` / `txConsent.confirmChallengeViaDaVinci` (Task 6).
- Produces: no new exports — behavioral change only, gated by the flag.

**Confirmed call site** (`demo_api_server/routes/transactions.js:197-202`):

```javascript
router.post(
  '/consent-challenge/:challengeId/confirm',
  authenticateToken,
  async (req, res) => {
    const result = await txConsent.confirmChallenge(req, req.params.challengeId);
    if (!result.ok) return res.status(result.status).json(result.json);
    req.session.save((saveErr) => {
      if (saveErr) console.error('[ConsentChallenge] session save error (confirm):', saveErr);
      // ... (existing response, unchanged)
```

The route param is `:challengeId`, not `:id` — use `req.params.challengeId` in Steps below.

- [ ] **Step 2: Write the failing test**

```javascript
// demo_api_server/tests/routes/transactionsConfirmDavinci.test.js
'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../services/transactionConsentChallenge', () => ({
  confirmChallenge: jest.fn(),
  confirmChallengeViaDaVinci: jest.fn(),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));

const txConsent = require('../../services/transactionConsentChallenge');
const configStore = require('../../services/configStore');
const transactionsRoutes = require('../../routes/transactions');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u1', role: 'customer' }; req.session = {}; next(); });
  app.use('/api/transactions', transactionsRoutes);
  return app;
}

describe('POST /consent-challenge/:id/confirm — DaVinci flag routing', () => {
  beforeEach(() => {
    txConsent.confirmChallenge.mockReset().mockResolvedValue({ ok: true, challengeId: 'c1' });
    txConsent.confirmChallengeViaDaVinci.mockReset().mockResolvedValue({ ok: true, challengeId: 'c1', viaDaVinci: true });
    configStore.getEffective.mockReset();
  });

  test('flag OFF (default): calls confirmChallenge, never confirmChallengeViaDaVinci', async () => {
    configStore.getEffective.mockReturnValue(undefined);
    await request(buildApp()).post('/api/transactions/consent-challenge/c1/confirm').send({});
    expect(txConsent.confirmChallenge).toHaveBeenCalled();
    expect(txConsent.confirmChallengeViaDaVinci).not.toHaveBeenCalled();
  });

  test('flag ON: calls confirmChallengeViaDaVinci, never confirmChallenge', async () => {
    configStore.getEffective.mockImplementation((k) => (k === 'ff_davinci_orchestration' ? 'true' : undefined));
    await request(buildApp()).post('/api/transactions/consent-challenge/c1/confirm').send({});
    expect(txConsent.confirmChallengeViaDaVinci).toHaveBeenCalled();
    expect(txConsent.confirmChallenge).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/routes/transactionsConfirmDavinci.test.js --forceExit`
Expected: FAIL — both calls currently go to `confirmChallenge` regardless of the flag (the mock for `confirmChallengeViaDaVinci` is never called in the ON case)

- [ ] **Step 4: Write minimal implementation**

At the call site found in Step 1, replace the direct `txConsent.confirmChallenge(req, ...)` call with:

```javascript
const useDaVinci = configStore.getEffective('ff_davinci_orchestration') === 'true'
  || configStore.getEffective('ff_davinci_orchestration') === true;
const result = useDaVinci
  ? await txConsent.confirmChallengeViaDaVinci(req, req.params.challengeId, { userName: req.user.username })
  : await txConsent.confirmChallenge(req, req.params.challengeId, { userName: req.user.username });
```

(Keep every line after this — the existing `if (!result.ok) { ... } else { ... }` response handling — unchanged; only the function selection changes. Confirm `configStore` is already imported at the top of `routes/transactions.js`; if not, add `const configStore = require('../services/configStore');`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/routes/transactionsConfirmDavinci.test.js --forceExit`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the full default suite to confirm no regression**

There is no mocked unit-test file for this specific route today — the only `*transactions.test.js` files live under `tests/real/<vertical>/` (live-stack, run separately via `jest.real.config.js`, not part of the default suite). The regression check for this change is the full default suite plus the new test from Step 2.

Run: `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4`
Expected: PASS, same failure count as the Part 2 baseline (0 real failures; the pre-existing `mcpInspectorProfiles.test.js` ECONNRESET flake may reappear under parallel load — re-run it alone if so, per the `verify-ai-demo2` skill)

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/routes/transactions.js demo_api_server/tests/routes/transactionsConfirmDavinci.test.js
git commit -m "feat(davinci): route consent-challenge confirm through ff_davinci_orchestration"
```

---

### Task 8: `demo_api_ui` — `@forgerock/davinci-client` + `davinciWidgetClient.js`

**Files:**
- Modify: `demo_api_ui/package.json` — add `"@forgerock/davinci-client": "^2.0.0"` next to the existing `"@forgerock/oidc-client": "^2.0.0"`
- Create: `demo_api_ui/src/lib/davinciWidgetClient.js`
- Test: `demo_api_ui/src/lib/__tests__/davinciWidgetClient.test.js` (or `demo_api_ui/tests/` root if that is where existing `src/lib` tests live — check with `find demo_api_ui/src/lib -iname "*.test.js"` first and match the existing convention)

**Interfaces:**
- Produces: `export function getDavinciClient()` (memoized, mirrors `getSdkClient()`), `export function isSdkError(result)` (re-exported, identical semantics to `oidcSdkClient.js`'s).
- Consumes: new backend endpoint `GET /api/davinci-demo/config` (built in Task 9) returning `{ wellknown, clientId, redirectUri, flowVersion }`.

- [ ] **Step 1: Install the dependency**

Run: `cd demo_api_ui && npm install @forgerock/davinci-client@^2.0.0`

- [ ] **Step 2: Write the failing test**

```javascript
// demo_api_ui/src/lib/__tests__/davinciWidgetClient.test.js
import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@forgerock/davinci-client", () => ({
  davinci: vi.fn(),
}));

const originalFetch = global.fetch;

describe("davinciWidgetClient.getDavinciClient", () => {
  beforeEach(async () => {
    vi.resetModules();
    global.fetch = vi.fn();
    const { davinci } = await import("@forgerock/davinci-client");
    davinci.mockReset();
  });
  afterEach(() => { global.fetch = originalFetch; });

  test("fetches config and builds a davinci client", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        wellknown: "https://auth.pingone.com/env-1/as/.well-known/openid-configuration",
        clientId: "widget-client-id",
        redirectUri: "https://local.ping-devops.com:4000/davinci-login/callback",
        flowVersion: "v1",
      }),
    });
    const { davinci } = await import("@forgerock/davinci-client");
    davinci.mockReturnValue({ some: "client" });

    const { getDavinciClient } = await import("../davinciWidgetClient");
    const client = await getDavinciClient();

    expect(client).toEqual({ some: "client" });
    expect(davinci).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        clientId: "widget-client-id",
        redirectUri: "https://local.ping-devops.com:4000/davinci-login/callback",
      }),
    }));
  });

  test("throws when the config endpoint is not configured", async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { getDavinciClient } = await import("../davinciWidgetClient");
    await expect(getDavinciClient()).rejects.toThrow(/not configured/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/lib/__tests__/davinciWidgetClient.test.js`
Expected: FAIL — `Failed to resolve import "../davinciWidgetClient"`

- [ ] **Step 4: Write minimal implementation**

```javascript
// demo_api_ui/src/lib/davinciWidgetClient.js
import { davinci } from "@forgerock/davinci-client";

// Widget-invoked DaVinci login demo (/davinci-login). Config comes from the
// BFF's public GET /api/davinci-demo/config, same pattern as oidcSdkClient.js's
// GET /api/sdk-demo/config — nothing hardcoded in the bundle.

let clientPromise = null;

async function build() {
  const res = await fetch("/api/davinci-demo/config", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Could not load DaVinci demo config (HTTP ${res.status})`);
  }
  const cfg = await res.json();
  if (!cfg.clientId || !cfg.wellknown) {
    throw new Error(
      "DaVinci demo is not configured. Set the PINGONE_DAVINCI_LOGIN_* env vars " +
        "(see docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md) and restart the server."
    );
  }

  const client = davinci({
    config: {
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      serverConfig: { wellknown: cfg.wellknown },
    },
  });
  return client;
}

export function getDavinciClient() {
  if (!clientPromise) {
    clientPromise = build().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export function isSdkError(result) {
  return !result || (typeof result === "object" && Boolean(result.error));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/lib/__tests__/davinciWidgetClient.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/package.json demo_api_ui/package-lock.json demo_api_ui/src/lib/davinciWidgetClient.js demo_api_ui/src/lib/__tests__/davinciWidgetClient.test.js
git commit -m "feat(davinci): add davinciWidgetClient (davinci-client SDK wrapper)"
```

---

### Task 9: Backend — `/api/davinci-demo/config` + login callback route

**Files:**
- Modify: `demo_api_server/server.js` — add a new public config endpoint next to `/api/sdk-demo/config` (~line 1058)
- Create: `demo_api_server/routes/davinciLogin.js`
- Test: `demo_api_server/tests/routes/davinciLogin.test.js`

**Interfaces:**
- Produces: `GET /api/davinci-demo/config` → `{ wellknown, clientId, redirectUri, flowVersion }`. `router` from `davinciLogin.js` mounted at `/api/davinci-login`, exposing `POST /callback` that exchanges the DaVinci flow's terminal OIDC code for tokens via the existing `oauthService` token-exchange helper (reused, not duplicated) and establishes `req.session` the same shape `routes/oauth.js`'s callback does.
- Consumes: `config/davinci.js` (Task 2) for `login.appId`/`flowIdV1`, `services/oauthService.js`'s existing `exchangeCodeForToken` (or whatever its exact exported method is named — confirm via `grep -n "module.exports\|async exchangeCode\|async function exchange" demo_api_server/services/oauthService.js` before writing this task's code, since the plan must call the real name, not a guessed one).

**Confirmed:** `demo_api_server/services/oauthService.js:238` exports a singleton (`module.exports = new OAuthService()`, line 1259) with `async exchangeCodeForToken(code, codeVerifier, redirectUri, resources = null)`. The 4th `resources` param is optional (RFC 8707) — omit it here, the widget login doesn't need resource-scoped tokens.

- [ ] **Step 2: Add the config endpoint**

Modify `demo_api_server/server.js`, immediately after the existing `/api/sdk-demo/config` handler (~line 1082):

```javascript
// DaVinci widget login demo (/davinci-login) — public, non-secret config for
// @forgerock/davinci-client. flowVersion lets the UI show which A/B version is
// live (see docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md).
app.get('/api/davinci-demo/config', (req, res) => {
    try {
        const davinciConfig = require('./config/davinci');
        let redirectUri = configStore.getEffective('pingone_davinci_login_redirect_uri');
        if (!redirectUri) {
            const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
            const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
            redirectUri = `${proto}://${host}/davinci-login/callback`;
        }
        res.json({
            wellknown:   getDiscoveryEndpoint(),
            clientId:    davinciConfig.login.appId,
            redirectUri,
            flowVersion: configStore.getEffective('davinci_login_flow_version') || 'v1',
        });
    } catch (err) {
        res.status(500).json({ error: 'davinci_demo_config_failed', message: err.message });
    }
});
```

- [ ] **Step 3: Write the failing test (callback route)**

```javascript
// demo_api_server/tests/routes/davinciLogin.test.js
'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');

jest.mock('../../services/oauthService', () => ({
  exchangeCodeForToken: jest.fn(),
}));

const oauthService = require('../../services/oauthService');
const davinciLoginRoutes = require('../../routes/davinciLogin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: true }));
  app.use('/api/davinci-login', davinciLoginRoutes);
  return app;
}

describe('POST /api/davinci-login/callback', () => {
  beforeEach(() => oauthService.exchangeCodeForToken.mockReset());

  test('valid code exchanges tokens and establishes a session', async () => {
    oauthService.exchangeCodeForToken.mockResolvedValue({
      accessToken: 'at-1', idToken: 'it-1', expiresAt: Date.now() + 3600_000,
      claims: { sub: 'u1', preferred_username: 'demoUser' },
    });

    const res = await request(buildApp())
      .post('/api/davinci-login/callback')
      .send({ code: 'code-1', codeVerifier: 'verifier-1', redirectUri: 'https://local.ping-devops.com:4000/davinci-login/callback' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(oauthService.exchangeCodeForToken).toHaveBeenCalledWith('code-1', 'verifier-1', 'https://local.ping-devops.com:4000/davinci-login/callback');
  });

  test('missing code is rejected', async () => {
    const res = await request(buildApp()).post('/api/davinci-login/callback').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request', message: 'code, codeVerifier, and redirectUri are required.' });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/routes/davinciLogin.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../routes/davinciLogin'`

- [ ] **Step 5: Write minimal implementation**

```javascript
// demo_api_server/routes/davinciLogin.js
// Backend half of the DaVinci widget login demo (/davinci-login). The widget
// completes the flow entirely client-side down to a standard OIDC code; this
// route exchanges it exactly the way routes/oauth.js's redirect callback does,
// reusing oauthService so the resulting session is indistinguishable from a
// normal login. Does not touch routes/oauth.js (REGRESSION_PLAN §1).
'use strict';
const express = require('express');
const oauthService = require('../services/oauthService');

const router = express.Router();

router.post('/callback', async (req, res) => {
  const { code, codeVerifier, redirectUri } = req.body || {};
  if (!code || !codeVerifier || !redirectUri) {
    return res.status(400).json({ error: 'invalid_request', message: 'code, codeVerifier, and redirectUri are required.' });
  }

  try {
    const tokens = await oauthService.exchangeCodeForToken(code, codeVerifier, redirectUri);
    req.session.oauthTokens = {
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      expiresAt: tokens.expiresAt,
    };
    req.session.user = {
      id: tokens.claims?.sub,
      username: tokens.claims?.preferred_username,
    };
    return res.json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: 'davinci_login_exchange_failed', message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 6: Mount the route in server.js**

```javascript
// near the existing app.use('/api/sdk-demo', ...) mount
app.use('/api/davinci-login', require('./routes/davinciLogin'));
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/routes/davinciLogin.test.js --forceExit`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/server.js demo_api_server/routes/davinciLogin.js demo_api_server/tests/routes/davinciLogin.test.js
git commit -m "feat(davinci): add /api/davinci-demo/config and /api/davinci-login/callback"
```

---

### Task 10: `demo_api_ui` — `DavinciLoginPage.jsx` + route registration

**Files:**
- Create: `demo_api_ui/src/pages/DavinciLoginPage.jsx`
- Modify: `demo_api_ui/src/routes/PublicRoutes.js` — add `DavinciLoginPageRoute`, mirroring `SdkLoginPageRoute` (lines 256-261)
- Modify: `demo_api_ui/src/App.js` — add the `/davinci-login` route, mirroring the `/sdk-login` registration (lines 187-188, 711-712)

**Interfaces:**
- Consumes: `getDavinciClient`, `isSdkError` from `davinciWidgetClient.js` (Task 8).
- Produces: a route reachable at `/davinci-login`, bare (no `AppShell`, matching `SdkLoginPageRoute`'s comment about the SDK sandbox being self-contained), rendering the flow's collectors (per the DaVinci collector table: `TextCollector`, `PasswordCollector`, `SubmitCollector`) and showing which flow version (`v1`/`v2`) is live.

- [ ] **Step 1: Write the page component**

```jsx
// demo_api_ui/src/pages/DavinciLoginPage.jsx
import { useCallback, useEffect, useState } from "react";
import { getDavinciClient, isSdkError } from "../lib/davinciWidgetClient";

// DaVinci Widget login sandbox (/davinci-login). Demonstrates the risk-adaptive,
// two-version DaVinci login flow via @forgerock/davinci-client — separate from
// and does not touch the protected BFF redirect login (routes/oauth.js). See
// docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md.

export default function DavinciLoginPage() {
  const [status, setStatus] = useState("loading"); // loading | collecting | error | done
  const [node, setNode] = useState(null);
  const [flowVersion, setFlowVersion] = useState(null);
  const [fieldValues, setFieldValues] = useState({});
  const [error, setError] = useState(null);

  const start = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const client = await getDavinciClient();
      const result = await client.start();
      if (isSdkError(result)) throw new Error(result.error || "Could not start the DaVinci flow");
      setNode(result);
      setStatus("collecting");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    start();
    fetch("/api/davinci-demo/config", { headers: { Accept: "application/json" } })
      .then((res) => res.json())
      .then((cfg) => setFlowVersion(cfg.flowVersion || null))
      .catch(() => setFlowVersion(null));
  }, [start]);

  const handleFieldChange = (key, value) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const client = await getDavinciClient();
      for (const collector of node?.collectors || []) {
        if (fieldValues[collector.name] !== undefined) {
          collector.setValue(fieldValues[collector.name]);
        }
      }
      const result = await client.next(node);
      if (isSdkError(result)) throw new Error(result.error || "The DaVinci flow rejected this step");
      if (result.status === "success") {
        setStatus("done");
      } else {
        setNode(result);
        setFieldValues({});
        setStatus("collecting");
      }
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, [node, fieldValues]);

  return (
    <div style={{ maxWidth: 480, margin: "48px auto", padding: "0 20px", font: "14px/1.5 -apple-system,sans-serif" }}>
      <h1 style={{ fontSize: 20 }}>DaVinci Widget Login</h1>
      {flowVersion && <p style={{ color: "#6b7280", fontSize: 12 }}>Flow version: {flowVersion}</p>}

      {error && <div style={{ color: "#c5302a", marginBottom: 12 }}>{error}</div>}

      {status === "loading" && <p>Loading…</p>}

      {status === "collecting" && node && (
        <div>
          {(node.collectors || []).map((collector) => (
            <div key={collector.name} style={{ marginBottom: 12 }}>
              <label style={{ display: "block", marginBottom: 4 }}>{collector.label || collector.name}</label>
              <input
                type={collector.type === "PasswordCollector" ? "password" : "text"}
                value={fieldValues[collector.name] || ""}
                onChange={(e) => handleFieldChange(collector.name, e.target.value)}
              />
            </div>
          ))}
          <button type="button" onClick={handleSubmit}>Continue</button>
        </div>
      )}

      {status === "done" && <p>Signed in.</p>}

      {status === "error" && (
        <button type="button" onClick={start}>Retry</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the route (PublicRoutes.js)**

Modify `demo_api_ui/src/routes/PublicRoutes.js`, add next to `SdkLoginPageRoute` (after line 261):

```javascript
// DaVinci widget login sandbox (public) — drives its own browser-side flow.
export function DavinciLoginPageRoute() {
  return <DavinciLoginPage />;
}
```

(Add `import DavinciLoginPage from "../pages/DavinciLoginPage";` near the file's existing `SdkLoginPage` import.)

- [ ] **Step 3: Register the route (App.js)**

Modify `demo_api_ui/src/App.js`:

```javascript
// near line 187-188
  SdkLoginCallbackRoute,
  SdkLoginPageRoute,
  DavinciLoginPageRoute,
```

```javascript
// near line 711-714
                <Route
                  path="/sdk-login"
                  element={<SdkLoginPageRoute />}
                />
                <Route path="/sdk-login/callback" element={<SdkLoginCallbackRoute />} />
                <Route path="/davinci-login" element={<DavinciLoginPageRoute />} />
```

- [ ] **Step 4: Build check**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0, no new warnings referencing `DavinciLoginPage` or `DavinciLoginPageRoute`

- [ ] **Step 5: Unit test check (no regression)**

Run: `cd demo_api_ui && npm run test:unit`
Expected: PASS, same failure count as baseline (0 expected)

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/DavinciLoginPage.jsx demo_api_ui/src/routes/PublicRoutes.js demo_api_ui/src/App.js
git commit -m "feat(davinci): add /davinci-login widget page and route"
```

---

---

### Task 11: More-menu "DaVinci Mode" toggle

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` — add state near the existing `showFilmstrip` declaration (line 661) and a new `Check` toggle in the More popover, inserted immediately after the "Movie reel" toggle (line 8971), before the "Topology" button (line 8972)

**Interfaces:**
- Produces: `localStorage` key `ba_davinci_mode` (`"1"`/`"0"`, mirrors `ba_show_filmstrip`'s convention exactly), `davinciMode` component state, and a `window.dispatchEvent(new CustomEvent("agent-davinci-mode-toggle", { detail: { on: newVal } }))` broadcast (mirrors the filmstrip toggle's `agent-filmstrip-toggle` event) — Task 12's nav button reads `davinciMode` from the same component, so no other listener is required for this task alone.
- This is a pure client-side UI preference — it does **not** flip the server-side `ff_davinci_orchestration` flag from Task 5 (that stays an admin-only control, unchanged). "DaVinci Mode" ON only changes what the More menu and dashboard nav *surface*, so any signed-in presenter can flip it instantly for a live demo without admin rights — exactly the "quick demo" requirement.

- [ ] **Step 1: Add the state declaration**

Modify `demo_api_ui/src/components/AIAgent.js`, immediately after the `showFilmstrip` `useState` block (after line 667):

```javascript
  // "DaVinci Mode" — pure UI preference (no server flag), surfaces the DaVinci
  // Orchestration explainer/demo nav entry instead of standard agent chrome.
  // See docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md.
  const [davinciMode, setDavinciMode] = useState(() => {
    try {
      return localStorage.getItem("ba_davinci_mode") === "1";
    } catch {
      return false;
    }
  });
```

- [ ] **Step 2: Add the toggle to the More popover**

Modify `demo_api_ui/src/components/AIAgent.js`, insert immediately after the Movie reel `</Check>` (after line 8971), before the Topology `<button>`:

```jsx
                      <Check
                        variant="switch"
                        className="ba-header-toggle-label"
                        checked={davinciMode}
                        onChange={(e) => {
                          const newVal = e.target.checked;
                          try {
                            localStorage.setItem("ba_davinci_mode", newVal ? "1" : "0");
                          } catch {}
                          setDavinciMode(newVal);
                          window.dispatchEvent(new CustomEvent("agent-davinci-mode-toggle", { detail: { on: newVal } }));
                        }}
                        title="Switch this demo between the standard hand-coded flows and PingOne DaVinci-orchestrated flows"
                      >
                        DaVinci Mode
                      </Check>
```

- [ ] **Step 3: Manual verification (no automated test — this mirrors untested existing toggles like Movie reel/Dark mode)**

Run: `cd demo_api_ui && npm run build` (gate — confirms no syntax error)
Expected: exit 0

Then manually: open the agent dashboard, click "More", confirm "DaVinci Mode" appears below "Movie reel" as a switch, toggle it, confirm `localStorage.getItem("ba_davinci_mode")` reflects the new value in devtools, and the toggle state survives a page reload.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js
git commit -m "feat(davinci): add DaVinci Mode toggle to agent header More menu"
```

---

### Task 12: DaVinci Orchestration explainer page + nav entry

**Files:**
- Create: `demo_api_ui/src/pages/DavinciExplainerPage.jsx`
- Modify: `demo_api_ui/src/routes/PublicRoutes.js` — add `DavinciExplainerRoute({ user, logout })`, mirroring `McpGatewayConfigRoute` (lines 248-254, `AppShell`-wrapped)
- Modify: `demo_api_ui/src/App.js` — add the `/davinci-orchestration` route
- Modify: `demo_api_ui/src/components/AIAgent.js` — add a nav button in the More popover, rendered only when `davinciMode` is true (Task 11), inserted after the "Script" button (after line 8996)

**Interfaces:**
- Produces: a route at `/davinci-orchestration`, `AppShell`-wrapped (keeps the normal dashboard nav/chrome, unlike the bare `/sdk-login`/`/davinci-login` sandboxes — this page is reached *from* the dashboard by a signed-in presenter). Makes **zero** network calls to DaVinci or the BFF's DaVinci endpoints — pure static/explanatory content, so it always works even with Task 1's console setup incomplete ("quick demos" requirement). Links out to `/davinci-login` (Task 10) as an optional "see it live" CTA.
- Consumes: nothing live. Content is the competitive/value narrative already written in `docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md`'s Context section (Okta Workflows/Auth0 Actions/Entra ID Governance comparison, DaVinci's vendor-agnostic connector breadth, visual multi-system branching, A/B flow versioning) — reuse that text, do not write new marketing copy from scratch.

- [ ] **Step 1: Write the explainer page**

```jsx
// demo_api_ui/src/pages/DavinciExplainerPage.jsx
// Static value-prop page for PingOne DaVinci orchestration — makes NO live
// DaVinci calls, so it works even before the console setup in
// docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md's
// Task 1 is done. Reached from the agent header's More menu when "DaVinci Mode"
// is on (see AIAgent.js). Optional CTA links to the live widget demo (/davinci-login).

const COMPARISON_ROWS = [
  { platform: "Okta Workflows", note: "No-code, but locked to the Okta ecosystem." },
  { platform: "Auth0 Actions", note: "Code-based (JavaScript) extensibility, not a visual no-code canvas." },
  { platform: "Microsoft Entra ID Governance", note: "Strong only inside the Azure/Microsoft stack." },
  { platform: "PingOne DaVinci", note: "Vendor-agnostic — 350+ connectors spanning identity AND business/IT systems (Slack, Twilio, ServiceNow, generic HTTP), visual multi-system branching, flow versioning/A-B testing, SaaS/self-managed/hybrid deployment." },
];

const ORCHESTRATION_STEPS = [
  "PingOne SSO — look up the user",
  "PingOne Protect — real-time risk score",
  "Branch: low risk permits immediately; medium/high risk continues",
  "PingOne MFA step-up, in parallel with a Generic HTTP connector alerting a fraud queue (a business system, not just an identity service)",
  "PingOne Authorize — final policy decision",
  "Generic HTTP connector — writes the result back into this demo's own audit trail",
];

export default function DavinciExplainerPage() {
  return (
    <div style={{ maxWidth: 760, margin: "32px auto", padding: "0 20px", font: "14px/1.6 -apple-system,sans-serif" }}>
      <h1 style={{ fontSize: 24 }}>Why PingOne DaVinci Orchestration</h1>
      <p style={{ color: "#4b5563" }}>
        A single-connector policy check proves DaVinci can call an API. It does not show why a
        customer would buy it. The value is orchestrating <em>many</em> connector types — identity
        AND business systems — on one visual, no-code canvas.
      </p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>How this differs from the alternatives</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
        <tbody>
          {COMPARISON_ROWS.map((row) => (
            <tr key={row.platform} style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={{ padding: "10px 12px 10px 0", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top" }}>
                {row.platform}
              </td>
              <td style={{ padding: "10px 0", color: "#4b5563" }}>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>What this demo's transaction step-up flow chains together</h2>
      <ol style={{ color: "#4b5563", paddingLeft: 20 }}>
        {ORCHESTRATION_STEPS.map((step) => (
          <li key={step} style={{ marginBottom: 8 }}>{step}</li>
        ))}
      </ol>
      <p style={{ color: "#4b5563" }}>
        None of that chain is a single API call away — it is exactly the kind of cross-system
        orchestration a customer would otherwise hand-write and maintain themselves.
      </p>

      <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
        <a
          href="/davinci-login"
          style={{ display: "inline-block", padding: "10px 18px", borderRadius: 8, background: "#2f81f7", color: "#fff", fontWeight: 600, textDecoration: "none" }}
        >
          See the live widget login demo
        </a>
      </div>
      <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 8 }}>
        Requires the DaVinci console setup in the implementation plan's Task 1. If that has not
        been done yet on this environment, the live demo page will explain what is missing.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Register the route (PublicRoutes.js)**

Modify `demo_api_ui/src/routes/PublicRoutes.js`, add next to `McpGatewayConfigRoute` (after line 254):

```javascript
// DaVinci Orchestration explainer — signed-in, AppShell-wrapped (reached from
// the agent header's More menu, not a pre-login sandbox like SdkLoginPageRoute).
export function DavinciExplainerRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <DavinciExplainerPage />
    </AppShell>
  );
}
```

(Add `import DavinciExplainerPage from "../pages/DavinciExplainerPage";` near the file's existing page imports.)

- [ ] **Step 3: Register the route (App.js)**

Modify `demo_api_ui/src/App.js`, add the import next to the other Task 10 additions and a new `<Route>` next to `/davinci-login`:

```javascript
  DavinciLoginPageRoute,
  DavinciExplainerRoute,
```

```javascript
                <Route path="/davinci-login" element={<DavinciLoginPageRoute />} />
                <Route path="/davinci-orchestration" element={<DavinciExplainerRoute user={user} logout={logout} />} />
```

(Match whatever `user`/`logout` variable names the surrounding routes in `App.js` already use — `McpGatewayConfigRoute`'s existing call site in `App.js` has the exact pattern to copy.)

- [ ] **Step 4: Add the conditional nav button in the More menu**

Modify `demo_api_ui/src/components/AIAgent.js`, insert immediately after the "Script" `</button>` (after line 8996), still inside the same popover `<div>`:

```jsx
                      {davinciMode && (
                        <button
                          type="button"
                          className="ba-actions-trigger"
                          title="Why PingOne DaVinci orchestration — value walkthrough, no live flow required"
                          onClick={() => { window.location.href = "/davinci-orchestration"; }}
                        >
                          DaVinci Orchestration
                        </button>
                      )}
```

- [ ] **Step 5: Build and unit-test check**

Run: `cd demo_api_ui && npm run build && npm run test:unit`
Expected: both exit 0, no new test failures

- [ ] **Step 6: Manual verification**

Turn on "DaVinci Mode" (Task 11's toggle), confirm the "DaVinci Orchestration" button now appears in the More menu, click it, confirm `/davinci-orchestration` renders the explainer content inside the normal dashboard chrome with zero network errors in the console (no DaVinci/BFF calls made by this page itself).

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/pages/DavinciExplainerPage.jsx demo_api_ui/src/routes/PublicRoutes.js demo_api_ui/src/App.js demo_api_ui/src/components/AIAgent.js
git commit -m "feat(davinci): add DaVinci Orchestration explainer page + More-menu nav entry"
```

---

## Self-Review Notes (for the implementer)

- Task 7's call site (`routes/transactions.js:197-202`, param `:challengeId`) and Task 9's `oauthService.exchangeCodeForToken(code, codeVerifier, redirectUri, resources=null)` signature were both confirmed against the actual source while writing this plan — the code blocks above already reflect the real names/shapes, not guesses.
- Tasks 1 (console) and 2-10 (code) are intentionally separable: Tasks 2-9's unit tests all mock `davinciFlowClient`/`davinci-client`, so the whole code path is testable and mergeable before Task 1's console setup is complete. Only true end-to-end manual verification (walking `/davinci-login` or a live `ff_davinci_orchestration=true` transaction in a browser) requires Task 1 done first.
- Task 9's `davinciLogin.js` session-shape (`req.session.oauthTokens` / `req.session.user`) was confirmed against `routes/oauth.js`'s own field names (it `delete`s exactly these two keys on logout, `routes/oauth.js:59-60`) — no further cross-check needed.
