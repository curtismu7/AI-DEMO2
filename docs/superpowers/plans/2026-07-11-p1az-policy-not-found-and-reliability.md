# P1AZ Policy-Not-Found + Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface "Policy not found, please contact administrator." when P1AZ lacks a needed policy (404 or NOT_APPLICABLE), and harden the P1AZ cloud path (token cache, tighter timeout + retry, circuit breaker, preflight drift check, fallback-by-default) so P1AZ problems never stall the demo.

**Architecture:** All decision-path changes live in `demo_api_server/services/pingOneAuthorizeService.js` (detection, cache, retry, breaker, readiness) with small branches in the two gate services and a UI error-ladder branch. No decision semantics change: PERMIT/DENY/obligations untouched; only the literal `NOT_APPLICABLE` effect and HTTP 404 get new handling.

**Tech Stack:** Node (CommonJS) BFF, Jest, React (CRA-style) UI.

**Specs:** `docs/superpowers/specs/2026-07-11-p1az-policy-not-found-design.md`, `docs/superpowers/specs/2026-07-11-p1az-reliability-design.md`

## Global Constraints

- **Worktree required:** all edits in a git worktree (repo hook blocks main-checkout edits). Branch: `feat/p1az-policy-not-found-reliability`.
- Worktree needs symlinked `node_modules` (root, `demo_api_ui`, `demo_api_server`, `demo_mcp_gateway`).
- Jest from worktree: `./node_modules/.bin/jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath <file>` (run from `demo_api_server/`).
- Emoji rule: only `⚠️ ✅ ❌ 🔐 ✕ ✓` allowed in code/UI text.
- Minimal diff; stage explicitly (`git add <files>`), never `git add -A`.
- Exact user-facing copy: `Policy not found, please contact administrator.`
- Error code (both gates + UI): `policy_not_found`. Block status: 503.
- Gateway (`demo_mcp_gateway/`) and mock authz (`demo_authz_server/`) untouched.
- Pre-commit hook regenerates `mcp-tool-schemas.json` when `configStore.js` is staged — expected, include it in the commit.

---

### Task 1: Detection — NOT_APPLICABLE normalization + 404 tagging

**Files:**
- Modify: `demo_api_server/services/pingOneAuthorizeService.js:181-189` (`_normalizeDecision`), `:216-219` (`_postDecisionEndpoint` error), `:411-414` (`_evaluateViaPdp` error)
- Test: `demo_api_server/src/__tests__/pingOneAuthorize.policyNotFound.test.js` (new)

**Interfaces:**
- Produces: `_normalizeDecision(raw)` may now return `'NOT_APPLICABLE'` (only for literal `not_applicable` effect). Decision-call errors carry `err.code === 'policy_not_found'` and `err.status === 404` on HTTP 404. Task 6 consumes both.

- [ ] **Step 1: Write failing tests**

```js
/**
 * @file pingOneAuthorize.policyNotFound.test.js
 * NOT_APPLICABLE normalization + 404 → err.code='policy_not_found'.
 */
process.env.PINGONE_ENVIRONMENT_ID = 'env-test';
process.env.PINGONE_WORKER_CLIENT_ID = 'cid';
process.env.PINGONE_WORKER_CLIENT_SECRET = 'secret';

const svc = require('../../services/pingOneAuthorizeService');

const tokenResponse = () => ({
  ok: true, status: 200,
  json: async () => ({ access_token: 'tok', expires_in: 3600 }),
});

afterEach(() => { jest.restoreAllMocks(); delete globalThis.fetch; });

describe('_normalizeDecision NOT_APPLICABLE', () => {
  it('maps literal NOT_APPLICABLE to NOT_APPLICABLE', () => {
    expect(svc._normalizeDecision({ decision: 'NOT_APPLICABLE' })).toBe('NOT_APPLICABLE');
    expect(svc._normalizeDecision({ decision: 'not_applicable' })).toBe('NOT_APPLICABLE');
  });
  it('still collapses other unknown effects to DENY (fail-closed)', () => {
    expect(svc._normalizeDecision({ decision: 'BANANA' })).toBe('DENY');
    expect(svc._normalizeDecision({})).toBe('DENY');
    expect(svc._normalizeDecision({ decision: '' })).toBe('DENY');
  });
  it('PERMIT/DENY unchanged', () => {
    expect(svc._normalizeDecision({ decision: 'PERMIT' })).toBe('PERMIT');
    expect(svc._normalizeDecision({ decision: 'deny' })).toBe('DENY');
  });
});

describe('404 tagging', () => {
  it('tags decision-endpoint 404 with code=policy_not_found', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: false, status: 404, text: async () => 'NOT_FOUND' });
    await expect(
      svc.evaluateTransaction({ decisionEndpointId: 'missing-id', userId: 'u1', amount: 1, type: 'transfer' }),
    ).rejects.toMatchObject({ code: 'policy_not_found', status: 404 });
  });
  it('does NOT tag a 500', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const err = await svc.evaluateTransaction({ decisionEndpointId: 'ep', userId: 'u1', amount: 1, type: 'transfer' })
      .catch((e) => e);
    expect(err.code).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd demo_api_server && ../node_modules/.bin/jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath src/__tests__/pingOneAuthorize.policyNotFound.test.js` → FAIL (NOT_APPLICABLE → 'DENY'; no `code` on 404 error). NOTE: check whether jest binary lives at `./node_modules/.bin/jest` inside `demo_api_server/` or repo root; use whichever exists.

- [ ] **Step 3: Implement**

In `_normalizeDecision` (after the DENY check, before the fallback return):

```js
  if (_PERMIT_EFFECTS.has(value)) return 'PERMIT';
  if (_DENY_EFFECTS.has(value)) return 'DENY';
  // Explicit XACML "no policy matched" — surfaced so callers can tell the
  // operator the code/P1AZ policy drifted. Anything else still fails closed.
  if (value === 'not_applicable') return 'NOT_APPLICABLE';
  return hasObligation ? 'INDETERMINATE' : 'DENY';
```

In `_postDecisionEndpoint` replace the `!response.ok` throw:

```js
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`PingOne Authorize decision endpoint evaluation failed (${response.status}): ${text}`);
    error.status = response.status;
    if (response.status === 404) error.code = 'policy_not_found';
    throw error;
  }
```

Same change in `_evaluateViaPdp` (message prefix `PingOne Authorize PDP evaluation failed`).

- [ ] **Step 4: Re-run test** → PASS
- [ ] **Step 5: Commit** — `git add demo_api_server/services/pingOneAuthorizeService.js demo_api_server/src/__tests__/pingOneAuthorize.policyNotFound.test.js && git commit -m "feat(authorize): detect policy-not-found (404 + NOT_APPLICABLE) in P1AZ client"`

---

### Task 2: Worker token cache (+ 401 refresh retry)

**Files:**
- Modify: `demo_api_server/services/pingOneAuthorizeService.js:131-165` (`getWorkerToken`), `_postDecisionEndpoint`, `_evaluateViaPdp`; exports block (~`:1010`)
- Test: `demo_api_server/src/__tests__/pingOneAuthorize.reliability.test.js` (new)

**Interfaces:**
- Produces: `getWorkerToken()` (same signature, now cached); `_resetAuthorizeRuntimeState()` exported for tests (also resets breaker state in Task 4).

- [ ] **Step 1: Failing tests** (in new `pingOneAuthorize.reliability.test.js`, same env-var header + `tokenResponse` helper as Task 1):

```js
describe('worker token cache', () => {
  beforeEach(() => svc._resetAuthorizeRuntimeState());
  it('reuses the token until expiry', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(tokenResponse());
    await svc.getWorkerToken();
    await svc.getWorkerToken();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it('refreshes and retries once on 401 from a decision call', async () => {
    const permit = { ok: true, status: 200, json: async () => ({ decision: 'PERMIT' }) };
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())                                   // token
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'expired' }) // decision 401
      .mockResolvedValueOnce(tokenResponse())                                   // fresh token
      .mockResolvedValueOnce(permit);                                           // retried decision
    const r = await svc.evaluateTransaction({ decisionEndpointId: 'ep', userId: 'u1', amount: 1, type: 'transfer' });
    expect(r.decision).toBe('PERMIT');
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Run** → FAIL (`_resetAuthorizeRuntimeState` undefined; 2 token calls; 401 propagates).

- [ ] **Step 3: Implement**

Module state above `getWorkerToken`:

```js
// Worker-token cache: client-credentials tokens are env-wide, so one cached
// token serves every decision call until 60s before expiry. Cleared on 401.
let _workerTokenCache = { token: null, expiresAt: 0 };
function _clearWorkerTokenCache() { _workerTokenCache = { token: null, expiresAt: 0 }; }
```

At the top of `getWorkerToken()`:

```js
  if (_workerTokenCache.token && Date.now() < _workerTokenCache.expiresAt) {
    return _workerTokenCache.token;
  }
```

After `access_token` validation, before `return data.access_token;`:

```js
  const ttlMs = (Number(data.expires_in) || 300) * 1000;
  _workerTokenCache = { token: data.access_token, expiresAt: Date.now() + ttlMs - 60_000 };
```

401 retry — in `_postDecisionEndpoint`, wrap the fetch so a 401 with a cached token clears the cache and re-issues once. Extract the POST into a small closure:

```js
  const post = async () => {
    const workerToken = await getWorkerToken();
    return fetchT(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parameters }),
    });
  };
  let response = await post();
  if (response.status === 401) {
    _clearWorkerTokenCache();
    response = await post();
  }
```

(The existing `const workerToken = await getWorkerToken();` line at `:200` moves inside `post()`.) Apply the same pattern in `_evaluateViaPdp`.

Export a combined test-reset hook (extended in Task 4):

```js
function _resetAuthorizeRuntimeState() { _clearWorkerTokenCache(); }
```

Add `_resetAuthorizeRuntimeState` to `module.exports`.

- [ ] **Step 4: Run tests (Task 1 + Task 2 files)** → PASS. Task 1 tests still pass because its mocks return a fresh token first and `_resetAuthorizeRuntimeState()` must be added to that file's `beforeEach` too — do it.
- [ ] **Step 5: Commit** — `feat(authorize): cache worker token with 401 refresh retry`

---

### Task 3: Tighter timeout + single retry in fetchT

**Files:**
- Modify: `demo_api_server/services/pingOneAuthorizeService.js:50-53`
- Test: append to `pingOneAuthorize.reliability.test.js`

**Interfaces:**
- Produces: `fetchT` retries once on network error/timeout or 5xx; default timeout 5000ms (env `PINGONE_AUTHZ_TIMEOUT_MS` still wins).

- [ ] **Step 1: Failing tests**

```js
describe('fetchT retry', () => {
  beforeEach(() => svc._resetAuthorizeRuntimeState());
  it('retries once on network error', async () => {
    const permit = { ok: true, status: 200, json: async () => ({ decision: 'PERMIT' }) };
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(permit);
    const r = await svc.evaluateTransaction({ decisionEndpointId: 'ep', userId: 'u1', amount: 1, type: 'transfer' });
    expect(r.decision).toBe('PERMIT');
  });
  it('retries once on 5xx, then succeeds', async () => {
    const permit = { ok: true, status: 200, json: async () => ({ decision: 'PERMIT' }) };
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' })
      .mockResolvedValueOnce(permit);
    const r = await svc.evaluateTransaction({ decisionEndpointId: 'ep', userId: 'u1', amount: 1, type: 'transfer' });
    expect(r.decision).toBe('PERMIT');
  });
  it('does NOT retry a 404', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: false, status: 404, text: async () => 'nope' });
    await expect(svc.evaluateTransaction({ decisionEndpointId: 'ep', userId: 'u1', amount: 1, type: 'transfer' }))
      .rejects.toMatchObject({ code: 'policy_not_found' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // token + one decision call
  });
});
```

- [ ] **Step 2: Run** → first two FAIL.

- [ ] **Step 3: Implement** — replace `fetchT`:

```js
const AUTHZ_FETCH_TIMEOUT_MS = Number(process.env.PINGONE_AUTHZ_TIMEOUT_MS) || 5000;
async function fetchT(url, opts = {}) {
  const attempt = () =>
    globalThis.fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(AUTHZ_FETCH_TIMEOUT_MS) });
  // One retry on transient failure (network/timeout or 5xx) so a single blip
  // doesn't trip failover mid-demo. 4xx is never retried — it won't change.
  try {
    const response = await attempt();
    if (response.status >= 500) return attempt();
    return response;
  } catch (_transientErr) {
    return attempt();
  }
}
```

Update the comment block above it (mentions 15s default). Keep the doc line: caller-supplied signal still wins.

- [ ] **Step 4: Run reliability test file** → PASS. Also re-run Task 1 file (its 500 test now expects TWO decision attempts — adjust that test's `.mockResolvedValue` (persistent) form already tolerates this; verify).
- [ ] **Step 5: Commit** — `feat(authorize): 5s default timeout + single transient retry on P1AZ calls`

---

### Task 4: Circuit breaker

**Files:**
- Modify: `demo_api_server/services/pingOneAuthorizeService.js` — `evaluateTransaction` (~`:444-472`) and `evaluateMcpToolDelegation` (~`:277`); `_resetAuthorizeRuntimeState`
- Test: append to `pingOneAuthorize.reliability.test.js`

**Interfaces:**
- Produces: after 3 consecutive evaluate failures, evaluate calls throw immediately for 60s with `err.code = 'authorize_circuit_open'`. `policy_not_found` errors do not count. Task 6 consumes the code for fallback-signal enrichment (existing catch blocks already treat any throw as failover).

- [ ] **Step 1: Failing tests**

```js
describe('circuit breaker', () => {
  beforeEach(() => svc._resetAuthorizeRuntimeState());
  const fail500 = () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
  };
  const evalOnce = () =>
    svc.evaluateTransaction({ decisionEndpointId: 'ep', userId: 'u1', amount: 1, type: 'transfer' }).catch((e) => e);

  it('opens after 3 consecutive failures and fails fast', async () => {
    fail500();
    await evalOnce(); await evalOnce(); await evalOnce();
    const fetchCallsBefore = globalThis.fetch.mock.calls.length;
    const err = await evalOnce();
    expect(err.code).toBe('authorize_circuit_open');
    expect(globalThis.fetch.mock.calls.length).toBe(fetchCallsBefore); // no network call
  });
  it('policy_not_found does not trip the breaker', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: false, status: 404, text: async () => 'nope' });
    await evalOnce(); await evalOnce(); await evalOnce();
    const err = await evalOnce();
    expect(err.code).toBe('policy_not_found'); // still live, not circuit_open
  });
  it('success resets the count', async () => {
    fail500();
    await evalOnce(); await evalOnce();
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ decision: 'PERMIT' }) });
    await evalOnce(); // success
    fail500();
    const err = await evalOnce();
    expect(err.code).toBeUndefined(); // count restarted — breaker not open yet
  });
});
```

(Token cache note: after Task 2 the token fetch happens once per test thanks to `_resetAuthorizeRuntimeState` in `beforeEach`; subsequent evaluates reuse it, hence single `tokenResponse()` mocks.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — module state + wrapper:

```js
// Circuit breaker: after 3 consecutive evaluate failures, fail fast for 60s so
// every action during an outage doesn't pay the full timeout before failover.
// policy_not_found is drift, not an outage — it never trips the breaker.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
let _breakerFailures = 0;
let _breakerOpenUntil = 0;

async function _withCircuitBreaker(evaluateFn) {
  if (Date.now() < _breakerOpenUntil) {
    const err = new Error('PingOne Authorize circuit open — failing fast after repeated errors.');
    err.code = 'authorize_circuit_open';
    throw err;
  }
  try {
    const result = await evaluateFn();
    _breakerFailures = 0;
    return result;
  } catch (err) {
    if (err.code !== 'policy_not_found') {
      _breakerFailures += 1;
      if (_breakerFailures >= BREAKER_THRESHOLD) {
        _breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
        _breakerFailures = 0; // half-open probe after cooldown
      }
    }
    throw err;
  }
}
```

Wrap the bodies of the two public evaluate entry points. `evaluateTransaction` currently picks decision-endpoint vs PDP path; wrap its dispatch: `return _withCircuitBreaker(() => _evaluateViaDecisionEndpoint({...}))` / same for the PDP branch and for `evaluateMcpToolDelegation`'s `_postDecisionEndpoint` call. Keep the "not configured" throw OUTSIDE the breaker (config absence is not an outage).

Extend the reset hook:

```js
function _resetAuthorizeRuntimeState() {
  _clearWorkerTokenCache();
  _breakerFailures = 0;
  _breakerOpenUntil = 0;
}
```

- [ ] **Step 4: Run all three new test files** → PASS.
- [ ] **Step 5: Commit** — `feat(authorize): circuit breaker fails fast to failover during P1AZ outages`

---

### Task 5: Gate branches — policy_not_found in both gates

**Files:**
- Modify: `demo_api_server/services/transactionAuthorizationService.js` (after `:246` result handling; catch block `:284-343`), `demo_api_server/services/mcpToolAuthorizationService.js` (`mapLivePingOneResult` `:363`; catch block `:577-672`)
- Test: `demo_api_server/src/__tests__/authorizePolicyNotFound.gates.test.js` (new; mock `pingOneAuthorizeService` like existing gate tests do)

**Interfaces:**
- Consumes: `'NOT_APPLICABLE'` decision, `err.code === 'policy_not_found' | 'authorize_circuit_open'` from Tasks 1/4.
- Produces block body (both gates): `{ error: 'policy_not_found', error_description: 'Policy not found, please contact administrator.', authorize_engine: 'pingone', ... }` with status 503. Task 7 consumes `error: 'policy_not_found'` in the UI.

- [ ] **Step 1: Failing tests** — follow the mocking style of `src/__tests__/transactions.authorization.test.js` (jest.mock the pingOneAuthorizeService module). Cases:

```js
jest.mock('../../services/pingOneAuthorizeService');
const pingOne = require('../../services/pingOneAuthorizeService');
const txSvc = require('../../services/transactionAuthorizationService');
const mcpSvc = require('../../services/mcpToolAuthorizationService');
// (plus whatever configStore/env scaffolding the existing gate tests use to force
// live-pingone mode with a decision endpoint configured — copy it from
// transactions.authorization.test.js, do not invent a new harness.)

it('transaction gate: NOT_APPLICABLE → 503 policy_not_found', async () => {
  pingOne.evaluateTransaction.mockResolvedValue({ decision: 'NOT_APPLICABLE', raw: {}, path: 'decision-endpoint' });
  const r = await txSvc.evaluateTransactionPolicy({ runtimeSettings, userRole: 'customer', userId: 'u1', amount: 50, type: 'transfer', acr: '' });
  expect(r.block.status).toBe(503);
  expect(r.block.body.error).toBe('policy_not_found');
  expect(r.block.body.error_description).toBe('Policy not found, please contact administrator.');
});

it('transaction gate: 404 + failover=deny → 503 policy_not_found (not authorization_service_unavailable)', async () => {
  pingOne.evaluateTransaction.mockRejectedValue(Object.assign(new Error('404'), { code: 'policy_not_found', status: 404 }));
  // force failover=deny via authorize_mode='pingone' in the store scaffolding
  const r = await txSvc.evaluateTransactionPolicy({ ... });
  expect(r.block.body.error).toBe('policy_not_found');
  expect(r.block.body.authorizeFallback.reason).toBe('policy_not_found');
});

it('transaction gate: 404 + failover=fallback_simulated → simulated ran, signal reason=policy_not_found', ...);
it('mcp gate: NOT_APPLICABLE → 503 policy_not_found block', ...);
it('mcp gate: 404 + failover=deny → 503 policy_not_found block', ...);
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement — transaction gate.** After the live result is obtained (`:246`), before the `stepUpRequired` check, add:

```js
    if (r.decision === 'NOT_APPLICABLE') {
      // P1AZ evaluated fine but no policy matched — code/policy drift, not a deny.
      logEvent(EVENT_CATEGORIES.AUTHORIZE, 'error',
        `[Authorize] NOT_APPLICABLE — no PingOne policy matched (code/policy drift)`,
        { tag: 'authorize/policy-not-found', metadata: { type, amount, userId } });
      return {
        ran: true,
        block: {
          status: 503,
          body: {
            error: 'policy_not_found',
            error_description: 'Policy not found, please contact administrator.',
            authorize_engine: 'pingone',
            authorize_policy_id: AUTHORIZE_DECISION_ENDPOINT_ID || AUTHORIZE_POLICY_ID,
          },
        },
      };
    }
```

In the catch block, enrich the fallback signal and override the deny-mode body. After `const authorizeFallback = ...buildAuthorizeFallbackSignal(failoverMode, err, 'transaction');` change the call to:

```js
    const authorizeFallback = simulatedAuthorizeService.buildAuthorizeFallbackSignal(
      failoverMode, err, 'transaction',
      err.code === 'policy_not_found' ? { reason: 'policy_not_found' }
        : err.code === 'authorize_circuit_open' ? { reason: 'circuit_open' } : {});
```

And inside `if (failoverMode === 'deny')`, before the existing return:

```js
      if (err.code === 'policy_not_found') {
        return {
          ran: true,
          block: {
            status: 503,
            body: {
              error: 'policy_not_found',
              error_description: 'Policy not found, please contact administrator.',
              failover_mode: 'deny',
              authorizeFallback,
            },
          },
        };
      }
```

- [ ] **Step 4: Implement — MCP gate.** In `mapLivePingOneResult` add before the `r.decision === 'DENY'` branch:

```js
    if (r.decision === 'NOT_APPLICABLE') {
      return {
        ran: true,
        block: {
          status: 503,
          body: {
            error: 'policy_not_found',
            error_description: 'Policy not found, please contact administrator.',
            authorize_engine: 'pingone',
            decisionContext: 'McpFirstTool',
            decisionId: r.decisionId,
            ...autoDisabled,
          },
        },
      };
    }
```

In the catch block, extend the signal call (`:607-608`) with the same reason-enrichment `extra` (merge with the existing `{ tool }`), and add a deny-mode branch before the final `return { ran: true, pingoneError: err, authorizeFallback };`:

```js
    if (err.code === 'policy_not_found') {
      return { ran: true, block: { status: 503, body: {
        error: 'policy_not_found',
        error_description: 'Policy not found, please contact administrator.',
        authorize_engine: 'pingone',
        decisionContext: 'McpFirstTool',
        authorizeFallback,
      } } };
    }
```

Place it AFTER the `failoverMode === 'fallback_simulated'` block so fallback mode still keeps the demo alive on a 404 (spec: failover respected for 404).

- [ ] **Step 5: Run tests** → PASS. Also run the existing suites: `authorizeNotConfiguredFailClosed.test.js`, `transactions.authorization.test.js`, `mcpToolAuthorizationService.test.js`, `authorizeFallbackSignal.test.js` → PASS.
- [ ] **Step 6: Commit** — `feat(authorize): policy_not_found gate handling (NOT_APPLICABLE + 404)`

---

### Task 6: Preflight readiness check

**Files:**
- Modify: `demo_api_server/services/pingOneAuthorizeService.js` (new `checkPolicyReadiness()` next to `warmup()` ~`:741`; export), `demo_api_server/server.js:2119-2129` (chain readiness after boot warm), `demo_api_server/routes/authorize.js` (new GET route)
- Test: append to `pingOneAuthorize.reliability.test.js`

**Interfaces:**
- Produces: `checkPolicyReadiness() → Promise<{ ok, skipped?, gates?: { transaction?: {status, detail?}, mcp?: {status, detail?} } }>` where `status ∈ 'ready' | 'policy_not_found' | 'error' | 'unconfigured'`. Route: `GET /api/authorize/policy-readiness` (admin, `authenticateToken` like siblings).

- [ ] **Step 1: Failing tests**

```js
describe('checkPolicyReadiness', () => {
  beforeEach(() => svc._resetAuthorizeRuntimeState());
  it('classifies PERMIT/DENY as ready and NOT_APPLICABLE as policy_not_found', async () => {
    process.env.PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID = 'ep-tx';
    process.env.PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID = 'ep-mcp';
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ decision: 'DENY' }) })          // tx
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ decision: 'NOT_APPLICABLE' }) }); // mcp
    const r = await svc.checkPolicyReadiness();
    expect(r.gates.transaction.status).toBe('ready');
    expect(r.gates.mcp.status).toBe('policy_not_found');
    delete process.env.PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID;
    delete process.env.PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID;
  });
});
```

- [ ] **Step 2: Run** → FAIL (`checkPolicyReadiness` not a function).

- [ ] **Step 3: Implement** (below `warmup()`):

```js
/**
 * Demo preflight: fire one synthetic decision per configured gate and classify
 * whether a policy actually matched — catches code/P1AZ drift before the demo.
 * Never throws; safe to run at boot and from the admin route.
 */
async function checkPolicyReadiness() {
  if (configStore.getEffective('ff_authorize_simulated') === 'true') {
    return { ok: false, skipped: 'simulated' };
  }
  if (!isWorkerCredentialReady()) {
    return { ok: false, skipped: 'unconfigured' };
  }
  const { decisionEndpointId, policyId, mcpDecisionEndpointId } = _getCredentials();

  const classify = async (evaluate) => {
    try {
      const r = await evaluate();
      if (r.decision === 'NOT_APPLICABLE') return { status: 'policy_not_found' };
      return { status: 'ready', detail: r.decision };
    } catch (err) {
      if (err.code === 'policy_not_found') return { status: 'policy_not_found', detail: err.message };
      return { status: 'error', detail: err.message };
    }
  };

  const gates = {};
  if (decisionEndpointId || policyId) {
    gates.transaction = await classify(() => evaluateTransaction({
      decisionEndpointId, policyId, userId: 'preflight@demo.local', amount: 1, type: 'deposit',
    }));
  } else {
    gates.transaction = { status: 'unconfigured' };
  }
  if (mcpDecisionEndpointId) {
    gates.mcp = await classify(() => evaluateMcpToolDelegation({
      decisionEndpointId: mcpDecisionEndpointId, userId: 'preflight@demo.local', toolName: 'preflight_check',
    }));
  } else {
    gates.mcp = { status: 'unconfigured' };
  }
  const ok = Object.values(gates).every((g) => g.status === 'ready' || g.status === 'unconfigured');
  return { ok, gates };
}
```

Export `checkPolicyReadiness`. NOTE: verify `evaluateMcpToolDelegation`'s minimal required args by reading its full signature (`:277-330`) — pass only what it requires; the synthetic call must not throw on missing optional params.

In `server.js` boot warm, chain after the existing `.then`:

```js
        .then(() => pingOneAuthorizeService.checkPolicyReadiness())
        .then((r) => {
          if (r && r.gates) {
            const drifted = Object.entries(r.gates).filter(([, g]) => g.status === 'policy_not_found');
            if (drifted.length) {
              console.warn('[authz-warmup] ⚠️ POLICY DRIFT — gates missing a matching P1AZ policy:',
                drifted.map(([k]) => k).join(', '));
            } else {
              console.log('[authz-warmup] policy readiness:', JSON.stringify(r));
            }
          }
        })
```

(Match the exact import name used at `server.js:2127`.)

In `routes/authorize.js` add beside the warmup route:

```js
/**
 * GET /api/authorize/policy-readiness
 * Preflight drift check: synthetic decision per configured gate.
 */
router.get('/policy-readiness', authenticateToken, async (req, res) => {
  try {
    const result = await checkPolicyReadiness();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'readiness_check_failed', error_description: err.message });
  }
});
```

Add `checkPolicyReadiness` to the destructured import at the top. Match the auth middleware used by the sibling warmup route exactly (read it first — if it also requires an admin-role check, copy it).

- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** — `feat(authorize): boot + admin preflight policy-readiness check`

---

### Task 7: UI — policy_not_found chat message

**Files:**
- Modify: `demo_api_ui/src/services/demoAgentService.js` (~`:452`, beside the `mcp_authorization_denied` mapping), `demo_api_ui/src/components/AIAgent.js` (~`:4417`, beside the `mcp_authorization_denied` ladder branch)
- Test: UI build gate (no jest harness for AIAgent ladder branches — match repo practice).

**Interfaces:**
- Consumes: `{ error: 'policy_not_found', error_description }` bodies from Task 5.

- [ ] **Step 1: demoAgentService mapping** — insert immediately BEFORE the `mcp_authorization_denied` mapping:

```js
      // Missing/unmatched P1AZ policy (code/policy drift) — distinct from a deny.
      if (err.error === "policy_not_found") {
        throw Object.assign(
          new Error(err.error_description || "Policy not found, please contact administrator."),
          {
            code: "policy_not_found",
            statusCode: 503,
            tool: tool,
            tokenEvents: allTokenEvents,
          },
        );
      }
```

NOTE: this mapping block appears in the non-OK response handler for `/api/mcp/tool`. Verify the surrounding handler covers 503 bodies (it parses `err` from the response JSON regardless of status); if 503 short-circuits earlier (e.g. a generic 5xx branch above), place this check BEFORE that branch.

- [ ] **Step 2: AIAgent ladder branch** — insert immediately BEFORE `} else if (err?.code === "mcp_authorization_denied") {`:

```js
      } else if (err?.code === "policy_not_found") {
        // P1AZ has no policy matching this action — config drift, not a deny.
        addMessage(
          "assistant",
          "Policy not found, please contact administrator.",
          actionId,
        );
```

- [ ] **Step 3: UI build gate** — `cd demo_api_ui && npm run build` (or the build command REGRESSION_PLAN names) → succeeds.
- [ ] **Step 4: Commit** — `feat(ui): show policy-not-found message in agent chat`

---

### Task 8: Failover default → pingone_fallback_simulated

**Files:**
- Modify: `demo_api_server/services/configStore.js:502`, stale comments in `demo_api_server/services/simulatedAuthorizeService.js:1076-1092` and `transactionAuthorizationService.js:12-21` header
- Test: update `demo_api_server/src/__tests__/authorizeMode.resolve.test.js` (default-pinning block at `:91+`) and `authorizeNotConfiguredFailClosed.test.js`

**DELIBERATE POSTURE CHANGE:** these two tests exist to pin fail-closed-by-default. The user explicitly requested fail-to-simulated for demo reliability. Update the tests and their header comments to pin the NEW default; do not delete them.

- [ ] **Step 1: Flip the default**

```js
  authorize_mode: { public: true, default: 'pingone_fallback_simulated' },
```

- [ ] **Step 2: Update the default-pinning test** in `authorizeMode.resolve.test.js` (`describe('authorize_mode default (FIELD_DEFS source of truth)')`) to expect `'pingone_fallback_simulated'` and `failoverMode: 'fallback_simulated'`, with a comment: demo reliability decision 2026-07-11 — P1AZ outage falls back to the simulated engine by default; set `authorize_mode='pingone'` for strict fail-closed.

- [ ] **Step 3: Update `authorizeNotConfiguredFailClosed.test.js`** — with the new default, an UNCONFIGURED PingOne now runs the simulated engine (not 503). Rewrite the two assertions to pin that: transaction path → simulated engine evaluation ran (`r.permit === true` or a simulated block, depending on amount — use amount 50 which permits), and pin that strict mode still fails closed by setting `authorize_mode: 'pingone'` explicitly in a second case (preserving the original 503 assertions under the explicit flag). Update the file header comment accordingly.

- [ ] **Step 4: Update the stale comments** — `simulatedAuthorizeService.js:1076-1092` ("FIELD_DEFS defaults authorize_mode to 'pingone'… FAILS CLOSED") and the `transactionAuthorizationService.js` header (`:12-21`) to describe the new default.

- [ ] **Step 5: Run** `authorizeMode.resolve.test.js`, `authorizeNotConfiguredFailClosed.test.js`, plus the Task 5 gate test file → PASS. Expect the pre-commit hook to regenerate `mcp-tool-schemas.json` (configStore.js staged) — include it.
- [ ] **Step 6: Commit** — `feat(authorize): default failover to fallback_simulated for demo resilience`

---

### Task 9: Full verification

- [ ] Run the api-server suite: `npm run test:api-server` (from repo root of the worktree) → green (only deliberate updates from Task 8).
- [ ] Run UI build gate → green.
- [ ] `npm run topology:verify && npm run hygiene:check` if the pre-commit hook doesn't already.
- [ ] Manual smoke (if stack running): point `authorize_mcp_decision_endpoint_id` at a bogus UUID via admin config, ask the agent for a transfer → chat shows "Policy not found, please contact administrator." (deny mode) or fallback modal shows `reason: policy_not_found` (fallback mode). Restore config after.
- [ ] Re-check REGRESSION_PLAN §0/§1 diffs: no emoji violations (only `⚠️` used, which is allowlisted), minimal diff.
