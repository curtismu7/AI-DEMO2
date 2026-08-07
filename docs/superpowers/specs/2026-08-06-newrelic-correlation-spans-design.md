# New Relic — Correlation, Named Transactions & Custom Spans Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich the existing NR integration with a correlation fabric, named APM transactions per use case, and custom waterfall spans for 8 key identity/AI steps — turning NR into a live demo surface that shows the full auth+AI+security chain as a production trace.

**Architecture:** Three additive layers on top of the existing `newRelicForwarder` + `appEventService` integration. All layers degrade gracefully when `NR_LICENSE_KEY` is absent. No existing callers change signatures.

**Tech Stack:** Node.js `AsyncLocalStorage` (built-in), `newrelic` npm (already installed), CommonJS throughout.

---

## Global Constraints

- CommonJS only — `'use strict'` + `require`, no ESM
- All `newrelic.*` SDK calls wrapped in `try/catch` — must never throw into caller
- No new npm dependencies
- Error responses use `{ error }` shape, never `{ message }`
- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`
- Node >= 22
- No-op contract: every NR call is a no-op when `NR_LICENSE_KEY` is absent or agent not initialized

---

## Layer 1 — Correlation Fabric

### Files
- **Create:** `demo_api_server/services/nrContext.js`
- **Modify:** `demo_api_server/services/newRelicForwarder.js`
- **Modify:** `demo_api_server/services/appEventService.js`
- **Modify:** `demo_api_ui/src/utils/nrLog.js`

### nrContext.js

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

### newRelicForwarder.js changes

Every `_post` call injects `correlationId` from `nrContext.get()` into `common.attributes`:

```js
const { get: getNrCtx } = require('./nrContext');

function _commonAttributes(source, logtype, extra = {}) {
  const ctx = getNrCtx();
  return {
    source,
    logtype,
    ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {}),
    ...(ctx.useCaseId ? { useCaseId: ctx.useCaseId } : {}),
    ...(ctx.useCaseName ? { useCaseName: ctx.useCaseName } : {}),
    ...extra,
  };
}
```

### appEventService.js change

Inject `correlationId` from `nrContext` when not already set by caller:

```js
const nrContext = require('./nrContext');
// inside logEvent, after building event object:
if (!event.correlationId) {
  event.correlationId = nrContext.getCorrelationId();
}
```

### nrLog.js (UI) change

Accept `correlationId` from attributes or `window.__nrCorrelationId`:

```js
export function nrLog(message, attributes = {}) {
  const correlationId = attributes.correlationId
    || window.__nrCorrelationId
    || null;
  fetch('/api/nr-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      message,
      attributes: { ...attributes, ...(correlationId ? { correlationId } : {}) },
    }),
  }).catch(() => {});
}
```

---

## Layer 2 — Named Transactions

### Files
- **Create:** `demo_api_server/middleware/nrTransactionMiddleware.js`
- **Modify:** `demo_api_server/server.js` (mount before `/api/agent/run` and `/api/agent/invoke`)

### nrTransactionMiddleware.js

```js
'use strict';
const nrContext = require('../services/nrContext');

const UC_NAMES = {
  'UC1':  'UC1-ChipLogin',
  'UC2':  'UC2-SensitiveTransfer',
  'UC14': 'UC14-AttackSim',
  'UC16': 'UC16-Impersonation',
  'UC17': 'UC17-HITL',
  'UC22': 'UC22-CIBA',
};

function nrTransactionMiddleware(req, res, next) {
  const useCaseId = req.body?.useCaseId
    || req.query?.useCaseId
    || req.headers?.['x-use-case-id']
    || null;
  const useCaseName = UC_NAMES[useCaseId] || (useCaseId ? `UC-${useCaseId}` : 'Unknown');
  const ctx = nrContext.mintCorrelation(useCaseId, useCaseName);

  try {
    const newrelic = require('newrelic');
    if (useCaseId) {
      newrelic.setTransactionName(`/BankingDemo/${useCaseName}`);
    }
  } catch (_) { /* no-op when agent not initialized */ }

  nrContext.run(ctx, () => next());
}

module.exports = { nrTransactionMiddleware };
```

Mount in `server.js`:
```js
const { nrTransactionMiddleware } = require('./middleware/nrTransactionMiddleware');
app.use(['/api/agent/run', '/api/agent/invoke'], express.json(), nrTransactionMiddleware);
```

---

## Layer 3 — Custom Spans

### Files
- **Create:** `demo_api_server/services/nrSegments.js`
- **Modify:** 8 BFF call sites (see table below)

### nrSegments.js

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
  pingOneAuthenticate:   (fn) => startSegment('PingOne/Authenticate', fn),
  tokenExchangeSubject:  (fn) => startSegment('TokenExchange/SubjectToken', fn),
  tokenExchangeActor:    (fn) => startSegment('TokenExchange/ActorToken', fn),
  mcpToolCall:           (fn) => startSegment('MCP/ToolCall', fn),
  p1azAuthorize:         (fn) => startSegment('P1AZ/Authorize', fn),
  hitlRequest:           (fn) => startSegment('HITL/RequestApproval', fn),
  hitlAwait:             (fn) => startSegment('HITL/AwaitDecision', fn),
  attackSimVerdict:      (fn) => startSegment('AttackSim/Verdict', fn),
};
```

### Wrap sites

| Segment | Approximate file | What to wrap |
|---|---|---|
| `PingOne/Authenticate` | `services/pingOneAuth.js` or `routes/auth*.js` | PingOne token request |
| `TokenExchange/SubjectToken` | `services/tokenExchange*.js` | First exchange POST |
| `TokenExchange/ActorToken` | `services/tokenExchange*.js` | Second exchange POST |
| `MCP/ToolCall` | `routes/mcp*.js` | MCP tool dispatch |
| `P1AZ/Authorize` | `services/p1az*.js` | P1AZ decision POST |
| `HITL/RequestApproval` | `services/hitl*.js` | HITL notification send |
| `HITL/AwaitDecision` | `services/hitl*.js` | HITL poll/await |
| `AttackSim/Verdict` | `routes/attackSim*.js` | Attack verdict evaluation |

Exact paths confirmed at implementation time. Wrap pattern:

```js
const nrSegments = require('../services/nrSegments');

// Before:
const result = await pingOneClient.authenticate(params);

// After:
const result = await nrSegments.pingOneAuthenticate(() =>
  pingOneClient.authenticate(params)
);
```

---

## Data Flow

```
UC chip dispatch → POST /api/agent/invoke
  nrTransactionMiddleware:
    mintCorrelation() → AsyncLocalStorage
    setTransactionName('/BankingDemo/UC14-AttackSim')

  nrSegments.pingOneAuthenticate(() => ...) → NR span
  nrSegments.tokenExchangeSubject(() => ...)→ NR span
  nrSegments.p1azAuthorize(() => ...)       → NR span
  ... (8 spans total)

  appEventService.logEvent → injects correlationId → forwardAppEvent → NR Logs

UI:
  nrLog('ui.agent_message', { correlationId }) → /api/nr-log → NR Logs
```

**NRQL to replay a full run:**
```sql
FROM Log SELECT timestamp, message, category
WHERE correlationId = '<id>'
ORDER BY timestamp ASC
```

---

## Error Handling

- All `require('newrelic')` calls in `try/catch` — agent absent = silent no-op
- `startSegment` try/finally — `fn()` always runs even if NR SDK throws
- `AsyncLocalStorage` missing context returns `{}` — `correlationId` silently omitted
- Middleware calls `next()` inside `nrContext.run()` — Express error handler fires correctly on handler throws

---

## Testing

**Unit — nrContext.js:**
- `mintCorrelation()` returns object with UUID `correlationId`, `useCaseId`, `useCaseName`, `startedAt`
- `getCorrelationId()` returns `null` outside a `run()` context
- `getCorrelationId()` returns correct id inside a `run()` context
- Two concurrent `run()` contexts don't bleed (AsyncLocalStorage isolation)

**Unit — nrSegments.js:**
- `startSegment` with mocked `newrelic` calls `newrelic.startSegment` with correct name
- `startSegment` still calls `fn()` and returns result when `require('newrelic')` throws
- Named helper `pingOneAuthenticate` uses segment name `'PingOne/Authenticate'`

**Unit — nrTransactionMiddleware.js:**
- `newrelic.setTransactionName` called with `/BankingDemo/UC14-AttackSim` for `useCaseId=UC14`
- Calls `next()` even when `newrelic` throws
- `nrContext.getCorrelationId()` non-null inside middleware's `run()` scope

**Unit — newRelicForwarder.js:**
- `forwardAppEvent` payload includes `correlationId` when context active
- `forwardAppEvent` omits `correlationId` when context empty

**Regression:** all existing webhookPingOne, pingoneEventStore, appEventService tests pass unchanged.

---

## Success Criteria

1. Run UC14 → NR APM shows transaction `BankingDemo/UC14-AttackSim` with 8 named waterfall segments
2. NRQL `FROM Log WHERE correlationId = '<id>'` returns BFF + UI events for that run in order
3. BFF starts cleanly with `NR_LICENSE_KEY` absent — zero errors, zero NR calls fire
4. Full BFF test suite green (13 pre-existing live-LLM failures excluded)
