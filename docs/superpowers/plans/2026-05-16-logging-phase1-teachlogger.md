# Logging Phase 1 — teachLogger + Python un-redact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a shared `teachLogger` (pino-core, narration + structured-diagnostic API) into the Node/TS services on the priority-1 auth/OAuth/token-exchange/MCP-dispatch paths, disable the Python `SensitiveDataFilter`, and correct the Python DEBUG agent-token log lines — without changing any auth/session/MCP behavior.

**Architecture:** `teachLogger` is a thin per-service module wrapping pino. pino is used **only** as the level/transport/serialization engine — **no redaction config** (the opposite of pino's usual production posture), custom serializers *expand* token/error objects. The module exposes `info/warn/error/debug` (structured, error carries cause+stack+operation) plus `step(n, total, msg, fields)` (teaching narration). It is copied per service (repo's "each service self-contained" convention — no new workspace tooling). Phase 1 introduces the module and migrates only the priority-1 call sites named below; no cross-service correlation yet (Phase 2).

**Tech Stack:** pino 9 + pino-pretty (dev), TypeScript 5 (mcp-server/gateway/agent-service), CommonJS JS (api-server), Python `logging` (langchain_agent), jest / pytest.

---

## Scope & Non-Negotiables

- **No redaction of tokens/claims/PII.** Per the design (`docs/superpowers/specs/2026-05-15-logging-as-teaching-surface-design.md`) token visibility is an intentional teaching feature. `teachLogger` has **no** pino `redact` config. Tests assert visibility is *preserved*.
- **REGRESSION_PLAN §1 files touched:** `banking_api_server/middleware/auth.js`, `banking_mcp_server/src/auth/TokenIntrospector.ts`, `langchain_agent` auth/token paths. Every task that touches them states what it will NOT break and keeps a minimal diff (logging-only; no auth logic change). The Python token-line fix gets a REGRESSION_PLAN §4 Bug Fix Log entry.
- **Python token lines (613/614/620/982) clarification:** these use `{self._current_agent_token}`, and `AccessToken.__str__` (`langchain_agent/src/models/auth.py:117-121`) already returns `AccessToken(***masked***)`. They are **not leaking** today — they print a useless masked literal. The teaching-correct fix is `.masked_fingerprint()` (stable `sha256:<12>` correlation tag, already implemented at `auth.py:123`), matching line 334's existing pattern. We deliberately do **not** dump the raw JWT into debug lines: the full token is already fully visible on the Token Chain / SSE teaching surfaces, and `auth.py:113` BL-01 is a load-bearing protection against accidental token-in-logs elsewhere. This diverges from the spec's loose "print the real token clearly" wording; the design intent (a *useful, debuggable, teaching* token reference) is satisfied by the fingerprint + the existing visible surfaces.
- **No emojis** except `⚠️ ✅ ❌`. **UI build** not affected in Phase 1 (no `banking_api_ui` edits).
- pino version pinned to match across services: **`pino@^9.5.0`**, **`pino-pretty@^13.0.0`**.

## File Structure

Per service, one new self-contained module (TS services compile via existing `tsc`):

- `banking_mcp_server/src/utils/teachLogger.ts` — TS wrapper (this service already has `src/utils/Logger.ts`; teachLogger is additive, does not replace it in Phase 1).
- `banking_mcp_gateway/src/teachLogger.ts` — TS wrapper.
- `banking_agent_service/src/teachLogger.ts` — TS wrapper.
- `banking_api_server/utils/teachLogger.js` — CJS wrapper (this service has `utils/logger.js`; teachLogger is additive).
- Python: no new file — modify `langchain_agent/src/log_utils/structured_logger.py` (disable filter) and `langchain_agent/src/agent/mcp_tool_provider.py` (token lines).

Reference module shape (identical API across services; language-adapted):

```
teachLogger.info(msg, fields?)        // structured
teachLogger.warn(msg, fields?)
teachLogger.error(msg, errOrFields)   // err -> {err:{message,stack,cause}, operation}
teachLogger.debug(msg, fields?)
teachLogger.step(n, total, msg, fields?)  // emits "[TEACH] step n/total: msg" + fields
teachLogger.child(bindings)           // returns logger with bound fields (Phase 2 uses for correlation_id)
```

---

## Task 1: Add pino to banking_mcp_server and create teachLogger.ts

**Files:**
- Modify: `banking_mcp_server/package.json` (dependencies)
- Create: `banking_mcp_server/src/utils/teachLogger.ts`
- Test: `banking_mcp_server/tests/utils/teachLogger.test.ts`

- [ ] **Step 1: Install pino**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npm install pino@^9.5.0 pino-pretty@^13.0.0 --save
```
Expected: `package.json` `dependencies` now contains `pino` and `pino-pretty`; exit 0.

- [ ] **Step 2: Write the failing test**

Create `banking_mcp_server/tests/utils/teachLogger.test.ts`:

```typescript
import { Writable } from 'stream';
import pino from 'pino';

// Capture lines by injecting a stream via the factory's test hook.
import { createTeachLogger } from '../../src/utils/teachLogger';

function capture(): { lines: any[]; stream: Writable } {
  const lines: any[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, stream };
}

describe('teachLogger', () => {
  it('emits a structured info line with fields and never redacts a token', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'mcp-server', level: 'debug', stream });
    const fakeJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.sig';
    log.info('token received', { access_token: fakeJwt, sub: 'user1' });
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('token received');
    expect(lines[0].service).toBe('mcp-server');
    // Visibility is intentional: the token MUST appear verbatim.
    expect(lines[0].access_token).toBe(fakeJwt);
  });

  it('step() emits a [TEACH] narration marker with n/total', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'mcp-server', level: 'debug', stream });
    log.step(3, 9, 'RFC 8693 exchange', { resource: 'mcp' });
    expect(lines[0].msg).toBe('[TEACH] step 3/9: RFC 8693 exchange');
    expect(lines[0].resource).toBe('mcp');
    expect(lines[0].teach).toBe(true);
  });

  it('error() captures message, stack and operation', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'mcp-server', level: 'debug', stream });
    log.error('exchange failed', new Error('boom'), { operation: 'rfc8693' });
    expect(lines[0].level).toBe(50); // pino error
    expect(lines[0].err.message).toBe('boom');
    expect(typeof lines[0].err.stack).toBe('string');
    expect(lines[0].operation).toBe('rfc8693');
  });

  it('respects LOG_LEVEL via level option (debug shown, then info filters debug)', () => {
    const c1 = capture();
    const debugLog = createTeachLogger({ service: 's', level: 'debug', stream: c1.stream });
    debugLog.debug('d');
    expect(c1.lines).toHaveLength(1);

    const c2 = capture();
    const infoLog = createTeachLogger({ service: 's', level: 'info', stream: c2.stream });
    infoLog.debug('d');
    expect(c2.lines).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npx jest tests/utils/teachLogger.test.ts
```
Expected: FAIL — `Cannot find module '../../src/utils/teachLogger'`.

- [ ] **Step 4: Write minimal implementation**

Create `banking_mcp_server/src/utils/teachLogger.ts`:

```typescript
import pino, { Logger } from 'pino';
import { Writable } from 'stream';

export interface TeachLoggerOptions {
  service: string;
  level?: string;        // overrides LOG_LEVEL
  stream?: Writable;     // test injection; default = stdout
  pretty?: boolean;      // human-readable dev output
}

export interface TeachLogger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, err?: unknown, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  step(n: number, total: number, msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): TeachLogger;
}

function resolveLevel(opt?: string): string {
  return opt || process.env.LOG_LEVEL || 'debug';
}

function wrap(p: Logger): TeachLogger {
  return {
    info: (msg, fields) => p.info(fields || {}, msg),
    warn: (msg, fields) => p.warn(fields || {}, msg),
    debug: (msg, fields) => p.debug(fields || {}, msg),
    error: (msg, err, fields) => {
      const base: Record<string, unknown> = { ...(fields || {}) };
      if (err instanceof Error) {
        base.err = { message: err.message, stack: err.stack, cause: (err as any).cause };
      } else if (err !== undefined) {
        base.err = err;
      }
      p.error(base, msg);
    },
    step: (n, total, msg, fields) =>
      p.info({ ...(fields || {}), teach: true }, `[TEACH] step ${n}/${total}: ${msg}`),
    child: (bindings) => wrap(p.child(bindings)),
  };
}

export function createTeachLogger(opts: TeachLoggerOptions): TeachLogger {
  const level = resolveLevel(opts.level);
  // NO redact config — token/claim visibility is an intentional teaching feature.
  const base = { level, base: { service: opts.service } };
  let p: Logger;
  if (opts.stream) {
    p = pino(base, opts.stream);
  } else if (opts.pretty ?? process.env.NODE_ENV !== 'production') {
    p = pino({ ...base, transport: { target: 'pino-pretty', options: { colorize: true } } });
  } else {
    p = pino(base);
  }
  return wrap(p);
}

// Default service-scoped singleton.
export const teachLog = createTeachLogger({ service: 'mcp-server' });
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npx jest tests/utils/teachLogger.test.ts
```
Expected: PASS — 4 tests green.

- [ ] **Step 6: Typecheck**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npm run typecheck
```
Expected: exit 0, no TS errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_mcp_server/package.json banking_mcp_server/package-lock.json banking_mcp_server/src/utils/teachLogger.ts banking_mcp_server/tests/utils/teachLogger.test.ts && git commit -m "feat(mcp-server): add pino-based teachLogger (no redaction, teaching-visible)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migrate banking_mcp_server TokenIntrospector to teachLogger

**Files:**
- Modify: `banking_mcp_server/src/auth/TokenIntrospector.ts` (lines ~33, ~45, ~75-80, ~115 per audit — verify exact lines)
- Test: `banking_mcp_server/tests/auth/TokenIntrospector.teachlog.test.ts`

**REGRESSION_PLAN §1 file.** Will NOT break: introspection request/response logic, `may_act` enforcement, `aud` validation, error throw behavior. Change is logging-call replacement only — `console.log` → `teachLog.step/info`. Token/claim content stays fully visible (teaching).

- [ ] **Step 1: Read current logging sites**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && grep -n "console\.\(log\|error\|warn\)" src/auth/TokenIntrospector.ts
```
Expected: lists the console.* sites (audit cited ~33, ~45, ~75-80, ~115). Record exact line numbers for Step 3.

- [ ] **Step 2: Write the failing test**

Create `banking_mcp_server/tests/auth/TokenIntrospector.teachlog.test.ts`:

```typescript
// Verifies introspection still narrates the teaching steps AND keeps token
// fields visible, with no console.* left in the file.
import { readFileSync } from 'fs';
import { join } from 'path';

describe('TokenIntrospector logging migration', () => {
  it('contains no raw console.* calls', () => {
    const src = readFileSync(
      join(__dirname, '../../src/auth/TokenIntrospector.ts'),
      'utf8',
    );
    const matches = src.match(/console\.(log|error|warn|debug)\(/g) || [];
    expect(matches).toEqual([]);
  });

  it('uses teachLog.step for the introspection teaching moment', () => {
    const src = readFileSync(
      join(__dirname, '../../src/auth/TokenIntrospector.ts'),
      'utf8',
    );
    expect(src).toMatch(/teachLog\.step\(/);
    expect(src).toMatch(/RFC 7662/); // introspection narrated by name
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npx jest tests/auth/TokenIntrospector.teachlog.test.ts
```
Expected: FAIL — `console.*` matches present / no `teachLog.step`.

- [ ] **Step 4: Replace console.* with teachLogger (minimal diff)**

At the top of `src/auth/TokenIntrospector.ts`, add the import (after existing imports):

```typescript
import { teachLog } from '../utils/teachLogger';
```

Replace each console site. Use the exact lines from Step 1. Pattern:

- The clientId/request log (audit ~33) becomes:
```typescript
teachLog.step(1, 3, 'RFC 7662 introspection request', {
  client_id: this.config.clientId,
  endpoint: this.config.introspectionEndpoint,
});
```
- The response-data log (audit ~45) becomes (response stays FULLY visible — teaching):
```typescript
teachLog.step(2, 3, 'RFC 7662 introspection response', {
  introspection: response.data,
});
```
- The result/metadata log (audit ~75-80) becomes:
```typescript
teachLog.step(3, 3, 'introspection result evaluated', {
  active: result.active,
  scope: result.scope,
  aud: result.aud,
  exp: result.exp,
  may_act: result.may_act,
});
```
- The may_act enforcement error (audit ~115) becomes:
```typescript
teachLog.error('may_act enforcement failed', undefined, {
  operation: 'may_act_enforcement',
  expected_client_id: bffClientId,
  actual: result.may_act,
});
```

Do not alter any control flow, throw, or return. Only the logging calls change.

- [ ] **Step 5: Run migration test + existing introspector tests**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npx jest tests/auth/TokenIntrospector.teachlog.test.ts && npx jest --testPathPattern='TokenIntrospector' --testPathIgnorePatterns='teachlog'
```
Expected: migration test PASS; pre-existing TokenIntrospector tests still PASS (behavior unchanged).

- [ ] **Step 6: Typecheck + build**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npm run typecheck && npm run build
```
Expected: exit 0 both; `dist/index.js` regenerated.

- [ ] **Step 7: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_mcp_server/src/auth/TokenIntrospector.ts banking_mcp_server/tests/auth/TokenIntrospector.teachlog.test.ts && git commit -m "refactor(mcp-server): TokenIntrospector logs via teachLogger, narrate RFC 7662

REGRESSION_PLAN §1: introspection/may_act/aud logic unchanged; logging-only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add pino + teachLogger to banking_mcp_gateway

**Files:**
- Modify: `banking_mcp_gateway/package.json`
- Create: `banking_mcp_gateway/src/teachLogger.ts`
- Test: `banking_mcp_gateway/tests/teachLogger.test.ts`

- [ ] **Step 1: Install pino**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npm install pino@^9.5.0 pino-pretty@^13.0.0 --save
```
Expected: exit 0; deps added.

- [ ] **Step 2: Write the failing test**

Create `banking_mcp_gateway/tests/teachLogger.test.ts` — identical body to Task 1 Step 2 test but with import path `'../src/teachLogger'` and `service: 'gateway'` substituted everywhere `'mcp-server'` appears (repeat the full test; do not reference Task 1):

```typescript
import { Writable } from 'stream';
import { createTeachLogger } from '../src/teachLogger';

function capture(): { lines: any[]; stream: Writable } {
  const lines: any[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { lines.push(JSON.parse(chunk.toString())); cb(); },
  });
  return { lines, stream };
}

describe('teachLogger (gateway)', () => {
  it('emits structured info and never redacts a token', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'gateway', level: 'debug', stream });
    const fakeJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.sig';
    log.info('token received', { access_token: fakeJwt });
    expect(lines[0].msg).toBe('token received');
    expect(lines[0].service).toBe('gateway');
    expect(lines[0].access_token).toBe(fakeJwt);
  });
  it('step() emits [TEACH] marker', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'gateway', level: 'debug', stream });
    log.step(2, 6, 'credential disposition selected', { disposition: 'api_key' });
    expect(lines[0].msg).toBe('[TEACH] step 2/6: credential disposition selected');
    expect(lines[0].disposition).toBe('api_key');
    expect(lines[0].teach).toBe(true);
  });
  it('error() captures stack + operation', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'gateway', level: 'debug', stream });
    log.error('token exchange failed', new Error('boom'), { operation: 'rfc8693' });
    expect(lines[0].err.message).toBe('boom');
    expect(lines[0].operation).toBe('rfc8693');
  });
  it('LOG_LEVEL filters debug at info', () => {
    const c = capture();
    const log = createTeachLogger({ service: 'gateway', level: 'info', stream: c.stream });
    log.debug('d');
    expect(c.lines).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx jest tests/teachLogger.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Create the module**

Create `banking_mcp_gateway/src/teachLogger.ts` with the **exact same content** as Task 1 Step 4's `teachLogger.ts`, except the final two lines change to:

```typescript
// Default service-scoped singleton.
export const teachLog = createTeachLogger({ service: 'gateway' });
```

(Copy the full file body from Task 1 Step 4 — `TeachLoggerOptions`, `TeachLogger`, `resolveLevel`, `wrap`, `createTeachLogger` — unchanged; only the singleton `service` differs.)

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx jest tests/teachLogger.test.ts
```
Expected: PASS — 4 green.

- [ ] **Step 6: Typecheck/build**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx tsc --noEmit && npm run build
```
Expected: exit 0; `dist/index.js` present.

- [ ] **Step 7: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_mcp_gateway/package.json banking_mcp_gateway/package-lock.json banking_mcp_gateway/src/teachLogger.ts banking_mcp_gateway/tests/teachLogger.test.ts && git commit -m "feat(gateway): add pino-based teachLogger (no redaction, teaching-visible)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Migrate gateway priority-1 sites (authorize pipeline + credential swap) to teachLogger

**Files:**
- Modify: `banking_mcp_gateway/src/middleware/authorizeMcpRequest.ts` (~line 206 console.error)
- Modify: `banking_mcp_gateway/src/credentialSwap.ts` (swap A/B/C narration sites)
- Modify: `banking_mcp_gateway/src/tokenExchange.ts` (exchange call)
- Test: `banking_mcp_gateway/tests/gateway-teachlog-migration.test.ts`

Will NOT break: routing decisions, credential disposition selection, token-exchange cache (HI-06), Authorize evaluation, D-05 anti-bypass. Logging-only.

- [ ] **Step 1: Enumerate console sites**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && grep -rn "console\.\(log\|error\|warn\|debug\)" src/middleware/authorizeMcpRequest.ts src/credentialSwap.ts src/tokenExchange.ts
```
Expected: prints each site. Record line numbers.

- [ ] **Step 2: Write the failing test**

Create `banking_mcp_gateway/tests/gateway-teachlog-migration.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

const files = [
  'src/middleware/authorizeMcpRequest.ts',
  'src/credentialSwap.ts',
  'src/tokenExchange.ts',
];

describe('gateway priority-1 console migration', () => {
  it.each(files)('%s has no raw console.* calls', (f) => {
    const src = readFileSync(join(__dirname, '..', f), 'utf8');
    expect(src.match(/console\.(log|error|warn|debug)\(/g) || []).toEqual([]);
  });

  it('credentialSwap narrates the disposition with teachLog.step', () => {
    const src = readFileSync(join(__dirname, '../src/credentialSwap.ts'), 'utf8');
    expect(src).toMatch(/teachLog\.step\(/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx jest tests/gateway-teachlog-migration.test.ts
```
Expected: FAIL — console matches present.

- [ ] **Step 4: Migrate each file**

In each of the three files add (after existing imports), adjusting the relative path:

```typescript
import { teachLog } from '../teachLogger';   // credentialSwap.ts, tokenExchange.ts
// authorizeMcpRequest.ts is in src/middleware/, use:
import { teachLog } from '../teachLogger';
```
(`src/middleware/authorizeMcpRequest.ts` → `'../teachLogger'`; `src/credentialSwap.ts` and `src/tokenExchange.ts` → `'./teachLogger'`.)

Replacements (use exact lines from Step 1; control flow unchanged):

- `authorizeMcpRequest.ts` ~206 `console.error('[authorizeMcpRequest] Token exchange failed:', msg)` →
```typescript
teachLog.error('token exchange failed', undefined, {
  operation: 'authorize_token_exchange',
  detail: msg,
});
```
- `credentialSwap.ts` — at each disposition branch (A api_key / B dual_token / C oauth_bearer), replace the existing console (or add if none) with:
```typescript
teachLog.step(1, 1, 'gateway credential disposition selected', {
  tool: toolName,
  disposition,            // 'api_key' | 'dual_token' | 'oauth_bearer' | 'bankingdata'
  backend_aud: backendAud,
});
```
(Use the variable names already in scope in that function; if `backendAud` is not in scope, omit that field — do not introduce new variables.)
- `tokenExchange.ts` — replace any console at the exchange call with:
```typescript
teachLog.step(1, 2, 'RFC 8693 exchange (gateway)', {
  subject_aud: subjectAud,
  target_aud: targetAud,
});
```
then after the response:
```typescript
teachLog.step(2, 2, 'RFC 8693 exchange response (gateway)', {
  token_type: response.data?.token_type,
  expires_in: response.data?.expires_in,
  access_token: response.data?.access_token,  // visible — teaching
});
```
(Only add these if the file already logged here per Step 1; if a site had no console, still add the `step` lines — narration is additive per the design. Use only variables already in scope.)

- [ ] **Step 5: Run migration test + gateway suite**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx jest tests/gateway-teachlog-migration.test.ts && npm test
```
Expected: migration test PASS; existing gateway tests still PASS.

- [ ] **Step 6: Typecheck/build**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx tsc --noEmit && npm run build
```
Expected: exit 0; dist rebuilt.

- [ ] **Step 7: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_mcp_gateway/src/middleware/authorizeMcpRequest.ts banking_mcp_gateway/src/credentialSwap.ts banking_mcp_gateway/src/tokenExchange.ts banking_mcp_gateway/tests/gateway-teachlog-migration.test.ts && git commit -m "refactor(gateway): priority-1 paths log via teachLogger + narrate disposition/exchange

Routing/disposition/cache/Authorize/D-05 logic unchanged; logging-only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Add pino + teachLogger to banking_agent_service and migrate priority-1 sites

**Files:**
- Modify: `banking_agent_service/package.json`
- Create: `banking_agent_service/src/teachLogger.ts`
- Modify: `banking_agent_service/src/agentIdentity.ts` (CC / PKI token acquisition narration)
- Modify: `banking_agent_service/src/reasoningGraph.ts` (~line 25 console.error; reasoning-unavailable signal)
- Modify: `banking_agent_service/src/tokenResolver.ts` (~line 171 console.warn)
- Test: `banking_agent_service/tests/teachLogger.test.ts`

Will NOT break: agent identity acquisition (client_credentials / private_key_jwt), in-flight dedup, reasoning step contract (`{type:'tool_calls'|'final', reasoningUnavailable?}`), heuristic-floor signaling. Logging-only.

- [ ] **Step 1: Install pino**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_agent_service && npm install pino@^9.5.0 pino-pretty@^13.0.0 --save
```
Expected: exit 0.

- [ ] **Step 2: Write the failing test**

Create `banking_agent_service/tests/teachLogger.test.ts` — full body (do not reference other tasks):

```typescript
import { Writable } from 'stream';
import { createTeachLogger } from '../src/teachLogger';

function capture() {
  const lines: any[] = [];
  const stream = new Writable({
    write(chunk, _e, cb) { lines.push(JSON.parse(chunk.toString())); cb(); },
  });
  return { lines, stream };
}

describe('teachLogger (agent-service)', () => {
  it('keeps token visible', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'agent-service', level: 'debug', stream });
    log.info('actor token', { access_token: 'eyJ.a.b' });
    expect(lines[0].service).toBe('agent-service');
    expect(lines[0].access_token).toBe('eyJ.a.b');
  });
  it('step() narrates', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'agent-service', level: 'debug', stream });
    log.step(1, 3, 'client_credentials actor token requested', { scope: 'ai_agent' });
    expect(lines[0].msg).toBe('[TEACH] step 1/3: client_credentials actor token requested');
    expect(lines[0].teach).toBe(true);
  });
  it('error() carries stack', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'agent-service', level: 'debug', stream });
    log.error('reason failed', new Error('x'), { operation: 'reasonOnce' });
    expect(lines[0].err.message).toBe('x');
    expect(lines[0].operation).toBe('reasonOnce');
  });
  it('LOG_LEVEL filters', () => {
    const c = capture();
    const log = createTeachLogger({ service: 'agent-service', level: 'info', stream: c.stream });
    log.debug('d');
    expect(c.lines).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_agent_service && npx jest tests/teachLogger.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Create the module**

Create `banking_agent_service/src/teachLogger.ts` with the **exact same body** as Task 1 Step 4, with the singleton line changed to:

```typescript
export const teachLog = createTeachLogger({ service: 'agent-service' });
```

- [ ] **Step 5: Run to verify it passes**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_agent_service && npx jest tests/teachLogger.test.ts
```
Expected: PASS — 4 green.

- [ ] **Step 6: Migrate the three source files**

Enumerate first:
```bash
cd /Users/curtismuir/Development/banking/banking_agent_service && grep -rn "console\.\(log\|error\|warn\|debug\)" src/agentIdentity.ts src/reasoningGraph.ts src/tokenResolver.ts
```

Add `import { teachLog } from './teachLogger';` after imports in each. Replace:

- `agentIdentity.ts` CC acquisition: add narration at the request and on success:
```typescript
teachLog.step(1, 2, 'client_credentials actor token requested', {
  client_id: clientId,
  scope: 'ai_agent',
  auth_method: usePki ? 'private_key_jwt' : 'client_secret_basic',
});
```
and after token obtained:
```typescript
teachLog.step(2, 2, 'actor token acquired', {
  token_type: tok.token_type,
  expires_in: tok.expires_in,
  access_token: tok.access_token,   // visible — teaching
});
```
(Use only variables already in scope; rename `clientId`/`tok`/`usePki` to match the real local names from Step 6's grep/read. If PKI flag local differs, set `auth_method` from whatever boolean is in scope.)
- `reasoningGraph.ts` ~25 `console.error(...)` →
```typescript
teachLog.error('reasoning step failed', err, { operation: 'reasonOnce' });
```
and where it returns `reasoningUnavailable: true`, precede with:
```typescript
teachLog.step(1, 1, 'reasoning unavailable — BFF heuristic floor will apply', {
  reason: 'helix_unparseable_or_error',
});
```
- `tokenResolver.ts` ~171 `console.warn(...)` →
```typescript
teachLog.warn('token resolution fallback', { detail: String(/* existing message var */) });
```
(use the existing message variable already passed to console.warn).

- [ ] **Step 7: Build + existing tests**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_agent_service && npx tsc --noEmit && npm run build && npm test
```
Expected: exit 0 typecheck/build; existing tests still PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_agent_service/package.json banking_agent_service/package-lock.json banking_agent_service/src/teachLogger.ts banking_agent_service/src/agentIdentity.ts banking_agent_service/src/reasoningGraph.ts banking_agent_service/src/tokenResolver.ts banking_agent_service/tests/teachLogger.test.ts && git commit -m "feat(agent-service): teachLogger + narrate agent identity / reasoning steps

Identity/dedup/reasoning-contract unchanged; logging-only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Add pino + teachLogger (CJS) to banking_api_server

**Files:**
- Modify: `banking_api_server/package.json`
- Create: `banking_api_server/utils/teachLogger.js`
- Test: `banking_api_server/__tests__/utils/teachLogger.test.js`

(Note: this service has `utils/logger.js` already; teachLogger is **additive** in Phase 1 — we do not replace `logger.js` or Morgan here. We only introduce the module and migrate the priority-1 RFC 8693 path in Task 7.)

- [ ] **Step 1: Install pino**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_api_server && npm install pino@^9.5.0 pino-pretty@^13.0.0 --save
```
Expected: exit 0.

- [ ] **Step 2: Confirm test location convention**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_api_server && ls __tests__ 2>/dev/null | head; cat jest.config.js 2>/dev/null | grep -i testmatch -A2
```
Expected: shows test dir/pattern. If tests live elsewhere (e.g. `tests/`), use that directory for the test file path in Step 3 instead of `__tests__/utils/`.

- [ ] **Step 3: Write the failing test**

Create `banking_api_server/__tests__/utils/teachLogger.test.js` (adjust dir per Step 2):

```javascript
const { Writable } = require('stream');
const { createTeachLogger } = require('../../utils/teachLogger');

function capture() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _e, cb) { lines.push(JSON.parse(chunk.toString())); cb(); },
  });
  return { lines, stream };
}

describe('teachLogger (api-server)', () => {
  it('keeps token visible (no redaction)', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'api-server', level: 'debug', stream });
    log.info('exchange', { access_token: 'eyJ.h.s', act: { sub: 'agent1' } });
    expect(lines[0].service).toBe('api-server');
    expect(lines[0].access_token).toBe('eyJ.h.s');
    expect(lines[0].act.sub).toBe('agent1');
  });
  it('step() narrates RFC 8693', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'api-server', level: 'debug', stream });
    log.step(4, 9, 'RFC 8693 subject+actor exchange', { resource: 'mcp' });
    expect(lines[0].msg).toBe('[TEACH] step 4/9: RFC 8693 subject+actor exchange');
    expect(lines[0].teach).toBe(true);
  });
  it('error() carries cause+stack+operation', () => {
    const { lines, stream } = capture();
    const log = createTeachLogger({ service: 'api-server', level: 'debug', stream });
    log.error('exchange failed', new Error('bad'), { operation: 'rfc8693' });
    expect(lines[0].err.message).toBe('bad');
    expect(typeof lines[0].err.stack).toBe('string');
    expect(lines[0].operation).toBe('rfc8693');
  });
  it('LOG_LEVEL filters debug at info', () => {
    const c = capture();
    const log = createTeachLogger({ service: 'api-server', level: 'info', stream: c.stream });
    log.debug('d');
    expect(c.lines).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_api_server && npx jest __tests__/utils/teachLogger.test.js
```
Expected: FAIL — module not found.

- [ ] **Step 5: Create the CJS module**

Create `banking_api_server/utils/teachLogger.js`:

```javascript
'use strict';
const pino = require('pino');

function resolveLevel(opt) {
  return opt || process.env.LOG_LEVEL || 'debug';
}

function wrap(p) {
  return {
    info: (msg, fields) => p.info(fields || {}, msg),
    warn: (msg, fields) => p.warn(fields || {}, msg),
    debug: (msg, fields) => p.debug(fields || {}, msg),
    error: (msg, err, fields) => {
      const base = Object.assign({}, fields || {});
      if (err instanceof Error) {
        base.err = { message: err.message, stack: err.stack, cause: err.cause };
      } else if (err !== undefined) {
        base.err = err;
      }
      p.error(base, msg);
    },
    step: (n, total, msg, fields) =>
      p.info(Object.assign({}, fields || {}, { teach: true }),
        `[TEACH] step ${n}/${total}: ${msg}`),
    child: (bindings) => wrap(p.child(bindings)),
  };
}

function createTeachLogger(opts) {
  const level = resolveLevel(opts && opts.level);
  // NO redact config — token/claim visibility is an intentional teaching feature.
  const base = { level, base: { service: (opts && opts.service) || 'api-server' } };
  let p;
  if (opts && opts.stream) {
    p = pino(base, opts.stream);
  } else if ((opts && opts.pretty) || process.env.NODE_ENV !== 'production') {
    p = pino(Object.assign({}, base, {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }));
  } else {
    p = pino(base);
  }
  return wrap(p);
}

const teachLog = createTeachLogger({ service: 'api-server' });

module.exports = { createTeachLogger, teachLog };
```

- [ ] **Step 6: Run to verify it passes**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_api_server && npx jest __tests__/utils/teachLogger.test.js
```
Expected: PASS — 4 green.

- [ ] **Step 7: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_api_server/package.json banking_api_server/package-lock.json banking_api_server/utils/teachLogger.js banking_api_server/__tests__/utils/teachLogger.test.js && git commit -m "feat(api-server): add pino-based teachLogger (CJS, no redaction, additive)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Narrate the BFF RFC 8693 exchange via teachLogger

**Files:**
- Modify: `banking_api_server/services/rfc8693TokenExchangeService.js` (~lines 74-122 per audit/spec Appendix A — verify)
- Test: `banking_api_server/__tests__/services/rfc8693.teachlog.test.js` (adjust dir per Task 6 Step 2)

This is the headline teaching moment (Stage 4). NOT a §1 file per the regression table, but it is delegation-critical: will NOT change exchange request construction, `act` validation, scope narrowing, or return value — narration is **additive** log lines only.

- [ ] **Step 1: Read the exchange site**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_api_server && grep -n "grant-type:token-exchange\|subject_token\|actor_token\|act\b\|console\." services/rfc8693TokenExchangeService.js | head -30
```
Expected: shows the request build (~74-90), act validation (~115-122). Record exact lines.

- [ ] **Step 2: Write the failing test**

Create `banking_api_server/__tests__/services/rfc8693.teachlog.test.js`:

```javascript
const { readFileSync } = require('fs');
const { join } = require('path');

describe('rfc8693TokenExchangeService narration', () => {
  const src = readFileSync(
    join(__dirname, '../../services/rfc8693TokenExchangeService.js'),
    'utf8',
  );
  it('imports teachLogger', () => {
    expect(src).toMatch(/require\(['"]\.\.\/utils\/teachLogger['"]\)/);
  });
  it('narrates the RFC 8693 request and response steps', () => {
    expect(src).toMatch(/teachLog\.step\([^)]*RFC 8693[^)]*REQUEST/i);
    expect(src).toMatch(/teachLog\.step\([^)]*RFC 8693[^)]*RESPONSE/i);
  });
  it('narrates the claims delta (aud/scope/act)', () => {
    expect(src).toMatch(/claims delta/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_api_server && npx jest __tests__/services/rfc8693.teachlog.test.js
```
Expected: FAIL — no teachLogger import / no narration.

- [ ] **Step 4: Add additive narration**

Add near the top (after existing requires):
```javascript
const { teachLog } = require('../utils/teachLogger');
```

Immediately before the axios/token-endpoint call that sends the exchange (exact line from Step 1), add:
```javascript
teachLog.step(4, 9, 'RFC 8693 subject+actor exchange REQUEST', {
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  actor_token_type: actorToken
    ? 'urn:ietf:params:oauth:token-type:access_token'
    : undefined,
  resource,
  scope: requestedScope,
  subject_token: subjectToken,   // visible — teaching
  actor_token: actorToken,       // visible — teaching
});
```
(Use the actual in-scope variable names from Step 1 — `subjectToken`, `actorToken`, `resource`, `requestedScope` may differ; substitute the real ones. Do not introduce new variables or change the request object.)

Immediately after the response is received and before the existing return, add:
```javascript
teachLog.step(5, 9, 'RFC 8693 exchange RESPONSE', {
  token_type: resp.data && resp.data.token_type,
  expires_in: resp.data && resp.data.expires_in,
  access_token: resp.data && resp.data.access_token,  // visible — teaching
});
teachLog.step(6, 9, 'claims delta (delegation)', {
  before: { aud: subjectClaims && subjectClaims.aud, scope: subjectClaims && subjectClaims.scope, sub: subjectClaims && subjectClaims.sub },
  after: { aud: exchangedClaims && exchangedClaims.aud, scope: exchangedClaims && exchangedClaims.scope, sub: exchangedClaims && exchangedClaims.sub, act: exchangedClaims && exchangedClaims.act },
  why: 'audience narrowed to resource; act added = agent acting on behalf of user',
});
```
(`subjectClaims`/`exchangedClaims`: if the service already decodes these, reuse those variables; if it decodes only the exchanged token, decode the subject token with the existing decode util already imported in the file — do NOT add a new dependency. If neither is readily in scope, log the raw `subject_token`/`access_token` only and set `before/after` to `undefined` rather than introducing decode logic — narration must not change behavior.)

- [ ] **Step 5: Run narration test + existing rfc8693 tests**

Run:
```bash
cd /Users/curtismuir/Development/banking/banking_api_server && npx jest __tests__/services/rfc8693.teachlog.test.js && npx jest --testPathPattern='rfc8693|tokenExchange' --testPathIgnorePatterns='teachlog'
```
Expected: narration test PASS; existing exchange tests still PASS (behavior unchanged).

- [ ] **Step 6: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add banking_api_server/services/rfc8693TokenExchangeService.js banking_api_server/__tests__/services/rfc8693.teachlog.test.js && git commit -m "feat(api-server): narrate RFC 8693 exchange (request/response/claims-delta)

Additive logging only; exchange request, act validation, scope narrowing,
return value all unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Disable Python SensitiveDataFilter (teaching-visible logs)

**Files:**
- Modify: `langchain_agent/src/log_utils/structured_logger.py:329,363-374`
- Test: `langchain_agent/tests/test_logging_visibility.py`

REGRESSION_PLAN: this intentionally reverses the BL-02 redaction filter wiring **for the documented teaching reason**. Will NOT change log structure, levels, handlers, or the third-party logger level overrides — only the `SensitiveDataFilter` attachment is removed. `LOG_LEVEL` behavior preserved. Add a §4 Bug Fix Log entry (Task 10).

- [ ] **Step 1: Write the failing test**

Create `langchain_agent/tests/test_logging_visibility.py`:

```python
import logging
import importlib
from io import StringIO


def test_sensitive_data_filter_not_attached(monkeypatch):
    """Teaching demo: tokens/claims must appear verbatim in logs."""
    from src.log_utils import structured_logger
    importlib.reload(structured_logger)

    buf = StringIO()
    # Re-run setup, then redirect root handler to our buffer.
    structured_logger.setup_logging(level="DEBUG", format_type="structured")
    root = logging.getLogger()
    # No SensitiveDataFilter should be present on root or its handlers.
    for h in root.handlers:
        names = [type(f).__name__ for f in h.filters]
        assert "SensitiveDataFilter" not in names
    root_filter_names = [type(f).__name__ for f in root.filters]
    assert "SensitiveDataFilter" not in root_filter_names

    # And a JWT-looking string passes through unmodified.
    for h in list(root.handlers):
        root.removeHandler(h)
    handler = logging.StreamHandler(buf)
    handler.setLevel(logging.DEBUG)
    root.addHandler(handler)
    logging.getLogger("t").debug("token=eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.sig")
    assert "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.sig" in buf.getvalue()
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/langchain_agent && python -m pytest tests/test_logging_visibility.py -v
```
Expected: FAIL — `SensitiveDataFilter` still attached (assertion fails).

- [ ] **Step 3: Remove the filter wiring**

In `langchain_agent/src/log_utils/structured_logger.py`, in `setup_logging`:

- Delete the import line (329): `from .secure_logger import SensitiveDataFilter`
- Delete the BL-02 block (lines ~363-374): the comment, `redaction_filter = SensitiveDataFilter()`, `console_handler.addFilter(redaction_filter)`, `file_handler.addFilter(redaction_filter)`, the belt-and-braces comment, and `root_logger.addFilter(redaction_filter)`.
- Replace with a single explanatory comment:
```python
    # Teaching demo: tokens/claims are an intentional educational surface
    # (see docs/superpowers/specs/2026-05-15-logging-as-teaching-surface-design.md).
    # SensitiveDataFilter is deliberately NOT attached so logs show the full
    # OAuth/RFC 8693 story. REGRESSION_PLAN §4 entry: logging-phase1-unredact.
```
Leave the websockets/aiohttp/urllib3 level overrides and handler setup exactly as-is. Do not delete `secure_logger.py` (kept for reference / potential future toggle).

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
cd /Users/curtismuir/Development/banking/langchain_agent && python -m pytest tests/test_logging_visibility.py -v
```
Expected: PASS.

- [ ] **Step 5: Run the existing langchain_agent test suite**

Run:
```bash
cd /Users/curtismuir/Development/banking/langchain_agent && python -m pytest -q
```
Expected: no NEW failures versus baseline (run `git stash && python -m pytest -q` first if unsure of baseline, then `git stash pop`).

- [ ] **Step 6: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add langchain_agent/src/log_utils/structured_logger.py langchain_agent/tests/test_logging_visibility.py && git commit -m "feat(langchain): disable SensitiveDataFilter — logs are a teaching surface

Structure/levels/handlers unchanged; only redaction filter wiring removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Fix the Python DEBUG agent-token log lines

**Files:**
- Modify: `langchain_agent/src/agent/mcp_tool_provider.py:613,614,620,982`
- Test: `langchain_agent/tests/test_agent_token_log_lines.py`

These lines today print `AccessToken(***masked***)` (useless) because `AccessToken.__str__` masks. Fix = use `.masked_fingerprint()` (stable `sha256:<12>` correlation tag) like the existing line 334. We deliberately do NOT print the raw JWT here — it is already fully visible on the Token Chain / SSE teaching surfaces, and `auth.py:113` BL-01 stays intact. This is the §4 Bug Fix Log item.

- [ ] **Step 1: Write the failing test**

Create `langchain_agent/tests/test_agent_token_log_lines.py`:

```python
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "agent" / "mcp_tool_provider.py"


def test_token_debug_lines_use_masked_fingerprint():
    text = SRC.read_text()
    # The four known sites must not interpolate the bare token object,
    # which would print the useless 'AccessToken(***masked***)' literal.
    bad = re.findall(r'logger\.debug\(f"[^"]*\{self\._current_agent_token\}', text)
    assert bad == [], f"bare token interpolation still present: {bad}"
    bad2 = re.findall(r'logger\.debug\(f"[^"]*\{agent_token\}', text)
    assert bad2 == [], f"bare agent_token interpolation still present: {bad2}"
    # Fingerprint helper is used for token references in debug lines.
    assert "masked_fingerprint()" in text
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
cd /Users/curtismuir/Development/banking/langchain_agent && python -m pytest tests/test_agent_token_log_lines.py -v
```
Expected: FAIL — bare `{self._current_agent_token}` / `{agent_token}` present at 613/614/620/982.

- [ ] **Step 3: Fix the four lines**

In `langchain_agent/src/agent/mcp_tool_provider.py`, replace exactly:

- Line 613:
```python
        logger.debug(f"Previous agent token: {self._current_agent_token.masked_fingerprint() if self._current_agent_token else 'none'}")
```
- Line 614:
```python
        logger.debug(f"New agent token: {agent_token.masked_fingerprint() if agent_token else 'none'}")
```
- Line 620:
```python
        logger.debug(f"Tool {self.name} now has session_id={self._current_session_id}, token={self._current_agent_token.masked_fingerprint() if self._current_agent_token else 'none'}")
```
- Line 982:
```python
            logger.debug(f"Agent token details: {self._current_agent_token.masked_fingerprint() if self._current_agent_token else 'none'}")
```

Change nothing else (line 1002 already uses a boolean — leave it).

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
cd /Users/curtismuir/Development/banking/langchain_agent && python -m pytest tests/test_agent_token_log_lines.py -v
```
Expected: PASS.

- [ ] **Step 5: Sanity-run the module import**

Run:
```bash
cd /Users/curtismuir/Development/banking/langchain_agent && python -c "import ast,sys; ast.parse(open('src/agent/mcp_tool_provider.py').read()); print('syntax ok')"
```
Expected: `syntax ok`.

- [ ] **Step 6: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add langchain_agent/src/agent/mcp_tool_provider.py langchain_agent/tests/test_agent_token_log_lines.py && git commit -m "fix(langchain): DEBUG token lines use masked_fingerprint (were useless masked literal)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: REGRESSION_PLAN §4 Bug Fix Log entry + verification sweep

**Files:**
- Modify: `REGRESSION_PLAN.md` (§4 Bug Fix Log)

- [ ] **Step 1: Locate the §4 template**

Run:
```bash
cd /Users/curtismuir/Development/banking && grep -n "## 4\|### 4\|Bug Fix Log" REGRESSION_PLAN.md | head
```
Expected: shows the §4 heading and the most recent entry format to mirror.

- [ ] **Step 2: Append the entry**

Add a new §4 entry mirroring the existing template style, with content:

- **Title:** Logging Phase 1 — teachLogger introduced; Python redaction disabled (teaching surface)
- **Date:** 2026-05-16
- **Symptom/Reason:** Logging was inconsistent (3 different loggers, ~2300 console.* sites) and the Python `SensitiveDataFilter` plus DEBUG token f-strings masked the very tokens/claims the demo exists to teach.
- **Root cause:** Production threat model applied to an educational demo; no shared logger.
- **Fix:** Added pino-based `teachLogger` (no redaction) to mcp-server/gateway/agent-service/api-server; migrated priority-1 auth/exchange paths; disabled `SensitiveDataFilter`; replaced 4 useless masked token f-strings with `masked_fingerprint()`.
- **Not broken (verified):** TokenIntrospector introspection/may_act/aud logic; gateway routing/disposition/cache/D-05; agent identity/dedup/reasoning contract; BFF RFC 8693 request/act/scope-narrowing/return; Python log structure/levels/handlers.
- **Tests:** `teachLogger` suites (4 services), `TokenIntrospector.teachlog`, gateway migration, `rfc8693.teachlog`, `test_logging_visibility.py`, `test_agent_token_log_lines.py`.

- [ ] **Step 3: Full verification sweep**

Run each and confirm:
```bash
cd /Users/curtismuir/Development/banking/banking_mcp_server && npm run typecheck && npm run build && npx jest tests/utils/teachLogger.test.ts tests/auth/TokenIntrospector.teachlog.test.ts
cd /Users/curtismuir/Development/banking/banking_mcp_gateway && npx tsc --noEmit && npm run build && npx jest tests/teachLogger.test.ts tests/gateway-teachlog-migration.test.ts
cd /Users/curtismuir/Development/banking/banking_agent_service && npx tsc --noEmit && npm run build && npx jest tests/teachLogger.test.ts
cd /Users/curtismuir/Development/banking/banking_api_server && npx jest __tests__/utils/teachLogger.test.js __tests__/services/rfc8693.teachlog.test.js
cd /Users/curtismuir/Development/banking/langchain_agent && python -m pytest tests/test_logging_visibility.py tests/test_agent_token_log_lines.py -q
```
Expected: all green, all builds exit 0.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run:
```bash
cd /Users/curtismuir/Development/banking && export VAULT_PASSWORD="$VAULT_PASSWORD"; ./run-demo.sh restart && sleep 25 && ./run-demo.sh status
```
Then trigger one agent tool call from `https://api.ping.demo:4000/dashboard` and:
```bash
grep -l "\[TEACH\]" /tmp/bank-*.log
```
Expected: services healthy; `[TEACH]` markers present in mcp-server / gateway / agent-service / api-server logs; tokens visible (not redacted) in the lines.

- [ ] **Step 5: Commit**

```bash
cd /Users/curtismuir/Development/banking && git add REGRESSION_PLAN.md && git commit -m "docs(regression): §4 Bug Fix Log — Logging Phase 1 teachLogger + un-redact

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Phase 1 scope from §8):**
- "Introduce teachLogger (pino core, structured-diagnostic + narration API) per Node/TS service" → Tasks 1, 3, 5, 6 ✅
- "migrating the priority-1 paths (auth/OAuth/token-exchange/MCP-dispatch/consent) off console.*" → Tasks 2, 4, 5, 7 ✅ (MCP-dispatch = TokenIntrospector + gateway authorize; token-exchange = rfc8693 + gateway tokenExchange; consent/HITL gateway sites are in Task 4's authorize file)
- "disable Python SensitiveDataFilter" → Task 8 ✅
- "fix Python DEBUG f-string masking bug (§4 entry)" → Task 9 + §4 entry Task 10 ✅
- "No correlation yet" → no correlation work included ✅ (Phase 2)
- "Visibility + debuggability regression tests added" → every teachLogger test asserts token visible; error() carries cause+stack+operation tested ✅
- §2 `console.*` policy gate (lint) → deferred to Phase 3 per spec §8 ("enable the console.* policy lint/grep gate" is Phase 3) ✅ correctly out of Phase 1
- No-redaction config requirement → asserted in every `createTeachLogger` test ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Where exact line numbers can't be known without reading (audit gave approximate lines), the step explicitly instructs to grep/read first and substitute real in-scope variable names — this is a deliberate instruction, not a placeholder, because the audit's line numbers are ~approximate and the engineer must verify against current source.

**Type/name consistency:** `createTeachLogger` / `teachLog` / `.step(n,total,msg,fields)` / `.error(msg,err,fields)` / `.child(bindings)` identical across Tasks 1,3,5 (TS) and Task 6 (CJS). Test capture helper identical shape across all. `service` values: `mcp-server`, `gateway`, `agent-service`, `api-server` — used consistently in each task's singleton + tests.

**Known approximation (called out, not a defect):** audit line numbers (TokenIntrospector ~33/45/75-80/115; rfc8693 ~74-122; agent-service sites) are approximate; every relevant task starts with a grep/read step to pin exact lines and real variable names before editing. This is required because the spec's Appendix A explicitly carries the `~file:line` caveat.
