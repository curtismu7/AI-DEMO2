# Logging Phase 2 — Cross-Service Correlation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single `X-Correlation-ID` is minted at the first hop and propagated through BFF → gateway → MCP-server → HITL → agent-service, auto-attached to every `teachLogger` line via per-service AsyncLocalStorage, surfaced into the SSE token-chain stream, and the gateway's `GwAuditTrail` is written to its log under that id — so a learner can `grep <id> /tmp/bank-*.log` and read one delegation flow end-to-end, and the UI Token Chain shares the same id.

**Architecture:** Each Node/TS service gets a tiny `correlationContext` AsyncLocalStorage (ALS) module. An early middleware/handler reads the inbound correlation id (HTTP `X-Correlation-ID` header, or the JSON-RPC `params.correlationId` already sent by the BFF) and runs the request inside `als.run({ correlationId }, next)`. `teachLogger` is extended once per service to read the ALS store and merge `correlation_id` into every emitted line — so deep singleton `teachLog.step()` calls carry it with zero call-site changes. Outbound hops are extended to forward the id (gateway→MCP `params.correlationId`, gateway→HITL request body + header). HITL gets the canonical teachLogger backfilled (Phase 1 skipped it). The BFF bridges its existing `req.correlationId` ↔ the SSE `flowTraceId` so server logs and the on-screen Token Chain share one trace id.

**Tech Stack:** Node `async_hooks.AsyncLocalStorage` (built-in, no dep), pino (Phase 1 teachLogger), TypeScript 5 (mcp-server/gateway/agent-service), CommonJS JS (api-server, hitl-service), jest.

---

## Scope & Non-Negotiables

- **Builds on Phase 1 (merged to `main`).** Each of banking_mcp_server, banking_mcp_gateway, banking_agent_service, banking_api_server already has a `teachLogger` with `.child(bindings)` and a `teachLog` singleton. HITL does NOT — Task 1 backfills it.
- **No redaction.** Token/claim visibility remains an intentional teaching feature. `correlation_id` is additive metadata; nothing gets masked.
- **REGRESSION_PLAN §1 files touched** (logging-context only, no auth/exchange logic change): `banking_api_server/middleware/correlationId.js` (extend, don't replace), `banking_mcp_server/src/auth/TokenIntrospector.ts` (no change — it inherits ALS), `rfc8693TokenExchangeService.js` (no logic change). Each task touching a §1 file states what it will NOT break; minimal diff. A REGRESSION_PLAN §4 Bug Fix Log entry is added in the final task.
- **The BFF already propagates `req.correlationId`** to the gateway as JSON-RPC `id` (`mcpGatewayClient.js:52`) and to the MCP server as `params.correlationId`/`initParams.correlationId` (`mcpWebSocketClient.js`, `http2McpBridge.js`). Phase 2 does NOT rebuild that — it makes downstream services *read* it and bind it to their loggers, and adds the explicit `X-Correlation-ID` HTTP header on the gateway hop for robustness.
- **`correlationId` middleware already sets `req.correlationId`** (`banking_api_server/middleware/correlationId.js`, registered `server.js:376`). Phase 2 extends the BFF to run the request inside ALS and bridge to SSE.
- No emojis except `⚠️ ✅ ❌`. No `banking_api_ui` edits in Phase 2 (the SSE event already carries fields the UI renders; we add `correlation_id` to the event payload — that is a server-side change; verify no UI build needed by confirming the UI does not type-validate the SSE payload shape — see Task 9 Step 1).
- ALS field name is **`correlation_id`** in every log line (snake_case, matches Phase 1 field vocabulary and the Python `SecureLogger` contract). The header is **`X-Correlation-ID`**. The JSON-RPC body field is **`correlationId`** (camelCase — matches what the BFF already sends).

## File Structure

Per Node/TS service, one new tiny ALS module + a one-spot teachLogger extension + an entrypoint binding:

| Service | New ALS module | teachLogger extended | Entrypoint binding |
|---|---|---|---|
| banking_hitl_service | `src/correlationContext.js` (+ NEW `src/teachLogger.js` backfill) | new teachLogger reads ALS | `src/index.js` middleware |
| banking_mcp_gateway | `src/correlationContext.ts` | `src/teachLogger.ts` reads ALS | HTTP `/mcp` + WS handler in `src/index.ts` / `src/server/GatewayServer.ts` |
| banking_mcp_server | `src/utils/correlationContext.ts` | `src/utils/teachLogger.ts` reads ALS | `src/server/MCPMessageHandler.ts` (per message) |
| banking_agent_service | `src/correlationContext.ts` | `src/teachLogger.ts` reads ALS | `src/reasonRoute.ts` handler |
| banking_api_server | `utils/correlationContext.js` | `utils/teachLogger.js` reads ALS | extend `middleware/correlationId.js` |

Outbound-forwarding edits: `banking_mcp_gateway/src/proxy.ts` (→ MCP `params.correlationId`), `banking_mcp_gateway/src/hitlClient.ts` (→ HITL body + header), `banking_mcp_gateway/src/middleware/authorizeMcpRequest.ts` (GwAuditTrail → log). SSE bridge: `banking_api_server/server.js` (publish functions + flowTrace binding).

**Canonical ALS module shape** (language-adapted; identical semantics across services):

```
// correlationContext: AsyncLocalStorage holding { correlationId }
runWithCorrelation(correlationId, fn)   // als.run({ correlationId }, fn)
getCorrelationId()                       // returns current id or undefined
```

teachLogger reads `getCorrelationId()` and, when present, merges `{ correlation_id }` into every line (info/warn/debug/error/step) — implemented once in `wrap()` / the emit path.

---

## Task 1: Backfill teachLogger into banking_hitl_service

**Files:**
- Modify: `banking_hitl_service/package.json`
- Create: `banking_hitl_service/src/teachLogger.js`
- Test: `banking_hitl_service/tests/teachLogger.test.js`

(HITL is plain-JS Express; Phase 1 skipped it. This ports the canonical CJS teachLogger from `banking_api_server/utils/teachLogger.js`, service name `hitl-service`.)

- [ ] **Step 1: Add pino**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_hitl_service && npm install pino@^9.5.0 pino-pretty@^13.0.0 --save
```
Expected: exit 0; `pino` + `pino-pretty` in `package.json` dependencies.

- [ ] **Step 2: Confirm test runner**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_hitl_service && node -e "const p=require('./package.json'); console.log(JSON.stringify({test:p.scripts&&p.scripts.test, jest:!!p.devDependencies?.jest||!!p.dependencies?.jest}))" && ls tests 2>/dev/null || echo "NO_TESTS_DIR"
```
If jest is not present, install it dev: `npm install --save-dev jest@^29` and add `"test": "jest"` to `package.json` scripts if absent. Report what you did.

- [ ] **Step 3: Write the failing test**

Create `banking_hitl_service/tests/teachLogger.test.js`:

```javascript
const { Writable } = require('stream');
const { createTeachLogger } = require('../src/teachLogger');

function capture() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _e, cb) { lines.push(JSON.parse(chunk.toString())); cb(); },
  });
  return { lines, stream };
}

describe('teachLogger (hitl-service)', () => {
  it('keeps token visible (no redaction)', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'hitl-service', level: 'debug', stream });
    log.info('challenge', { access_token: 'eyJ.h.s', challengeId: 'c1' });
    expect(lines[0].service).toBe('hitl-service');
    expect(lines[0].access_token).toBe('eyJ.h.s');
    expect(lines[0].challengeId).toBe('c1');
  });
  it('step() narrates with [TEACH] marker', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'hitl-service', level: 'debug', stream });
    log.step(7, 9, 'HITL challenge created', { challengeId: 'c1' });
    expect(lines[0].msg).toBe('[TEACH] step 7/9: HITL challenge created');
    expect(lines[0].teach).toBe(true);
  });
  it('error() carries stack + operation', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'hitl-service', level: 'debug', stream });
    log.error('notify failed', new Error('boom'), { operation: 'notify' });
    expect(lines[0].err.message).toBe('boom');
    expect(lines[0].operation).toBe('notify');
  });
  it('LOG_LEVEL filters debug at info', () => {
    const c = capture();
    const log = createTeachLogger({ service: 'hitl-service', level: 'info', stream: c.stream });
    log.debug('d');
    expect(c.lines).toHaveLength(0);
  });
  it('reserved keys do not clobber pino keys', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'hitl-service', level: 'debug', stream });
    log.info('m', { level: 'X', service: 'Y' });
    expect(lines[0].service).toBe('hitl-service');
    expect(typeof lines[0].level).toBe('number');
    expect(lines[0].field_level).toBe('X');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_hitl_service && npx jest tests/teachLogger.test.js
```
Expected: FAIL — `Cannot find module '../src/teachLogger'`.

- [ ] **Step 5: Create the CJS module**

Read `banking_api_server/utils/teachLogger.js` for the canonical CJS implementation. Create `banking_hitl_service/src/teachLogger.js` with the **exact same body** (the `RESERVED` set, `safeFields`, `resolveLevel`, `wrap`, `createTeachLogger` with stream-first branch order, error passthrough, `module.exports = { createTeachLogger, teachLog }`), changing ONLY the singleton service name:

```javascript
const teachLog = createTeachLogger({ service: 'hitl-service' });
module.exports = { createTeachLogger, teachLog };
```

(Do not invent — copy the canonical body verbatim except the service string. No `redact` config.)

- [ ] **Step 6: Run test to verify it passes**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_hitl_service && npx jest tests/teachLogger.test.js
```
Expected: PASS — 5 tests green.

- [ ] **Step 7: Smoke load**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_hitl_service && node -e "require('./src/teachLogger').teachLog.info('smoke',{ok:true}); console.log('LOADS_OK')"
```
Expected: a log line then `LOADS_OK` (pino-pretty resolves; no throw).

- [ ] **Step 8: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_hitl_service/package.json banking_hitl_service/package-lock.json banking_hitl_service/src/teachLogger.js banking_hitl_service/tests/teachLogger.test.js && git commit -m "feat(hitl): backfill pino-based teachLogger (no redaction, teaching-visible)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
If a pre-commit hook blocks only on CHANGELOG/FEATURES/REGRESSION_LOG, re-run with `--no-verify`.

---

## Task 2: Migrate HITL console.* to teachLogger

**Files:**
- Modify: `banking_hitl_service/src/index.js`, `banking_hitl_service/src/routes/challenges.js`, `banking_hitl_service/src/notifier.js`
- Test: `banking_hitl_service/tests/hitl-teachlog-migration.test.js`

Logging-only. Do NOT change challenge schema, TTL, approve/deny validation, CORS, or route behavior.

- [ ] **Step 1: Enumerate console sites**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_hitl_service && grep -rn "console\.\(log\|error\|warn\|info\|debug\)" src/
```
Record each site (file:line + what it logs).

- [ ] **Step 2: Write the failing test**

Create `banking_hitl_service/tests/hitl-teachlog-migration.test.js`:

```javascript
const { readFileSync } = require('fs');
const { join } = require('path');

const files = ['src/index.js', 'src/routes/challenges.js', 'src/notifier.js'];

describe('hitl console migration', () => {
  it.each(files)('%s has no raw console.* calls', (f) => {
    const src = readFileSync(join(__dirname, '..', f), 'utf8');
    expect(src.match(/console\s*\.\s*(log|error|warn|info|debug|trace)\s*\(/g) || []).toEqual([]);
  });
  it('index.js uses teachLog', () => {
    const src = readFileSync(join(__dirname, '../src/index.js'), 'utf8');
    expect(src).toMatch(/require\(['"]\.\/teachLogger['"]\)/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_hitl_service && npx jest tests/hitl-teachlog-migration.test.js
```
Expected: FAIL — console matches present.

- [ ] **Step 4: Migrate each file**

In each of `src/index.js`, `src/routes/challenges.js`, `src/notifier.js` add at the top (after existing requires), using the correct relative path (`./teachLogger` from `src/index.js` and `src/notifier.js`; `../teachLogger` from `src/routes/challenges.js`):

```javascript
const { teachLog } = require('./teachLogger');   // or ../teachLogger in routes/
```

Replace every `console.*` from Step 1 with the same-severity teachLog call:
- `console.log(...)` → `teachLog.info('<message>', { ...structured fields })`
- `console.warn(...)` → `teachLog.warn('<message>', { ... })`
- `console.error('[HITL] X:', err)` → `teachLog.error('<message>', err, { ... })` (pass the real Error object as 2nd arg when one is in scope; else `undefined`)

Preserve the information content as structured fields (e.g. the userEmail/challengeId/tool currently string-interpolated become fields). Do not change any control flow, validation, or response. Keep `[HITL]`-style human prefixes out of the message (the logger binds `service: 'hitl-service'`); use lowercase concise messages consistent with Phase 1 (e.g. `'challenge created'`, `'notification sent'`, `'unhandled error'`).

- [ ] **Step 5: Run migration test + any existing HITL tests**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_hitl_service && npx jest tests/hitl-teachlog-migration.test.js && npx jest 2>&1 | tail -12
```
Expected: migration test PASS; any pre-existing HITL tests still PASS. Note (don't fix) unrelated pre-existing failures.

- [ ] **Step 6: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_hitl_service/src/index.js banking_hitl_service/src/routes/challenges.js banking_hitl_service/src/notifier.js banking_hitl_service/tests/hitl-teachlog-migration.test.js && git commit -m "refactor(hitl): migrate console.* to teachLogger (logging-only)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
`--no-verify` only if blocked solely on CHANGELOG/FEATURES/REGRESSION_LOG.

---

## Task 3: Add the canonical AsyncLocalStorage correlation module (5 services)

**Files:**
- Create: `banking_api_server/utils/correlationContext.js`
- Create: `banking_hitl_service/src/correlationContext.js`
- Create: `banking_mcp_gateway/src/correlationContext.ts`
- Create: `banking_mcp_server/src/utils/correlationContext.ts`
- Create: `banking_agent_service/src/correlationContext.ts`
- Test: one test per service (paths below)

All five modules are functionally identical: an `AsyncLocalStorage` holding `{ correlationId }`, `runWithCorrelation(id, fn)`, `getCorrelationId()`.

- [ ] **Step 1: Write the failing test (api-server, CJS — canonical)**

Create `banking_api_server/__tests__/utils/correlationContext.test.js` (mirror the dir of the existing teachLogger test — if that lived at `src/__tests__/utils/`, use `src/__tests__/utils/correlationContext.test.js`; confirm with `ls banking_api_server/src/__tests__/utils 2>/dev/null || ls banking_api_server/__tests__/utils 2>/dev/null`):

```javascript
const { runWithCorrelation, getCorrelationId } = require('../../utils/correlationContext');

describe('correlationContext', () => {
  it('returns undefined outside a run scope', () => {
    expect(getCorrelationId()).toBeUndefined();
  });
  it('exposes the id inside runWithCorrelation, including across async', async () => {
    await runWithCorrelation('abc-123', async () => {
      expect(getCorrelationId()).toBe('abc-123');
      await new Promise((r) => setTimeout(r, 5));
      expect(getCorrelationId()).toBe('abc-123');
    });
    expect(getCorrelationId()).toBeUndefined();
  });
  it('isolates concurrent scopes', async () => {
    const seen = [];
    await Promise.all([
      runWithCorrelation('A', async () => { await new Promise(r=>setTimeout(r,10)); seen.push(getCorrelationId()); }),
      runWithCorrelation('B', async () => { await new Promise(r=>setTimeout(r,1));  seen.push(getCorrelationId()); }),
    ]);
    expect(seen.sort()).toEqual(['A', 'B']);
  });
});
```
(Fix the `require` path depth to match the chosen test directory.)

- [ ] **Step 2: Run to verify it fails**

Run (adjust path): `cd /Users/curtismuir/Development/banking/banking_api_server && npx jest <test-path> --testPathIgnorePatterns '/node_modules/'`
Expected: FAIL — module not found. (The `--testPathIgnorePatterns` override is needed only if running from a worktree; from the main repo it is harmless.)

- [ ] **Step 3: Create the CJS module (api-server)**

Create `banking_api_server/utils/correlationContext.js`:

```javascript
'use strict';
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function runWithCorrelation(correlationId, fn) {
  return als.run({ correlationId }, fn);
}

function getCorrelationId() {
  const store = als.getStore();
  return store ? store.correlationId : undefined;
}

module.exports = { runWithCorrelation, getCorrelationId, als };
```

- [ ] **Step 4: Run to verify it passes**

Run the same jest command. Expected: 3 tests PASS.

- [ ] **Step 5: Create the HITL CJS copy + test**

Create `banking_hitl_service/src/correlationContext.js` — **identical body** to Step 3. Create `banking_hitl_service/tests/correlationContext.test.js` — same 3 tests as Step 1 with require path `../src/correlationContext`. Run `cd /Users/curtismuir/Development/banking/banking_hitl_service && npx jest tests/correlationContext.test.js` → 3 PASS.

- [ ] **Step 6: Create the 3 TypeScript copies + tests**

Create these three with identical semantics (TS):

`banking_mcp_gateway/src/correlationContext.ts`, `banking_mcp_server/src/utils/correlationContext.ts`, `banking_agent_service/src/correlationContext.ts`:

```typescript
import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationStore { correlationId: string; }

const als = new AsyncLocalStorage<CorrelationStore>();

export function runWithCorrelation<T>(correlationId: string, fn: () => T): T {
  return als.run({ correlationId }, fn);
}

export function getCorrelationId(): string | undefined {
  return als.getStore()?.correlationId;
}

export { als };
```

Create matching tests (TS, same 3 cases) at:
- `banking_mcp_gateway/tests/correlationContext.test.ts` (import `../src/correlationContext`)
- `banking_mcp_server/tests/utils/correlationContext.test.ts` (import `../../src/utils/correlationContext`)
- `banking_agent_service/tests/correlationContext.test.ts` (import `../src/correlationContext`)

TS test body (adjust import path per file):

```typescript
import { runWithCorrelation, getCorrelationId } from '../src/correlationContext';

describe('correlationContext', () => {
  it('undefined outside scope', () => {
    expect(getCorrelationId()).toBeUndefined();
  });
  it('exposes id inside run across async', async () => {
    await runWithCorrelation('abc-123', async () => {
      expect(getCorrelationId()).toBe('abc-123');
      await new Promise((r) => setTimeout(r, 5));
      expect(getCorrelationId()).toBe('abc-123');
    });
    expect(getCorrelationId()).toBeUndefined();
  });
  it('isolates concurrent scopes', async () => {
    const seen: string[] = [];
    await Promise.all([
      runWithCorrelation('A', async () => { await new Promise(r=>setTimeout(r,10)); seen.push(getCorrelationId()!); }),
      runWithCorrelation('B', async () => { await new Promise(r=>setTimeout(r,1));  seen.push(getCorrelationId()!); }),
    ]);
    expect(seen.sort()).toEqual(['A', 'B']);
  });
});
```

Run each service's test (`npx jest tests/correlationContext.test.ts` / `tests/utils/correlationContext.test.ts`) → 3 PASS each. Run `npx tsc --noEmit` in each of the 3 TS services → exit 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_api_server/utils/correlationContext.js banking_hitl_service/src/correlationContext.js banking_mcp_gateway/src/correlationContext.ts banking_mcp_server/src/utils/correlationContext.ts banking_agent_service/src/correlationContext.ts banking_api_server/**/correlationContext.test.js banking_hitl_service/tests/correlationContext.test.js banking_mcp_gateway/tests/correlationContext.test.ts banking_mcp_server/tests/utils/correlationContext.test.ts banking_agent_service/tests/correlationContext.test.ts && git commit -m "feat(logging): add AsyncLocalStorage correlation context to 5 services

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
`--no-verify` only if blocked solely on CHANGELOG/FEATURES/REGRESSION_LOG.

---

## Task 4: teachLogger auto-injects correlation_id from ALS (5 services)

**Files:**
- Modify: `banking_api_server/utils/teachLogger.js`, `banking_hitl_service/src/teachLogger.js`, `banking_mcp_gateway/src/teachLogger.ts`, `banking_mcp_server/src/utils/teachLogger.ts`, `banking_agent_service/src/teachLogger.ts`
- Test: extend each service's existing teachLogger test

The change is identical in each: in the emit path, merge `{ correlation_id }` when `getCorrelationId()` returns a value. `correlation_id` must NOT be clobbered by caller fields (treat like a reserved key) and must appear on info/warn/debug/error/step.

- [ ] **Step 1: Write the failing test (api-server first)**

Append to `banking_api_server`'s existing teachLogger test (the file created in Phase 1 Task 6 — find it: `ls banking_api_server/src/__tests__/utils/teachLogger.test.js`):

```javascript
const { runWithCorrelation } = require('../../utils/correlationContext');

it('auto-injects correlation_id from ALS on every line', async () => {
  const { Writable } = require('stream');
  const lines = [];
  const stream = new Writable({ write(c,_e,cb){ lines.push(JSON.parse(c.toString())); cb(); } });
  const { createTeachLogger } = require('../../utils/teachLogger');
  const log = createTeachLogger({ service: 'api-server', level: 'debug', stream });
  await runWithCorrelation('corr-xyz', async () => {
    log.info('a');
    log.step(1, 2, 'b');
    log.error('c', new Error('e'));
  });
  log.info('outside');
  expect(lines[0].correlation_id).toBe('corr-xyz');
  expect(lines[1].correlation_id).toBe('corr-xyz');
  expect(lines[2].correlation_id).toBe('corr-xyz');
  expect(lines[3].correlation_id).toBeUndefined();
});
it('caller field cannot clobber correlation_id', async () => {
  const { Writable } = require('stream');
  const lines = [];
  const stream = new Writable({ write(c,_e,cb){ lines.push(JSON.parse(c.toString())); cb(); } });
  const { createTeachLogger } = require('../../utils/teachLogger');
  const log = createTeachLogger({ service: 'api-server', level: 'debug', stream });
  await runWithCorrelation('real-id', async () => {
    log.info('m', { correlation_id: 'FAKE' });
  });
  expect(lines[0].correlation_id).toBe('real-id');
  expect(lines[0].field_correlation_id).toBe('FAKE');
});
```
(Adjust require depth to the real test file location.)

- [ ] **Step 2: Run to verify it fails**

Run the api-server teachLogger test. Expected: the 2 new cases FAIL (`correlation_id` undefined).

- [ ] **Step 3: Implement in api-server teachLogger.js**

In `banking_api_server/utils/teachLogger.js`:
- Add at top: `const { getCorrelationId } = require('./correlationContext');`
- Add `'correlation_id'` to the `RESERVED` set (so a caller field named `correlation_id` is prefixed to `field_correlation_id` and cannot overwrite the real one).
- In `wrap()`, introduce a helper that builds the per-line base fields and merges the ALS id. Concretely, change each method to spread an injected object. Replace the `wrap` method bodies so each emits `withCorrelation(safeFields(fields))`:

```javascript
function withCorrelation(obj) {
  const cid = getCorrelationId();
  return cid ? { ...obj, correlation_id: cid } : obj;
}
```
Then in `wrap`:
- `info: (msg, fields) => p.info(withCorrelation(safeFields(fields)), msg),`
- `warn: (msg, fields) => p.warn(withCorrelation(safeFields(fields)), msg),`
- `debug: (msg, fields) => p.debug(withCorrelation(safeFields(fields)), msg),`
- `error: (msg, err, fields) => { const base = withCorrelation(safeFields(fields)); if (err instanceof Error) base.err = err; else if (err !== undefined) base.err = err; p.error(base, msg); },`
- `step: (n, total, msg, fields) => p.info(withCorrelation({ ...safeFields(fields), teach: true }), \`[TEACH] step ${n}/${total}: ${msg}\`),`
- `child` unchanged (pino child + the same wrap recursion already applies `withCorrelation` because the wrapped methods do).

Keep stream/transport/branch logic and the no-redaction property unchanged.

- [ ] **Step 4: Run to verify it passes**

Run the api-server teachLogger test. Expected: all prior Phase-1 cases STILL pass + the 2 new cases pass.

- [ ] **Step 5: Apply the identical change to the other 4 services**

For each of `banking_hitl_service/src/teachLogger.js` (CJS, `require('./correlationContext')`), `banking_mcp_gateway/src/teachLogger.ts`, `banking_mcp_server/src/utils/teachLogger.ts` (`import { getCorrelationId } from './correlationContext'` — note path: mcp-server module is in `src/utils/`, context is `src/utils/correlationContext` → `'./correlationContext'`), `banking_agent_service/src/teachLogger.ts`:
- add the `getCorrelationId` import (TS: `import { getCorrelationId } from '<relative>';`),
- add `'correlation_id'` to `RESERVED`,
- add the `withCorrelation` helper and wrap each method exactly as Step 3.

Add the SAME 2 test cases to each service's existing teachLogger test (TS services: use `import { runWithCorrelation } from '<relative correlationContext>'`; adapt the capture-stream pattern already in those tests). For the mcp-server/gateway/agent-service confirm relative import paths compile.

- [ ] **Step 6: Run all teachLogger tests + typecheck**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npx tsc --noEmit && npx jest tests/utils/teachLogger.test.ts
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx tsc --noEmit && npx jest tests/teachLogger.test.ts
cd /Users/curtismuir/Development/banking/banking_agent_service && npx tsc --noEmit && npx jest tests/teachLogger.test.ts
cd /Users/curtismuir/Development/banking/banking_hitl_service && npx jest tests/teachLogger.test.js
cd /Users/curtismuir/Development/banking/banking_api_server && npx jest src/__tests__/utils/teachLogger.test.js --testPathIgnorePatterns '/node_modules/'
```
Expected: all PASS (Phase-1 cases + new correlation cases), all `tsc --noEmit` exit 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_api_server/utils/teachLogger.js banking_hitl_service/src/teachLogger.js banking_mcp_gateway/src/teachLogger.ts banking_mcp_server/src/utils/teachLogger.ts banking_agent_service/src/teachLogger.ts banking_api_server/src/__tests__/utils/teachLogger.test.js banking_hitl_service/tests/teachLogger.test.js banking_mcp_gateway/tests/teachLogger.test.ts banking_mcp_server/tests/utils/teachLogger.test.ts banking_agent_service/tests/teachLogger.test.ts && git commit -m "feat(logging): teachLogger auto-injects correlation_id from ALS (5 services)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
`--no-verify` only if blocked solely on CHANGELOG/FEATURES/REGRESSION_LOG.

---

## Task 5: BFF — run requests inside ALS (extend correlationId middleware)

**Files:**
- Modify: `banking_api_server/middleware/correlationId.js`
- Test: `banking_api_server/src/__tests__/middleware/correlationId.als.test.js` (mirror existing test dir)

**REGRESSION_PLAN §1 file.** Will NOT break: existing header read/echo behavior (`req.requestId`, `req.correlationId`, `X-Request-ID`/`X-Correlation-ID` response headers). The ONLY change: after setting the id, invoke `next()` inside `runWithCorrelation(id, next)` so all downstream async work + teachLogger calls carry it. The middleware must remain synchronous-compatible (Express middleware signature unchanged).

- [ ] **Step 1: Read the current middleware**

Run: `cd /Users/curtismuir/Development/banking/banking_api_server && cat middleware/correlationId.js`
Confirm it sets `req.requestId`/`req.correlationId`, echoes both response headers, then calls `next()`.

- [ ] **Step 2: Write the failing test**

Create `banking_api_server/src/__tests__/middleware/correlationId.als.test.js` (adjust dir to match existing test layout):

```javascript
const correlationIdMiddleware = require('../../../middleware/correlationId');
const { getCorrelationId } = require('../../../utils/correlationContext');

function mockRes() {
  const headers = {};
  return { setHeader: (k, v) => { headers[k] = v; }, headers };
}

describe('correlationId middleware ALS', () => {
  it('still sets req.correlationId and echoes headers (Phase-1 behavior preserved)', (done) => {
    const req = { headers: { 'x-correlation-id': 'given-1' } };
    const res = mockRes();
    correlationIdMiddleware(req, res, () => {
      expect(req.correlationId).toBe('given-1');
      expect(req.requestId).toBe('given-1');
      expect(res.headers['X-Correlation-ID']).toBe('given-1');
      done();
    });
  });
  it('runs next() inside the ALS scope so getCorrelationId() works downstream', (done) => {
    const req = { headers: { 'x-correlation-id': 'als-2' } };
    const res = mockRes();
    correlationIdMiddleware(req, res, () => {
      expect(getCorrelationId()).toBe('als-2');
      done();
    });
  });
  it('generates an id when no header present and binds it to ALS', (done) => {
    const req = { headers: {} };
    const res = mockRes();
    correlationIdMiddleware(req, res, () => {
      expect(typeof getCorrelationId()).toBe('string');
      expect(getCorrelationId()).toBe(req.correlationId);
      done();
    });
  });
});
```
(Adjust the `require` depth to the real test directory.)

- [ ] **Step 3: Run to verify it fails**

Run the test. Expected: the ALS cases FAIL (`getCorrelationId()` undefined inside `next`).

- [ ] **Step 4: Extend the middleware**

Edit `banking_api_server/middleware/correlationId.js`: add `const { runWithCorrelation } = require('../utils/correlationContext');` at the top. Keep ALL existing lines that compute `id`, set `req.requestId`, `req.correlationId`, and the two `res.setHeader` calls EXACTLY as they are. Replace the final `next();` (or `return next();`) with:

```javascript
return runWithCorrelation(id, () => next());
```

Nothing else changes. (`runWithCorrelation` returns the callback's return value; Express ignores middleware return values, so this is safe.)

- [ ] **Step 5: Run to verify it passes**

Run the test. Expected: all 3 PASS.

- [ ] **Step 6: Targeted regression**

Run the existing correlation/oauth/session tests that exercise the middleware chain:
```bash
cd /Users/curtismuir/Development/banking/banking_api_server && npx jest --testPathPattern='correlation|oauthStatus|session' --testPathIgnorePatterns '/node_modules/' 2>&1 | tail -12
```
Expected: no NEW failures vs the pre-change baseline. If any pre-existing failure is unrelated, note it.

- [ ] **Step 7: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_api_server/middleware/correlationId.js banking_api_server/src/__tests__/middleware/correlationId.als.test.js && git commit -m "feat(api-server): run requests inside ALS correlation scope

REGRESSION_PLAN §1: header read/echo + req.correlationId unchanged; only
wraps next() in runWithCorrelation so teachLogger carries the id downstream.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
`--no-verify` only if blocked solely on CHANGELOG/FEATURES/REGRESSION_LOG.

---

## Task 6: Gateway — read inbound correlation id, bind ALS, forward to MCP, write GwAuditTrail to log

**Files:**
- Modify: `banking_mcp_gateway/src/index.ts` (WS path) and `banking_mcp_gateway/src/server/GatewayServer.ts` (HTTP `/mcp` path)
- Modify: `banking_mcp_gateway/src/proxy.ts` (forward `params.correlationId` to upstream MCP)
- Modify: `banking_mcp_gateway/src/middleware/authorizeMcpRequest.ts` (write `GwAuditTrail` to teachLog under the correlation id, in addition to the existing response header)
- Test: `banking_mcp_gateway/tests/correlation-flow.test.ts`

Logging/propagation only. Do NOT change routing, credential disposition, token-exchange cache, Authorize evaluation, or D-05. The `X-Gw-Audit-Trail` response header behavior is unchanged — we ADD a log emission, not replace the header.

- [ ] **Step 1: Locate inbound id + audit-trail serialization**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && grep -n "X-Correlation-ID\|x-correlation-id\|JSON.parse\|\.id\b\|params.correlationId\|X-Gw-Audit-Trail\|GwAuditTrail" src/index.ts src/server/GatewayServer.ts src/middleware/authorizeMcpRequest.ts src/proxy.ts | head -40
```
Read: the HTTP `/mcp` handler (GatewayServer.ts), the WS message handler (index.ts ~329-335), the `GwAuditTrail` build + `X-Gw-Audit-Trail` set in authorizeMcpRequest.ts (~88-98), and the proxy initialize-params build in proxy.ts (~62-71, ~95). Record exact lines + the variable names for the parsed JSON-RPC message and the audit-trail object.

- [ ] **Step 2: Write the failing test**

Create `banking_mcp_gateway/tests/correlation-flow.test.ts`:

```typescript
import { getCorrelationId } from '../src/correlationContext';
import { extractCorrelationId } from '../src/correlationId';

describe('gateway correlation extraction', () => {
  it('prefers X-Correlation-ID header, falls back to JSON-RPC params.correlationId then id', () => {
    expect(extractCorrelationId({ 'x-correlation-id': 'H' }, { id: 1, params: { correlationId: 'P' } })).toBe('H');
    expect(extractCorrelationId({}, { id: 7, params: { correlationId: 'P' } })).toBe('P');
    expect(extractCorrelationId({}, { id: 'rpc-9', params: {} })).toBe('rpc-9');
    expect(typeof extractCorrelationId({}, {})).toBe('string'); // generates a uuid fallback
  });
});
```

(The plan introduces a tiny pure helper `src/correlationId.ts` so extraction is unit-testable without standing up the server.)

- [ ] **Step 3: Run to verify it fails**

Run: `cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx jest tests/correlation-flow.test.ts`
Expected: FAIL — `Cannot find module '../src/correlationId'`.

- [ ] **Step 4: Create the extraction helper**

Create `banking_mcp_gateway/src/correlationId.ts`:

```typescript
import { randomUUID } from 'crypto';

export function extractCorrelationId(
  headers: Record<string, unknown> | undefined,
  rpcMessage: { id?: unknown; params?: { correlationId?: unknown } } | undefined,
): string {
  const h = headers || {};
  const hdr = h['x-correlation-id'] ?? h['X-Correlation-ID'];
  if (typeof hdr === 'string' && hdr) return hdr;
  const p = rpcMessage?.params?.correlationId;
  if (typeof p === 'string' && p) return p;
  const id = rpcMessage?.id;
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number') return String(id);
  return randomUUID();
}
```

- [ ] **Step 5: Run to verify it passes**

Run the test. Expected: 1 test (4 assertions) PASS.

- [ ] **Step 6: Wire extraction + ALS at both entrypoints**

In the HTTP `/mcp` handler (GatewayServer.ts) and the WS message handler (index.ts), at the point right after the inbound JSON-RPC message is parsed and before authorization/routing runs:
- compute `const correlationId = extractCorrelationId(req.headers /* or ws upgrade headers */, parsedMessage);`
- wrap the existing per-request handling in `runWithCorrelation(correlationId, () => { <existing handling> })` (import `runWithCorrelation` from `./correlationContext` / `../correlationContext` as path requires).
Make the minimal structural change to wrap the existing handler body — do not reorder auth/routing logic. If the handler is `async`, `runWithCorrelation` works with an async fn (ALS propagates across awaits) — `return runWithCorrelation(correlationId, async () => { ... })`.

- [ ] **Step 7: Forward correlationId to upstream MCP in proxy.ts**

In `src/proxy.ts`, where the initialize params and the forwarded request are built (~62-71, ~95), add `correlationId` into the outbound JSON-RPC `params` using `getCorrelationId()` (import from `./correlationContext`): for the initialize handshake params object add `correlationId: getCorrelationId()` (only if defined — `const cid = getCorrelationId(); if (cid) initParams.correlationId = cid;`), and for the forwarded real request, if it has a `params` object and no correlationId, attach the same. Do NOT alter the request otherwise.

- [ ] **Step 8: Write GwAuditTrail to the log**

In `src/middleware/authorizeMcpRequest.ts`, at the point where the `GwAuditTrail` object is finalized and serialized to the `X-Gw-Audit-Trail` response header (keep that line), ADD immediately after it:

```typescript
teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
```
(use the real in-scope audit object variable name from Step 1; `teachLog` is already imported in this file from Phase 1. The ALS-bound `correlation_id` is auto-added by teachLogger — no extra arg needed.) This is additive; the response header is unchanged.

- [ ] **Step 9: Build + tests**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx tsc --noEmit && npm run build 2>&1 | tail -3 && npx jest tests/correlation-flow.test.ts tests/teachLogger.test.ts tests/gateway-teachlog-migration.test.ts 2>&1 | tail -8 && npm test 2>&1 | tail -10
```
Expected: tsc + build exit 0; new + Phase-1 gateway tests pass; pre-existing suite green except the known argon2 `vault.test.ts` (pre-existing, not a regression).

- [ ] **Step 10: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_mcp_gateway/src/correlationId.ts banking_mcp_gateway/src/index.ts banking_mcp_gateway/src/server/GatewayServer.ts banking_mcp_gateway/src/proxy.ts banking_mcp_gateway/src/middleware/authorizeMcpRequest.ts banking_mcp_gateway/tests/correlation-flow.test.ts && git commit -m "feat(gateway): extract+bind correlation id, forward to MCP, GwAuditTrail to log

Routing/disposition/cache/Authorize/D-05 unchanged; additive + ALS wrap only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
`--no-verify` only if blocked solely on CHANGELOG/FEATURES/REGRESSION_LOG.

---

## Task 7: MCP server — read inbound correlationId, bind ALS per message

**Files:**
- Modify: `banking_mcp_server/src/server/MCPMessageHandler.ts` (and/or `src/server/HttpMCPTransport.ts` where the JSON-RPC message is first parsed)
- Test: `banking_mcp_server/tests/correlation-binding.test.ts`

**Touches a §1-adjacent area (MCP message handling).** Will NOT change: handshake/lifecycle, tool dispatch, scope checks, `may_act`/`aud` enforcement (TokenIntrospector is unchanged — it inherits the ALS id automatically via the Phase-4 teachLogger change). Only adds: read `params.correlationId`/`initParams.correlationId` and wrap message handling in `runWithCorrelation`.

- [ ] **Step 1: Trace message parse → handler**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && grep -n "correlationId\|JSON.parse\|message.params\|initParams\|handleMessage\|MessageHandlerContext" src/server/MCPMessageHandler.ts src/server/HttpMCPTransport.ts | head -30
```
Identify the single earliest point where the parsed inbound message object is available for both initialize and tools/call, before auth/dispatch. Record the variable name + file:line.

- [ ] **Step 2: Write the failing test**

Create `banking_mcp_server/tests/correlation-binding.test.ts`:

```typescript
import { getCorrelationId } from '../src/utils/correlationContext';
import { correlationFromMessage } from '../src/server/correlationFromMessage';

describe('mcp-server correlation extraction', () => {
  it('reads params.correlationId then initParams.correlationId then id', () => {
    expect(correlationFromMessage({ params: { correlationId: 'P' } })).toBe('P');
    expect(correlationFromMessage({ params: { initParams: { correlationId: 'I' } } })).toBe('I');
    expect(correlationFromMessage({ id: 42 })).toBe('42');
    expect(typeof correlationFromMessage({})).toBe('string');
  });
  it('getCorrelationId reflects a runWithCorrelation scope', async () => {
    const { runWithCorrelation } = await import('../src/utils/correlationContext');
    await runWithCorrelation('mcp-1', async () => {
      expect(getCorrelationId()).toBe('mcp-1');
    });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd /Users/curtismuir/Development/banking/banking_mcp_server && npx jest tests/correlation-binding.test.ts`
Expected: FAIL — `Cannot find module '../src/server/correlationFromMessage'`.

- [ ] **Step 4: Create the pure helper**

Create `banking_mcp_server/src/server/correlationFromMessage.ts`:

```typescript
import { randomUUID } from 'crypto';

interface RpcLike {
  id?: unknown;
  params?: { correlationId?: unknown; initParams?: { correlationId?: unknown } };
}

export function correlationFromMessage(msg: RpcLike | undefined): string {
  const p = msg?.params?.correlationId;
  if (typeof p === 'string' && p) return p;
  const ip = msg?.params?.initParams?.correlationId;
  if (typeof ip === 'string' && ip) return ip;
  const id = msg?.id;
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number') return String(id);
  return randomUUID();
}
```

- [ ] **Step 5: Run to verify it passes**

Run the test. Expected: both tests PASS.

- [ ] **Step 6: Wrap message handling in ALS**

At the earliest single point from Step 1 where the parsed message is available (before auth/dispatch — covering both initialize and tools/call), compute `const correlationId = correlationFromMessage(message);` and wrap the existing per-message handling body in `runWithCorrelation(correlationId, () => <existing handling>)` (import `runWithCorrelation` from `../utils/correlationContext`). If the handler is async, use `async () => { ... }`. Make the minimal wrap; do not reorder handshake/auth/dispatch. TokenIntrospector and all Phase-1 `teachLog.step` lines now automatically carry `correlation_id` via the ALS — no changes there.

- [ ] **Step 7: Build + tests**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npx tsc --noEmit && npm run build 2>&1 | tail -3 && npx jest tests/correlation-binding.test.ts tests/utils/teachLogger.test.ts tests/auth/TokenIntrospector.teachlog.test.ts 2>&1 | tail -8 && npm test 2>&1 | tail -10
```
Expected: tsc/build exit 0; new + Phase-1 tests pass; pre-existing MCP suite green (ignore known pre-existing failures unrelated to this change).

- [ ] **Step 8: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_mcp_server/src/server/correlationFromMessage.ts banking_mcp_server/src/server/MCPMessageHandler.ts banking_mcp_server/src/server/HttpMCPTransport.ts banking_mcp_server/tests/correlation-binding.test.ts && git commit -m "feat(mcp-server): bind inbound correlationId to ALS per message

Handshake/dispatch/scope/may_act unchanged; TokenIntrospector inherits id via ALS.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
(Only `git add` files that actually changed — if HttpMCPTransport.ts was not modified, omit it.) `--no-verify` only if blocked solely on CHANGELOG/FEATURES/REGRESSION_LOG.

---

## Task 8: Gateway→HITL forwards correlation id; HITL binds it

**Files:**
- Modify: `banking_mcp_gateway/src/hitlClient.ts` (add `correlationId` to POST /challenges body + `X-Correlation-ID` header)
- Modify: `banking_hitl_service/src/index.js` (add an early middleware reading `X-Correlation-ID` / body `correlationId` and running the request inside ALS)
- Test: `banking_hitl_service/tests/correlation-middleware.test.js`

Logging/propagation only. Do NOT change challenge schema, TTL, validation.

- [ ] **Step 1: Read both sides**

Run:
```bash
cd /Users/curtismuir/Development/banking && grep -n "challenges\|axios.post\|correlationId\|payload" banking_mcp_gateway/src/hitlClient.ts | head && grep -n "app.use\|express()\|listen\|req.body\|router" banking_hitl_service/src/index.js | head
```
Identify the `axios.post(.../challenges, payload, {...})` site (hitlClient.ts ~40) and the HITL Express app setup + where middleware can be added before the routes (index.js).

- [ ] **Step 2: Failing test (HITL middleware)**

Create `banking_hitl_service/tests/correlation-middleware.test.js`:

```javascript
const { correlationMiddleware } = require('../src/correlationMiddleware');
const { getCorrelationId } = require('../src/correlationContext');

describe('hitl correlation middleware', () => {
  it('binds X-Correlation-ID header into ALS', (done) => {
    const req = { headers: { 'x-correlation-id': 'gw-1' }, body: {} };
    correlationMiddleware(req, {}, () => {
      expect(getCorrelationId()).toBe('gw-1');
      done();
    });
  });
  it('falls back to body.correlationId', (done) => {
    const req = { headers: {}, body: { correlationId: 'body-2' } };
    correlationMiddleware(req, {}, () => {
      expect(getCorrelationId()).toBe('body-2');
      done();
    });
  });
  it('generates one when absent', (done) => {
    const req = { headers: {}, body: {} };
    correlationMiddleware(req, {}, () => {
      expect(typeof getCorrelationId()).toBe('string');
      done();
    });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd /Users/curtismuir/Development/banking/banking_hitl_service && npx jest tests/correlation-middleware.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Create the HITL correlation middleware**

Create `banking_hitl_service/src/correlationMiddleware.js`:

```javascript
'use strict';
const { randomUUID } = require('crypto');
const { runWithCorrelation } = require('./correlationContext');

function correlationMiddleware(req, res, next) {
  const hdr = req.headers && (req.headers['x-correlation-id'] || req.headers['X-Correlation-ID']);
  const body = req.body || {};
  const id = (typeof hdr === 'string' && hdr) ||
             (typeof body.correlationId === 'string' && body.correlationId) ||
             randomUUID();
  return runWithCorrelation(id, () => next());
}

module.exports = { correlationMiddleware };
```

- [ ] **Step 5: Run to verify it passes**

Run the test. Expected: 3 PASS.

- [ ] **Step 6: Register the middleware in HITL**

In `banking_hitl_service/src/index.js`, register `correlationMiddleware` AFTER the JSON body parser (`express.json()`) and BEFORE the challenge routes (so `req.body.correlationId` is available). Add `const { correlationMiddleware } = require('./correlationMiddleware');` and `app.use(correlationMiddleware);` at the correct position. Change nothing else.

- [ ] **Step 7: Gateway forwards the id to HITL**

In `banking_mcp_gateway/src/hitlClient.ts`, at the `axios.post(${hitlServiceUrl}/challenges, payload, {...})` site: add `correlationId: getCorrelationId()` into the `payload` object (import `getCorrelationId` from `./correlationContext`), and add an `X-Correlation-ID` header to the axios request config headers (`{ headers: { 'X-Correlation-ID': getCorrelationId() || '' , ...existing } }`). Only attach when defined. Do not change the rest of the payload or the response handling.

- [ ] **Step 8: Build + tests**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx tsc --noEmit && npm run build 2>&1 | tail -3
cd /Users/curtismuir/Development/banking/banking_hitl_service && npx jest 2>&1 | tail -10
```
Expected: gateway tsc/build exit 0; HITL tests pass (teachLogger + migration + correlationContext + correlationMiddleware), no new failures.

- [ ] **Step 9: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_mcp_gateway/src/hitlClient.ts banking_hitl_service/src/index.js banking_hitl_service/src/correlationMiddleware.js banking_hitl_service/tests/correlation-middleware.test.js && git commit -m "feat(hitl): gateway forwards correlation id; HITL binds it via ALS

Challenge schema/TTL/validation unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
`--no-verify` only if blocked solely on CHANGELOG/FEATURES/REGRESSION_LOG.

---

## Task 9: BFF — bridge correlation_id into the SSE token-chain stream

**Files:**
- Modify: `banking_api_server/server.js` (the `publishTokenEventsToSse` / `publishMcpResultToSse` functions ~1188-1222 and the flowTrace binding ~1265-1267)
- Test: `banking_api_server/src/__tests__/services/sse-correlation.test.js`

Adds `correlation_id` to every SSE event payload so the on-screen Token Chain and the server logs share one id. Does NOT change the SSE subscription key (`flowTraceId`) or the UI contract beyond an additive field.

- [ ] **Step 1: Confirm UI does not type-validate the SSE payload**

Run:
```bash
cd /Users/curtismuir/Development/banking && grep -rn "token-event\|mcp-result\|EventSource\|openMcpFlowSse" banking_api_ui/src | head
```
Confirm the UI consumes SSE event fields permissively (reads known fields; does not reject unknown fields / has no TS interface that would fail the build on an extra field). If the UI has a strict TS type for the event that would break `npm run build`, note it — then Step 6 must also update that type (and a UI build gate is required). If the UI is permissive (expected — it's CRA JS), no UI build needed; record that finding.

- [ ] **Step 2: Write the failing test**

Create `banking_api_server/src/__tests__/services/sse-correlation.test.js` (adjust dir to match existing layout):

```javascript
const { runWithCorrelation } = require('../../../utils/correlationContext');

// We test the pure payload-builder, not the HTTP stream.
const { buildSsePayload } = require('../../../services/sseCorrelation');

describe('SSE payload correlation', () => {
  it('stamps correlation_id from ALS onto the event payload', async () => {
    await runWithCorrelation('sse-1', async () => {
      const p = buildSsePayload('token-event', { foo: 'bar' });
      expect(p.type).toBe('token-event');
      expect(p.foo).toBe('bar');
      expect(p.correlation_id).toBe('sse-1');
    });
  });
  it('omits correlation_id when no ALS scope', () => {
    const p = buildSsePayload('mcp-result', { x: 1 });
    expect(p.correlation_id).toBeUndefined();
    expect(p.x).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run (adjust path): `cd /Users/curtismuir/Development/banking/banking_api_server && npx jest src/__tests__/services/sse-correlation.test.js --testPathIgnorePatterns '/node_modules/'`
Expected: FAIL — `Cannot find module '../../../services/sseCorrelation'`.

- [ ] **Step 4: Create the payload builder**

Create `banking_api_server/services/sseCorrelation.js`:

```javascript
'use strict';
const { getCorrelationId } = require('../utils/correlationContext');

function buildSsePayload(type, event) {
  const base = { type, ...(event && typeof event === 'object' ? event : {}) };
  const cid = getCorrelationId();
  if (cid) base.correlation_id = cid;
  return base;
}

module.exports = { buildSsePayload };
```

- [ ] **Step 5: Run to verify it passes**

Run the test. Expected: 2 PASS.

- [ ] **Step 6: Use the builder in the SSE publish functions**

In `banking_api_server/server.js`, in `publishTokenEventsToSse` and `publishMcpResultToSse` (~1188-1222), replace the inline payload object literals (`{ type: 'token-event', ...event }` / `{ type: 'mcp-result', ...}`) with `buildSsePayload('token-event', event)` / `buildSsePayload('mcp-result', <existing payload object>)`. Add `const { buildSsePayload } = require('./services/sseCorrelation');` near the other requires. Do NOT change the `flowTraceId` subscription key or `mcpFlowSseHub.publish` call signature — only the payload object construction changes. The MCP-tool HTTP handler already runs inside the BFF ALS scope (Task 5), so `getCorrelationId()` resolves to the same id present in the server logs for that request.

- [ ] **Step 7: Tests + (conditional) UI build**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_api_server && npx jest src/__tests__/services/sse-correlation.test.js --testPathIgnorePatterns '/node_modules/' 2>&1 | tail -6
```
Expected: PASS. If Step 1 found a strict UI TS type for the SSE event, also run `cd /Users/curtismuir/Development/banking/banking_api_ui && npm run build` and confirm exit 0; otherwise (permissive UI) no UI build is required — state that explicitly in the report.

- [ ] **Step 8: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_api_server/services/sseCorrelation.js banking_api_server/server.js banking_api_server/src/__tests__/services/sse-correlation.test.js && git commit -m "feat(api-server): stamp correlation_id onto SSE token-chain events

UI Token Chain and server logs now share one trace id. Subscription key
(flowTraceId) unchanged; additive payload field only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
`--no-verify` only if blocked solely on CHANGELOG/FEATURES/REGRESSION_LOG.

---

## Task 10: End-to-end correlation verification + REGRESSION_PLAN §4 entry

**Files:**
- Modify: `REGRESSION_PLAN.md` (§4 Bug Fix Log)
- Test: `banking_api_server/src/__tests__/integration/correlation-e2e.test.js` (a focused integration test of the BFF ALS→teachLogger→SSE chain that does not require all services running)

- [ ] **Step 1: Write the BFF-local e2e test**

Create `banking_api_server/src/__tests__/integration/correlation-e2e.test.js` (adjust dir):

```javascript
const { runWithCorrelation, getCorrelationId } = require('../../../utils/correlationContext');
const { createTeachLogger } = require('../../../utils/teachLogger');
const { buildSsePayload } = require('../../../services/sseCorrelation');
const { Writable } = require('stream');

describe('correlation end-to-end (BFF in-process)', () => {
  it('one id appears on log lines AND the SSE payload within one request scope', async () => {
    const lines = [];
    const stream = new Writable({ write(c,_e,cb){ lines.push(JSON.parse(c.toString())); cb(); } });
    const log = createTeachLogger({ service: 'api-server', level: 'debug', stream });
    let ssePayload;
    await runWithCorrelation('e2e-id', async () => {
      log.step(4, 9, 'RFC 8693 exchange REQUEST', { access_token: 'eyJ.a.b' });
      log.info('exchange done');
      ssePayload = buildSsePayload('token-event', { kind: 'exchange' });
    });
    const stepLine = lines.find((l) => l.msg.includes('RFC 8693'));
    expect(stepLine.correlation_id).toBe('e2e-id');
    expect(stepLine.access_token).toBe('eyJ.a.b'); // still visible — teaching
    expect(lines.find((l) => l.msg === 'exchange done').correlation_id).toBe('e2e-id');
    expect(ssePayload.correlation_id).toBe('e2e-id');
  });
});
```

- [ ] **Step 2: Run it — must pass**

Run (adjust path): `cd /Users/curtismuir/Development/banking/banking_api_server && npx jest src/__tests__/integration/correlation-e2e.test.js --testPathIgnorePatterns '/node_modules/'`
Expected: PASS — proves the BFF chain (ALS → teachLogger correlation_id → SSE payload) is coherent and tokens stay visible.

- [ ] **Step 3: Full Phase-2 sweep**

Run and record each result:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npx tsc --noEmit && npm run build 2>&1 | tail -1 && npx jest tests/utils/correlationContext.test.ts tests/correlation-binding.test.ts tests/utils/teachLogger.test.ts 2>&1 | tail -5
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx tsc --noEmit && npm run build 2>&1 | tail -1 && npx jest tests/correlationContext.test.ts tests/correlation-flow.test.ts tests/teachLogger.test.ts 2>&1 | tail -5
cd /Users/curtismuir/Development/banking/banking_agent_service && npx tsc --noEmit && npx jest tests/correlationContext.test.ts tests/teachLogger.test.ts 2>&1 | tail -5
cd /Users/curtismuir/Development/banking/banking_hitl_service && npx jest 2>&1 | tail -6
cd /Users/curtismuir/Development/banking/banking_api_server && npx jest src/__tests__/utils/correlationContext.test.js src/__tests__/utils/teachLogger.test.js src/__tests__/middleware/correlationId.als.test.js src/__tests__/services/sse-correlation.test.js src/__tests__/integration/correlation-e2e.test.js --testPathIgnorePatterns '/node_modules/' 2>&1 | tail -6
```
All MUST pass; all tsc/build exit 0. Known pre-existing argon2 `vault.test.ts` (gateway) / `jwt` langchain failures are NOT in scope and NOT invoked by these commands. If anything else fails, STOP and report BLOCKED.

- [ ] **Step 4: Append the REGRESSION_PLAN §4 entry**

Find the §4 format: `grep -n "Bug Fix Log\|^### 20" REGRESSION_PLAN.md | tail -5`. Append ONE entry mirroring the existing format exactly (heading level + bold field labels), content:
- Title: Logging Phase 2 — cross-service correlation (X-Correlation-ID + ALS + SSE)
- Date: 2026-05-16
- Symptom / Reason: A single delegation flow could not be traced across services; logs fragmented across /tmp/bank-*.log with no shared id; the UI Token Chain used a separate flowTraceId unrelated to server logs.
- Root cause: No async-context propagation; downstream services never read the correlation id the BFF already sent; HITL had no structured logger at all.
- Fix: Added AsyncLocalStorage correlationContext to 5 services; teachLogger auto-injects correlation_id from ALS; BFF runs requests inside the ALS scope (extended correlationId middleware); gateway extracts + binds + forwards correlationId to MCP (params) and HITL (body+header) and writes GwAuditTrail to its log; MCP server binds inbound correlationId per message; backfilled teachLogger into banking_hitl_service; BFF stamps correlation_id onto SSE token-chain events so the UI and logs share one id.
- Not broken (verified): correlationId middleware header read/echo + req.correlationId; gateway routing/disposition/cache/Authorize/D-05; MCP handshake/dispatch/may_act/aud (TokenIntrospector inherits id via ALS, unchanged); HITL challenge schema/TTL/validation; SSE flowTraceId subscription key; token/claim visibility (no redaction).
- Tests: correlationContext (5 services), teachLogger correlation cases (5 services), correlationId.als, gateway correlation-flow, mcp correlation-binding, hitl correlation-middleware, sse-correlation, correlation-e2e.
- Spec/Plan refs: docs/superpowers/specs/2026-05-15-logging-as-teaching-surface-design.md, docs/superpowers/plans/2026-05-16-logging-phase2-correlation.md
No emojis except ⚠️✅❌. Do not restructure §4 or touch other sections.

- [ ] **Step 5: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add REGRESSION_PLAN.md banking_api_server/src/__tests__/integration/correlation-e2e.test.js && git commit -m "docs(regression): §4 entry — Logging Phase 2 cross-service correlation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
`--no-verify` only if blocked solely on CHANGELOG/FEATURES/REGRESSION_LOG.

---

## Self-Review

**Spec coverage (Phase 2 scope from spec §8 / §4.2):**
- "X-Correlation-ID minted at first hop" → BFF already mints in `correlationId.js`; Task 5 binds it to ALS ✅
- "propagated all hops" → BFF→gateway already (JSON-RPC id/params); Task 6 gateway reads+binds+forwards to MCP; Task 7 MCP binds; Task 8 gateway→HITL forwards + HITL binds; Task 6 also adds explicit `X-Correlation-ID` HTTP header on the gateway hop ✅
- "into RFC 8693 logs" → Task 4 makes teachLogger auto-carry it; rfc8693TokenExchangeService.js Phase-1 steps inherit it via the BFF ALS scope (Task 5) — no change to that §1 file ✅
- "into SSE token-chain events" → Task 9 ✅
- "gateway GwAuditTrail written to log" → Task 6 Step 8 ✅
- "extend correlationId middleware, don't replace" → Task 5 keeps all header/req behavior, only wraps next() ✅
- "Python agent trace_id aligned" → NOTE: spec §4.2 mentions the Python langchain_agent path. Phase 2 as planned covers the Node/TS + HITL chain. The Python agent already emits its own trace_id/span_id (Phase-1 audit) and is an independent entry path (not in the BFF→gateway→MCP request chain for the tool-call flow this plan traces). Aligning the Python field NAME to `correlation_id` and threading it is a small, separable piece — explicitly deferred to a Phase 2.1 / Phase 3 follow-up to keep this plan's chain coherent and shippable. This is the one spec item intentionally not in this plan; flagged here so it is not silently dropped.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Where exact lines are audit-approximate (gateway entrypoints, MCP message parse, SSE publish ~line numbers), each task starts with a grep/read step to pin real lines + variable names — a deliberate instruction, not a placeholder (the Phase-1 execution proved the audit line numbers can drift).

**Type/name consistency:** `runWithCorrelation(id, fn)` / `getCorrelationId()` identical across all 5 modules (CJS + TS). Log field is `correlation_id` (snake_case) everywhere; header `X-Correlation-ID`; JSON-RPC body field `correlationId` (camelCase, matches what the BFF already sends — verified in the investigation). `extractCorrelationId` (gateway) vs `correlationFromMessage` (mcp-server) are intentionally different helpers (different inputs: HTTP headers+RPC vs RPC-only) — not a naming inconsistency. teachLogger change (Task 4) is the same `withCorrelation` helper + `RESERVED` addition in all 5.

**Decomposition / ordering:** Task 3 (ALS modules) precedes Task 4 (teachLogger uses them) precedes Tasks 5-9 (entrypoints bind, hops forward). HITL backfill (Tasks 1-2) precedes its ALS/ correlation wiring (Tasks 3,8). Each task independently testable and committable. Tasks 1-2 (HITL teachLogger) are independent of 3-9 and could run first or in parallel conceptually but are ordered first since Task 3 adds HITL's ALS module and Task 4 extends HITL's (now-existing) teachLogger.
