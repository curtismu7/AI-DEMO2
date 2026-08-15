# New Relic Correlation, Named Transactions & Custom Spans — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the existing NR integration with a correlation fabric (AsyncLocalStorage), named APM transactions per use case, and 8 custom waterfall spans for key identity/AI steps.

**Architecture:** Three additive layers on top of the existing `newRelicForwarder` + `appEventService` integration. Layer 1 threads a `correlationId` through every BFF log event and the UI proxy. Layer 2 names APM transactions per use case via Express middleware. Layer 3 wraps 8 specific async call sites in named NR segments.

**Tech Stack:** Node.js `async_hooks` (built-in, no new deps), `newrelic` npm (already installed), CommonJS throughout, Express 4.

## Global Constraints

- CommonJS only — `'use strict'` + `require`, no ESM
- All `newrelic.*` SDK calls wrapped in `try/catch` — must never throw into caller
- No new npm dependencies
- Error responses use `{ error }` shape, never `{ message }`
- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`
- Node >= 22
- No-op contract: every NR call silently skips when `NR_LICENSE_KEY` absent or agent not initialized
- `CI=true` required when running jest
- Never `git add -A` — stage files explicitly

---

### Task 1: Create `nrContext.js` — AsyncLocalStorage correlation fabric

**Files:**
- Create: `demo_api_server/services/nrContext.js`

**Interfaces:**
- Produces: `mintCorrelation(useCaseId, useCaseName)` → `{ correlationId, useCaseId, useCaseName, startedAt }`
- Produces: `run(context, fn)` → return value of `fn()`
- Produces: `get()` → current context object (empty `{}` when outside a `run()`)
- Produces: `getCorrelationId()` → `string | null`

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/nrContext.test.js`:

```js
'use strict';

const nrContext = require('../services/nrContext');

describe('nrContext', () => {
  test('mintCorrelation returns object with UUID correlationId, useCaseId, useCaseName, startedAt', () => {
    const ctx = nrContext.mintCorrelation('UC14', 'UC14-AttackSim');
    expect(typeof ctx.correlationId).toBe('string');
    expect(ctx.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(ctx.useCaseId).toBe('UC14');
    expect(ctx.useCaseName).toBe('UC14-AttackSim');
    expect(typeof ctx.startedAt).toBe('number');
  });

  test('mintCorrelation accepts null args', () => {
    const ctx = nrContext.mintCorrelation(null, null);
    expect(ctx.useCaseId).toBeNull();
    expect(ctx.useCaseName).toBeNull();
  });

  test('getCorrelationId returns null outside run()', () => {
    expect(nrContext.getCorrelationId()).toBeNull();
  });

  test('getCorrelationId returns correct id inside run()', () => {
    const ctx = nrContext.mintCorrelation('UC1', 'UC1-ChipLogin');
    let captured = null;
    nrContext.run(ctx, () => {
      captured = nrContext.getCorrelationId();
    });
    expect(captured).toBe(ctx.correlationId);
  });

  test('get() returns {} outside run()', () => {
    expect(nrContext.get()).toEqual({});
  });

  test('two concurrent run() contexts do not bleed', async () => {
    const ctx1 = nrContext.mintCorrelation('UC1', 'A');
    const ctx2 = nrContext.mintCorrelation('UC2', 'B');
    const results = await Promise.all([
      new Promise((resolve) => nrContext.run(ctx1, () => resolve(nrContext.getCorrelationId()))),
      new Promise((resolve) => nrContext.run(ctx2, () => resolve(nrContext.getCorrelationId()))),
    ]);
    expect(results[0]).toBe(ctx1.correlationId);
    expect(results[1]).toBe(ctx2.correlationId);
    expect(results[0]).not.toBe(results[1]);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd demo_api_server && CI=true npx jest tests/nrContext.test.js --forceExit
```

Expected: `Cannot find module '../services/nrContext'`

- [ ] **Step 3: Implement `nrContext.js`**

Create `demo_api_server/services/nrContext.js`:

```js
'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const _store = new AsyncLocalStorage();

function mintCorrelation(useCaseId, useCaseName) {
  return {
    correlationId: crypto.randomUUID(),
    useCaseId: useCaseId || null,
    useCaseName: useCaseName || null,
    startedAt: Date.now(),
  };
}

function run(context, fn) {
  return _store.run(context, fn);
}

function get() {
  return _store.getStore() || {};
}

function getCorrelationId() {
  return get().correlationId || null;
}

module.exports = { mintCorrelation, run, get, getCorrelationId };
```

- [ ] **Step 4: Run tests — confirm green**

```bash
cd demo_api_server && CI=true npx jest tests/nrContext.test.js --forceExit
```

Expected: 6 tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/nrContext.js demo_api_server/tests/nrContext.test.js
git commit -m "feat(nr): add nrContext AsyncLocalStorage correlation fabric"
```

---

### Task 2: Create `nrSegments.js` — custom span wrappers

**Files:**
- Create: `demo_api_server/services/nrSegments.js`

**Interfaces:**
- Produces: `startSegment(name, fn)` → `Promise<any>` (returns fn result)
- Produces 8 named helpers — each `(fn) => startSegment('<Name>', fn)`:
  - `pingOneAuthenticate`
  - `tokenExchangeSubject`
  - `tokenExchangeActor`
  - `mcpToolCall`
  - `p1azAuthorize`
  - `hitlRequest`
  - `hitlAwait`
  - `attackSimVerdict`

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/nrSegments.test.js`:

```js
'use strict';

jest.mock('newrelic', () => ({
  startSegment: jest.fn((name, record, fn) => fn()),
}), { virtual: true });

const newrelic = require('newrelic');
const nrSegments = require('../services/nrSegments');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('nrSegments.startSegment', () => {
  test('calls newrelic.startSegment with given name', async () => {
    const result = await nrSegments.startSegment('Test/Span', () => 42);
    expect(newrelic.startSegment).toHaveBeenCalledWith('Test/Span', true, expect.any(Function));
    expect(result).toBe(42);
  });

  test('still calls fn and returns result when newrelic throws', async () => {
    newrelic.startSegment.mockImplementationOnce(() => { throw new Error('agent gone'); });
    const result = await nrSegments.startSegment('Test/Span', () => 99);
    expect(result).toBe(99);
  });
});

describe('nrSegments named helpers', () => {
  const HELPERS = [
    ['pingOneAuthenticate',  'PingOne/Authenticate'],
    ['tokenExchangeSubject', 'TokenExchange/SubjectToken'],
    ['tokenExchangeActor',   'TokenExchange/ActorToken'],
    ['mcpToolCall',          'MCP/ToolCall'],
    ['p1azAuthorize',        'P1AZ/Authorize'],
    ['hitlRequest',          'HITL/RequestApproval'],
    ['hitlAwait',            'HITL/AwaitDecision'],
    ['attackSimVerdict',     'AttackSim/Verdict'],
  ];

  test.each(HELPERS)('%s uses segment name "%s"', async (helper, segName) => {
    await nrSegments[helper](() => 'ok');
    expect(newrelic.startSegment).toHaveBeenCalledWith(segName, true, expect.any(Function));
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd demo_api_server && CI=true npx jest tests/nrSegments.test.js --forceExit
```

Expected: `Cannot find module '../services/nrSegments'`

- [ ] **Step 3: Implement `nrSegments.js`**

Create `demo_api_server/services/nrSegments.js`:

```js
'use strict';

async function startSegment(name, fn) {
  try {
    const newrelic = require('newrelic');
    return await newrelic.startSegment(name, true, fn);
  } catch (_) {
    return fn();
  }
}

module.exports = {
  startSegment,
  pingOneAuthenticate:  (fn) => startSegment('PingOne/Authenticate', fn),
  tokenExchangeSubject: (fn) => startSegment('TokenExchange/SubjectToken', fn),
  tokenExchangeActor:   (fn) => startSegment('TokenExchange/ActorToken', fn),
  mcpToolCall:          (fn) => startSegment('MCP/ToolCall', fn),
  p1azAuthorize:        (fn) => startSegment('P1AZ/Authorize', fn),
  hitlRequest:          (fn) => startSegment('HITL/RequestApproval', fn),
  hitlAwait:            (fn) => startSegment('HITL/AwaitDecision', fn),
  attackSimVerdict:     (fn) => startSegment('AttackSim/Verdict', fn),
};
```

- [ ] **Step 4: Run tests — confirm green**

```bash
cd demo_api_server && CI=true npx jest tests/nrSegments.test.js --forceExit
```

Expected: 10 tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/nrSegments.js demo_api_server/tests/nrSegments.test.js
git commit -m "feat(nr): add nrSegments custom span wrappers"
```

---

### Task 3: Create `nrTransactionMiddleware.js` — named APM transactions

**Files:**
- Create: `demo_api_server/middleware/nrTransactionMiddleware.js`

**Interfaces:**
- Consumes: `nrContext.mintCorrelation(useCaseId, useCaseName)` from Task 1
- Consumes: `nrContext.run(ctx, fn)` from Task 1
- Produces: Express middleware `nrTransactionMiddleware(req, res, next)` — sets NR transaction name and seeds AsyncLocalStorage context; calls `next()` inside the `run()` scope so all downstream async work inherits the correlation

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/nrTransactionMiddleware.test.js`:

```js
'use strict';

jest.mock('newrelic', () => ({
  setTransactionName: jest.fn(),
}), { virtual: true });

const newrelic = require('newrelic');
const nrContext = require('../services/nrContext');
const { nrTransactionMiddleware } = require('../middleware/nrTransactionMiddleware');

beforeEach(() => jest.clearAllMocks());

function makeReq(body = {}, query = {}, headers = {}) {
  return { body, query, headers };
}

function runMiddleware(req) {
  return new Promise((resolve, reject) => {
    nrTransactionMiddleware(req, {}, (err) => (err ? reject(err) : resolve()));
  });
}

describe('nrTransactionMiddleware', () => {
  test('sets transaction name for known useCaseId from body', async () => {
    await runMiddleware(makeReq({ useCaseId: 'UC14' }));
    expect(newrelic.setTransactionName).toHaveBeenCalledWith('/BankingDemo/UC14-AttackSim');
  });

  test('sets transaction name for UC1 from body', async () => {
    await runMiddleware(makeReq({ useCaseId: 'UC1' }));
    expect(newrelic.setTransactionName).toHaveBeenCalledWith('/BankingDemo/UC1-ChipLogin');
  });

  test('uses query param when body missing useCaseId', async () => {
    await runMiddleware(makeReq({}, { useCaseId: 'UC17' }));
    expect(newrelic.setTransactionName).toHaveBeenCalledWith('/BankingDemo/UC17-HITL');
  });

  test('uses x-use-case-id header as fallback', async () => {
    await runMiddleware(makeReq({}, {}, { 'x-use-case-id': 'UC2' }));
    expect(newrelic.setTransactionName).toHaveBeenCalledWith('/BankingDemo/UC2-SensitiveTransfer');
  });

  test('falls back to UC-<id> for unknown useCaseId', async () => {
    await runMiddleware(makeReq({ useCaseId: 'UC99' }));
    expect(newrelic.setTransactionName).toHaveBeenCalledWith('/BankingDemo/UC-UC99');
  });

  test('does not call setTransactionName when no useCaseId', async () => {
    await runMiddleware(makeReq());
    expect(newrelic.setTransactionName).not.toHaveBeenCalled();
  });

  test('calls next() even when newrelic throws', async () => {
    newrelic.setTransactionName.mockImplementationOnce(() => { throw new Error('agent gone'); });
    await expect(runMiddleware(makeReq({ useCaseId: 'UC14' }))).resolves.toBeUndefined();
  });

  test('getCorrelationId() is non-null inside the middleware run() scope', async () => {
    let captured = null;
    const req = makeReq({ useCaseId: 'UC14' });
    await new Promise((resolve) => {
      const next = () => {
        captured = nrContext.getCorrelationId();
        resolve();
      };
      nrTransactionMiddleware(req, {}, next);
    });
    expect(captured).not.toBeNull();
    expect(typeof captured).toBe('string');
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd demo_api_server && CI=true npx jest tests/nrTransactionMiddleware.test.js --forceExit
```

Expected: `Cannot find module '../middleware/nrTransactionMiddleware'`

- [ ] **Step 3: Implement `nrTransactionMiddleware.js`**

Create `demo_api_server/middleware/nrTransactionMiddleware.js`:

```js
'use strict';
const nrContext = require('../services/nrContext');

const UC_NAMES = {
  UC1:  'UC1-ChipLogin',
  UC2:  'UC2-SensitiveTransfer',
  UC14: 'UC14-AttackSim',
  UC16: 'UC16-Impersonation',
  UC17: 'UC17-HITL',
  UC22: 'UC22-CIBA',
};

function nrTransactionMiddleware(req, res, next) {
  const useCaseId =
    req.body?.useCaseId ||
    req.query?.useCaseId ||
    req.headers?.['x-use-case-id'] ||
    null;
  const useCaseName = UC_NAMES[useCaseId] || (useCaseId ? `UC-${useCaseId}` : null);
  const ctx = nrContext.mintCorrelation(useCaseId, useCaseName);

  try {
    const newrelic = require('newrelic');
    if (useCaseId) {
      newrelic.setTransactionName(`/BankingDemo/${useCaseName}`);
    }
  } catch (_) {}

  nrContext.run(ctx, () => next());
}

module.exports = { nrTransactionMiddleware };
```

- [ ] **Step 4: Run tests — confirm green**

```bash
cd demo_api_server && CI=true npx jest tests/nrTransactionMiddleware.test.js --forceExit
```

Expected: 8 tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/middleware/nrTransactionMiddleware.js \
        demo_api_server/tests/nrTransactionMiddleware.test.js
git commit -m "feat(nr): add nrTransactionMiddleware — named APM transactions per use case"
```

---

### Task 4: Wire middleware into `server.js` + inject correlationId into `newRelicForwarder.js`

**Files:**
- Modify: `demo_api_server/server.js`
- Modify: `demo_api_server/services/newRelicForwarder.js`

**Interfaces:**
- Consumes: `nrTransactionMiddleware` from Task 3
- Consumes: `nrContext.get()` from Task 1

- [ ] **Step 1: Mount middleware in the two agent route files**

The routes live in two files:
- `demo_api_server/routes/agentRun.js` — line 178: `router.post('/run', async (req, res) => {`
- `demo_api_server/routes/agentInvokeRoute.js` — line 125: `router.post('/agent/invoke', authenticateToken, agentSessionMiddleware, express.json(), async (req, res) => {`

In **`agentRun.js`**, add require near the top:
```js
const { nrTransactionMiddleware } = require('../middleware/nrTransactionMiddleware');
```

Change line 178 from:
```js
router.post('/run', async (req, res) => {
```
To:
```js
router.post('/run', nrTransactionMiddleware, async (req, res) => {
```

In **`agentInvokeRoute.js`**, add require near the top:
```js
const { nrTransactionMiddleware } = require('../middleware/nrTransactionMiddleware');
```

Change line 125 from:
```js
router.post('/agent/invoke', authenticateToken, agentSessionMiddleware, express.json(), async (req, res) => {
```
To:
```js
router.post('/agent/invoke', authenticateToken, agentSessionMiddleware, express.json(), nrTransactionMiddleware, async (req, res) => {
```

- [ ] **Step 2: Inject correlationId into `newRelicForwarder.js`**

In `demo_api_server/services/newRelicForwarder.js`, add `nrContext` require at the top (after `'use strict'`):

```js
const { get: getNrCtx } = require('./nrContext');
```

Replace the existing `_post` call in `forwardAppEvent` to merge correlationId from context. The current `forwardAppEvent` (lines 53–84) sends `event.correlationId` from the event object. Enrich it so the context `correlationId` fills in when the event lacks one:

Change the `logs[0].attributes` block inside `forwardAppEvent` from:
```js
attributes: {
  id: event.id,
  category: event.category,
  severity: event.severity,
  tag: event.tag,
  useCaseId: event.useCaseId,
  correlationId: event.correlationId,
  requestId: event.requestId,
  sessionId: event.sessionId,
  username: event.username,
  ...(event.metadata || {}),
},
```

To:
```js
attributes: {
  id: event.id,
  category: event.category,
  severity: event.severity,
  tag: event.tag,
  useCaseId: event.useCaseId || getNrCtx().useCaseId || undefined,
  correlationId: event.correlationId || getNrCtx().correlationId || undefined,
  requestId: event.requestId,
  sessionId: event.sessionId,
  username: event.username,
  ...(event.metadata || {}),
},
```

Also enrich `common.attributes` in `forwardAppEvent` with context values:
```js
common: {
  attributes: {
    source: 'ai-demo-bff',
    logtype: 'app_event',
    category: event.category,
    severity: event.severity,
    ...(getNrCtx().correlationId ? { correlationId: getNrCtx().correlationId } : {}),
    ...(getNrCtx().useCaseId ? { useCaseId: getNrCtx().useCaseId } : {}),
    ...(getNrCtx().useCaseName ? { useCaseName: getNrCtx().useCaseName } : {}),
  },
},
```

- [ ] **Step 3: Run unit tests to confirm nothing broke**

```bash
cd demo_api_server && CI=true npm run test:unit -- --forceExit
```

Expected: same pass/fail count as before this task. If a test fails due to missing `nrContext` mock, add `jest.mock('../services/nrContext', () => ({ get: () => ({}) }))` to that test file.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/server.js demo_api_server/services/newRelicForwarder.js
# Also add any route file touched
git commit -m "feat(nr): wire nrTransactionMiddleware + correlationId into newRelicForwarder"
```

---

### Task 5: Wire `nrSegments` at the 8 call sites

**Files:**
- Modify: `demo_api_server/services/oauthUserService.js` (line ~156 — PingOne auth POST)
- Modify: `demo_api_server/services/oauthService.js` (line ~326 — subject exchange; line ~441 — actor exchange)
- Modify: `demo_api_server/services/mcpGatewayClient.js` (line ~321 — MCP tool call)
- Modify: `demo_api_server/services/pingOneAuthorizeService.js` (line ~341 — P1AZ decision POST)
- Modify: `demo_api_server/services/hitlServiceClient.js` (line ~37 — createChallenge; line ~55 — getChallengeStatus)
- Modify: `demo_api_server/services/attackSimulatorService.js` (line ~582 — runAttackSim)

**Interfaces:**
- Consumes: all 8 named helpers from `nrSegments` (Task 2)

**Wrap pattern — add the require once per file, then wrap each target call:**

```js
const nrSegments = require('./nrSegments');
// or from routes/middleware:
const nrSegments = require('../services/nrSegments');
```

Wrap pattern:
```js
// Before:
const result = await axios.post(endpoint, body, opts);

// After:
const result = await nrSegments.pingOneAuthenticate(() =>
  axios.post(endpoint, body, opts)
);
```

- [ ] **Step 1: Wrap PingOne authenticate — `oauthUserService.js` ~line 156**

Open `demo_api_server/services/oauthUserService.js`. Find the `axios.post` for `grant_type=authorization_code`. Wrap it with `nrSegments.pingOneAuthenticate`.

- [ ] **Step 2: Wrap subject token exchange — `oauthService.js` ~line 326**

Open `demo_api_server/services/oauthService.js`. Find `performTokenExchange()`. The `axios.post` with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` (subject-only, no actor). Wrap with `nrSegments.tokenExchangeSubject`.

- [ ] **Step 3: Wrap actor token exchange — `oauthService.js` ~line 441**

In same file, find `performTokenExchangeWithActor()`. Wrap its `axios.post` with `nrSegments.tokenExchangeActor`.

- [ ] **Step 4: Wrap MCP tool call — `mcpGatewayClient.js` ~line 321**

Open `demo_api_server/services/mcpGatewayClient.js`. Find `callToolViaGateway()`. Wrap the `axios.post` with `nrSegments.mcpToolCall`.

- [ ] **Step 5: Wrap P1AZ authorize — `pingOneAuthorizeService.js` ~line 341**

Open `demo_api_server/services/pingOneAuthorizeService.js`. Find the `fetchRetryable` call (or equivalent) that POSTs to `/decisionEndpoints/`. Wrap with `nrSegments.p1azAuthorize`.

Note: `fetchRetryable` may be a wrapper around `fetch` or `axios`. Wrap the outermost call that represents a single decision request, not an inner retry loop. Confirm by reading ~line 341 context.

- [ ] **Step 6: Wrap HITL request — `hitlServiceClient.js` ~line 37**

Open `demo_api_server/services/hitlServiceClient.js`. Find `createChallenge()`. Wrap its `_fetchJson(...)` call with `nrSegments.hitlRequest`.

- [ ] **Step 7: Wrap HITL await — `hitlServiceClient.js` ~line 55**

In same file, find `getChallengeStatus()`. Wrap its `_fetchJson(...)` call with `nrSegments.hitlAwait`.

- [ ] **Step 8: Wrap attack sim verdict — `attackSimulatorService.js` ~line 582**

Open `demo_api_server/services/attackSimulatorService.js`. Find `runAttackSim()`. Wrap the entire function body's primary dispatch (the call that fans out to the individual sim functions) with `nrSegments.attackSimVerdict`. Alternatively, wrap the outermost await inside `runAttackSim` that represents the verdict computation.

Example pattern if `runAttackSim` calls an inner function:
```js
async function runAttackSim(sim, req, attackAmount) {
  return nrSegments.attackSimVerdict(() => _runAttackSimInner(sim, req, attackAmount));
}
```

If the logic is inline (not extracted), wrap the main block:
```js
async function runAttackSim(sim, req, attackAmount) {
  return nrSegments.attackSimVerdict(async () => {
    // existing body
  });
}
```

- [ ] **Step 9: Run unit tests**

```bash
cd demo_api_server && CI=true npm run test:unit -- --forceExit
```

Expected: no new failures. The wraps are transparent — all existing tests should still pass.

- [ ] **Step 10: Commit**

```bash
git add demo_api_server/services/oauthUserService.js \
        demo_api_server/services/oauthService.js \
        demo_api_server/services/mcpGatewayClient.js \
        demo_api_server/services/pingOneAuthorizeService.js \
        demo_api_server/services/hitlServiceClient.js \
        demo_api_server/services/attackSimulatorService.js
git commit -m "feat(nr): wrap 8 identity call sites with named NR segments"
```

---

### Task 6: Add `correlationId` threading to UI — `nrLog.js`

**Files:**
- Modify: `demo_api_ui/src/utils/nrLog.js`

**Interfaces:**
- Consumes: `window.__nrCorrelationId` (set by BFF response header or NR SDK in later enhancements)

- [ ] **Step 1: Write failing test**

Create `demo_api_ui/src/utils/__tests__/nrLog.test.js`:

```js
import { nrLog } from '../nrLog';

describe('nrLog', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
    delete window.__nrCorrelationId;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('posts message and attributes to /api/nr-log', async () => {
    nrLog('test.event', { foo: 'bar' });
    await Promise.resolve(); // flush micro-task
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/nr-log',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.message).toBe('test.event');
    expect(body.attributes.foo).toBe('bar');
  });

  test('includes correlationId from attributes when provided', async () => {
    nrLog('test.event', { correlationId: 'abc-123' });
    await Promise.resolve();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.attributes.correlationId).toBe('abc-123');
  });

  test('includes correlationId from window.__nrCorrelationId when not in attributes', async () => {
    window.__nrCorrelationId = 'window-id-999';
    nrLog('test.event', {});
    await Promise.resolve();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.attributes.correlationId).toBe('window-id-999');
  });

  test('attribute correlationId takes precedence over window', async () => {
    window.__nrCorrelationId = 'window-id-999';
    nrLog('test.event', { correlationId: 'attr-id-111' });
    await Promise.resolve();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.attributes.correlationId).toBe('attr-id-111');
  });

  test('never throws when fetch rejects', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));
    expect(() => nrLog('test.event')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // no unhandled rejection
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
cd demo_api_ui && npx vitest run src/utils/__tests__/nrLog.test.js
```

Expected: test for `window.__nrCorrelationId` fails (not yet implemented).

- [ ] **Step 3: Update `nrLog.js`**

Replace `demo_api_ui/src/utils/nrLog.js` with:

```js
export function nrLog(message, attributes = {}) {
  const correlationId =
    attributes.correlationId ||
    (typeof window !== 'undefined' ? window.__nrCorrelationId : null) ||
    null;
  fetch('/api/nr-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      message,
      attributes: {
        ...attributes,
        ...(correlationId ? { correlationId } : {}),
      },
    }),
  }).catch(() => {});
}
```

- [ ] **Step 4: Run tests — confirm green**

```bash
cd demo_api_ui && npx vitest run src/utils/__tests__/nrLog.test.js
```

Expected: 5 tests pass.

- [ ] **Step 5: Run full UI unit suite to confirm no regressions**

```bash
cd demo_api_ui && npm run test:unit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/utils/nrLog.js \
        demo_api_ui/src/utils/__tests__/nrLog.test.js
git commit -m "feat(nr): thread correlationId through nrLog via window.__nrCorrelationId"
```

---

### Task 7: Run full test suite + topology verify + final checks

- [ ] **Step 1: Run full BFF test suite**

```bash
cd demo_api_server && CI=true npm test -- --forceExit
```

Expected: same pass count as before this feature (pre-existing 13 live-LLM failures are known — exclude them from the count). Zero new failures.

- [ ] **Step 2: Run topology verify**

```bash
npm run topology:verify
```

Expected: no drift errors.

- [ ] **Step 3: Run UI build to confirm no import errors**

```bash
cd demo_api_ui && npm run build
```

Expected: exits 0.

- [ ] **Step 4: Commit evidence summary**

Include the test result line in the commit message:

```bash
git commit --allow-empty -m "chore(nr): verification pass — all suites green, topology clean"
```

(Only use `--allow-empty` if no files changed in this step; otherwise stage and commit the actual results.)
