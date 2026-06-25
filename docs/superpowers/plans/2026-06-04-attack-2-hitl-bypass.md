# HITL Bypass Hardening — Attack 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the `consentGiven=true` bypass in `agentPreflightService.evaluate()` so that no authenticated user or adversarial agent can skip the HITL gate by setting a request flag, and surface the attack and its fix in a new "HITL Bypass" tab on the `AiAttacksPanel` education panel.

**Architecture:** `agentPreflightService.evaluate()` drops the `consentGiven` shortcut and gains a `hitlChallengeId` parameter. When a challenge ID is present it calls `hitlServiceClient.getChallengeStatus` + `verifyHitlReceipt` (the same verification path that `mcpToolAuthorizationService.evaluateMcpFirstToolGate` uses) before issuing PERMIT. No challenge ID + HITL-required policy → new challenge created, HITL returned. The caller `dispatchVerticalIntent` is updated to extract `hitlChallengeId` from the request body instead of `consentGiven`.

**Tech Stack:** Node.js / CommonJS (`demo_api_server/`), Jest, React / CRA (`demo_api_ui/`). No new npm dependencies.

**Precondition:** Plan 1 (OBO/AI-Attacks foundation) has already been merged. `AiAttacksPanel.js` exists with at least one tab in its `tabs` array, and `EDU.AI_ATTACKS` exists in `educationIds.js`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_api_server/services/agentPreflightService.js` | **Modify** | Replace `consentGiven` bypass with `hitlChallengeId` verification path |
| `demo_api_server/services/demoAgentLangGraphService.js` | **Modify** | Extract `hitlChallengeId` from `req.body`; pass to `evaluate()` instead of `consentGiven` |
| `demo_api_server/tests/agentPreflight.regression.test.js` | **Modify** | Update existing `consentGiven=true` test; add `hitlChallengeId` tests |
| `demo_api_server/tests/hitlBypass.regression.test.js` | **Create** | Three-case regression: no ID → HITL, fake ID → HITL, valid ID → PERMIT |
| `demo_api_ui/src/components/education/AiAttacksPanel.js` | **Modify** | Add "HITL Bypass" tab to the `tabs` array |
| `REGRESSION_PLAN.md` | **Modify** | §4 Bug Fix Log entry |

---

## Task 1 — Harden `agentPreflightService.evaluate()`

**Files:**
- Modify: `demo_api_server/services/agentPreflightService.js:45–50`

### Context

Lines 45–50 of `agentPreflightService.js` are the bypass:

```js
async function evaluate({ req, tool, params = {}, consentGiven = false }) {
  if (consentGiven) {
    return { decision: 'PERMIT', reason: 'consent_given' };
  }
```

Any caller that posts `{"consentGiven": true}` gets an unconditional PERMIT before any token exchange, P1AZ gate, or HITL check runs.

The fix: replace `consentGiven` with `hitlChallengeId`. When a challenge ID is provided, verify it via `hitlServiceClient` before issuing PERMIT. When absent (the normal first-call path), proceed to the P1AZ gate as before — no short-circuit.

- [ ] **Step 1.1 — Update the function signature and remove the bypass**

Replace the entire `evaluate` function signature and early-return block. The JSDoc changes too.

In `/Users/curtismuir/Development/AI-Demo/demo_api_server/services/agentPreflightService.js`, replace:

```js
/**
 * Evaluate authorization for a tool call before execution.
 *
 * @param {object} opts
 * @param {import('express').Request} opts.req  - real Express request (has session)
 * @param {string} opts.tool                    - MCP tool / vertical action name
 * @param {object} [opts.params]                - tool parameters (used for amount etc.)
 * @param {boolean} [opts.consentGiven]         - true when agent is retrying after user approved consent
 * @returns {Promise<{
 *   decision: 'PERMIT'|'DENY'|'HITL'|'STEP_UP',
 *   fallback?: boolean,
 *   reason?: string,
 *   engine?: string,
 *   evaluation?: object,
 *   type?: string,
 *   challengeId?: string,
 *   expiresAt?: string,
 *   instructions?: string,
 *   directives?: object,
 *   tokenEvents?: Array,
 * }>}
 */
async function evaluate({ req, tool, params = {}, consentGiven = false }) {
  // Simulated consent bypass — maintains backward-compat with routes that
  // re-invoke with consentGiven=true after the user clicks "Approve".
  if (consentGiven) {
    return { decision: 'PERMIT', reason: 'consent_given' };
  }
```

with:

```js
/**
 * Evaluate authorization for a tool call before execution.
 *
 * @param {object} opts
 * @param {import('express').Request} opts.req  - real Express request (has session)
 * @param {string} opts.tool                    - MCP tool / vertical action name
 * @param {object} [opts.params]                - tool parameters (used for amount etc.)
 * @param {string|null} [opts.hitlChallengeId]  - HITL challenge ID echoed by the agent on retry;
 *                                                must pass verifyHitlReceipt before PERMIT is issued.
 *                                                Never trust a raw boolean — a missing or invalid ID
 *                                                re-issues the HITL challenge (fail-closed).
 * @returns {Promise<{
 *   decision: 'PERMIT'|'DENY'|'HITL'|'STEP_UP',
 *   fallback?: boolean,
 *   reason?: string,
 *   engine?: string,
 *   evaluation?: object,
 *   type?: string,
 *   challengeId?: string,
 *   expiresAt?: string,
 *   instructions?: string,
 *   directives?: object,
 *   tokenEvents?: Array,
 * }>}
 */
async function evaluate({ req, tool, params = {}, hitlChallengeId = null }) {
```

- [ ] **Step 1.2 — Add the HITL challenge verification block after token resolution**

The new verification block must sit immediately after the token-resolution `try/catch` block (around line 74 in the original, now the same position) and before the P1AZ gate call.

In the same file, locate the comment `// ── Authorization gate ─────────────────────────────────────────────────────` and insert the following block immediately before it:

```js
  // ── HITL receipt verification (pre-flight path) ────────────────────────────
  // When the agent echoes back a challenge ID on retry, verify the receipt
  // against the canonical HITL service (3009) BEFORE calling the P1AZ gate.
  // Verified → skip the gate and PERMIT immediately (same short-circuit the
  // gateway uses in evaluateMcpFirstToolGate after its own receipt check).
  // Fail-closed: any error, mismatch, or non-approved status falls through to
  // the gate which will re-challenge. This is the ONLY place a hitlChallengeId
  // produces PERMIT in the pre-flight path.
  if (hitlChallengeId) {
    try {
      const { decodeJwtClaims: _decode } = require('./agentMcpTokenService');
      const agentId = agentToken ? (_decode(agentToken)?.claims?.sub || '') : '';
      const status = await hitlServiceClient.getChallengeStatus(hitlChallengeId);
      const verification = hitlServiceClient.verifyHitlReceipt(
        status,
        userSub || undefined,
        agentId || undefined,
        tool,
      );
      if (verification.ok) {
        return { decision: 'PERMIT', reason: 'hitl_receipt_verified', tokenEvents };
      }
      console.warn(
        '[AgentPreflight] HITL receipt invalid for tool=%s reason=%s — re-challenging',
        tool,
        verification.message,
      );
      // Fall through to gate — it will re-issue HITL (fail-closed).
    } catch (err) {
      console.warn(
        '[AgentPreflight] HITL receipt verification error for tool=%s: %s — re-challenging',
        tool,
        err.message,
      );
      // Fall through to gate.
    }
  }
```

- [ ] **Step 1.3 — Verify the module exports are unchanged**

The last line of the file must still be:

```js
module.exports = { evaluate };
```

No change needed — just confirm it is still present after editing.

---

## Task 2 — Update the caller `dispatchVerticalIntent`

**Files:**
- Modify: `demo_api_server/services/demoAgentLangGraphService.js:564` (function signature)
- Modify: `demo_api_server/services/demoAgentLangGraphService.js:575–580` (call site)
- Modify: `demo_api_server/services/demoAgentLangGraphService.js:905` (body extraction)
- Modify: `demo_api_server/services/demoAgentLangGraphService.js:918` (caller)

### Context

`dispatchVerticalIntent` currently:
1. Accepts `consentGiven` in its options destructure (line 564).
2. Passes `consentGiven` to `agentPreflightService.evaluate()` (lines 575–580).

The calling site (line 905–918) extracts `consentGiven` from `req.body` and passes it.

After this task `consentGiven` is gone everywhere in this call chain, replaced by `hitlChallengeId`.

- [ ] **Step 2.1 — Update `dispatchVerticalIntent` signature**

In `demo_api_server/services/demoAgentLangGraphService.js`, replace:

```js
async function dispatchVerticalIntent(heuristic, { userId, userToken, req, tokenEvents = [], sessionId = '', isAdmin = false, verticalCtx = null, consentGiven = false }) {
```

with:

```js
async function dispatchVerticalIntent(heuristic, { userId, userToken, req, tokenEvents = [], sessionId = '', isAdmin = false, verticalCtx = null, hitlChallengeId = null }) {
```

- [ ] **Step 2.2 — Update the `agentPreflightService.evaluate()` call site**

In the same file, replace:

```js
  const preflight = await agentPreflightService.evaluate({
    req,
    tool: action,
    params: params || {},
    consentGiven,
  });
```

with:

```js
  const preflight = await agentPreflightService.evaluate({
    req,
    tool: action,
    params: params || {},
    hitlChallengeId,
  });
```

- [ ] **Step 2.3 — Update the body extraction and call site**

In the same file, replace:

```js
    const consentGiven = req?.body?.consentGiven === true;
```

with:

```js
    const hitlChallengeId = (typeof req?.body?.hitlChallengeId === 'string' && req.body.hitlChallengeId) || null;
```

Then replace:

```js
        const verticalResult = await dispatchVerticalIntent(heuristic, { userId, userToken, req, tokenEvents: [], sessionId: req?.sessionID || '', isAdmin, verticalCtx: _verticalCtx, consentGiven });
```

with:

```js
        const verticalResult = await dispatchVerticalIntent(heuristic, { userId, userToken, req, tokenEvents: [], sessionId: req?.sessionID || '', isAdmin, verticalCtx: _verticalCtx, hitlChallengeId });
```

---

## Task 3 — Update the existing `agentPreflight.regression.test.js`

**Files:**
- Modify: `demo_api_server/tests/agentPreflight.regression.test.js`

### Context

The existing test at line 120–125 asserts the old bypass behaviour (`consentGiven=true → PERMIT immediately`). After the hardening that test documents a **now-removed vulnerability** — it must be updated to assert the hardened behaviour: passing `hitlChallengeId` with a verified receipt → PERMIT, and the old `consentGiven` parameter is no longer accepted.

Also add `getChallengeStatus` and `verifyHitlReceipt` to the `hitlServiceClient` mock (currently only `createChallenge` is mocked).

- [ ] **Step 3.1 — Extend the mock for `hitlServiceClient`**

In `demo_api_server/tests/agentPreflight.regression.test.js`, replace:

```js
// Mock HITL service client
jest.mock('../services/hitlServiceClient', () => ({
  createChallenge: jest.fn(async () => ({
    challengeId: 'challenge-abc',
    expiresAt: '2099-01-01T00:00:00Z',
  })),
}));
```

with:

```js
// Mock HITL service client
jest.mock('../services/hitlServiceClient', () => ({
  createChallenge: jest.fn(async () => ({
    challengeId: 'challenge-abc',
    expiresAt: '2099-01-01T00:00:00Z',
  })),
  getChallengeStatus: jest.fn(async (id) => {
    if (id === 'valid-challenge-id') {
      return { status: 'approved', userId: 'user-123', agentId: 'agent-client-id', tool: 'create_transfer', expiresAt: '2099-01-01T00:00:00Z' };
    }
    const err = new Error('not found');
    err.status = 404;
    throw err;
  }),
  verifyHitlReceipt: jest.fn((status) =>
    status.status === 'approved' ? { ok: true } : { ok: false, message: 'not approved' }
  ),
}));
```

- [ ] **Step 3.2 — Replace the `consentGiven=true` test with the hardened-path test**

Replace:

```js
  test('consentGiven=true → PERMIT immediately, gate not called', async () => {
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: {}, consentGiven: true });
    expect(result.decision).toBe('PERMIT');
    expect(result.reason).toBe('consent_given');
    expect(evaluateMcpFirstToolGate).not.toHaveBeenCalled();
  });
```

with:

```js
  test('hitlChallengeId with verified receipt → PERMIT, gate not called', async () => {
    evaluateMcpFirstToolGate.mockResolvedValueOnce({ ran: true, permit: true, evaluation: { engine: 'simulated' } });
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: {}, hitlChallengeId: 'valid-challenge-id' });
    expect(result.decision).toBe('PERMIT');
    expect(result.reason).toBe('hitl_receipt_verified');
    // Gate must NOT have been called — the receipt verification short-circuits before it.
    expect(evaluateMcpFirstToolGate).not.toHaveBeenCalled();
  });

  test('hitlChallengeId with rejected receipt → falls through to gate (re-challenge)', async () => {
    evaluateMcpFirstToolGate.mockResolvedValueOnce({
      ran: true,
      block: {
        status: 428,
        body: {
          error: 'mcp_hitl_required',
          error_description: 'Approval required',
          authorize_engine: 'simulated',
          decisionId: 'dec-retry',
        },
      },
    });
    // 'bad-challenge-id' is not in the mock's known IDs — getChallengeStatus throws 404
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: {}, hitlChallengeId: 'bad-challenge-id' });
    // Should NOT be PERMIT — gate ran and re-issued HITL
    expect(result.decision).toBe('HITL');
    expect(evaluateMcpFirstToolGate).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 3.3 — Run the updated suite and confirm it passes**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
npx jest agentPreflight.regression --no-coverage --verbose
```

Expected: all tests pass (the two new tests plus the existing PERMIT / DENY / HITL / STEP_UP / fallback tests).

---

## Task 4 — Add `hitlBypass.regression.test.js`

**Files:**
- Create: `demo_api_server/tests/hitlBypass.regression.test.js`

### Context

This is a focused regression file that locks in the three threat-model cases from the spec so a future refactor cannot accidentally re-open the bypass. It mocks at the same granularity as `agentPreflight.regression.test.js` but is scoped exclusively to the bypass attack surface.

- [ ] **Step 4.1 — Write the failing tests first**

Create `/Users/curtismuir/Development/AI-Demo/demo_api_server/tests/hitlBypass.regression.test.js`:

```js
'use strict';

/**
 * hitlBypass.regression.test.js
 *
 * Regression lock for Attack 2 — the consentGiven=true HITL bypass.
 * Three cases must hold forever:
 *  (a) No hitlChallengeId on a tool that requires HITL → decision is HITL, not PERMIT
 *  (b) Fake/unknown hitlChallengeId                  → decision is HITL (re-challenge), not PERMIT
 *  (c) Valid verified hitlChallengeId                 → decision is PERMIT with reason 'hitl_receipt_verified'
 *
 * Also ensures the legacy consentGiven=true body field cannot short-circuit the gate
 * by any surviving code path — evaluate() no longer accepts consentGiven.
 */

const _cfg = { ff_authorize_fail_open: 'true' };
jest.mock('../services/configStore', () => ({
  get: jest.fn((k) => _cfg[k] ?? null),
  getEffective: jest.fn((k) => _cfg[k] ?? null),
}));

jest.mock('../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(async () => ({
    token: 'fake-token',
    userSub: 'user-sub',
    tokenEvents: [],
  })),
  decodeJwtClaims: jest.fn(() => ({ claims: { sub: 'user-sub' } })),
}));

jest.mock('../services/mcpToolAuthorizationService', () => ({
  evaluateMcpFirstToolGate: jest.fn(async () => ({
    ran: true,
    block: { status: 428, body: { error: 'mcp_hitl_required' } },
  })),
}));

jest.mock('../services/hitlServiceClient', () => ({
  createChallenge: jest.fn(async () => ({
    challengeId: 'ch-001',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  })),
  getChallengeStatus: jest.fn(async (id) => {
    if (id === 'valid-ch-001') {
      return {
        status: 'approved',
        userId: 'user-sub',
        agentId: '',
        tool: 'create_transfer',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    }
    const err = new Error('not found');
    err.status = 404;
    throw err;
  }),
  verifyHitlReceipt: jest.fn((status) =>
    status.status === 'approved' ? { ok: true } : { ok: false, message: 'not approved' }
  ),
}));

const { evaluateMcpFirstToolGate } = require('../services/mcpToolAuthorizationService');
const { evaluate } = require('../services/agentPreflightService');

const fakeReq = () => ({
  session: { user: { role: 'user', acr: 'urn:acme:Bronze', email: 'test@example.com' } },
  correlationId: 'corr-bypass-test',
});

beforeEach(() => jest.clearAllMocks());

describe('Attack 2 — HITL Bypass regression', () => {
  test('(a) No hitlChallengeId → gate triggers HITL, not PERMIT', async () => {
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: { amount: 1000 } });
    expect(result.decision).toBe('HITL');
    expect(result.reason).toBeUndefined();
    expect(evaluateMcpFirstToolGate).toHaveBeenCalledTimes(1);
  });

  test('(b) Fake / unknown hitlChallengeId → falls through to gate, HITL re-issued, never PERMIT', async () => {
    const result = await evaluate({
      req: fakeReq(),
      tool: 'create_transfer',
      params: { amount: 1000 },
      hitlChallengeId: 'attacker-invented-id',
    });
    expect(result.decision).toBe('HITL');
    // Gate must still have been called (fall-through from failed receipt verification)
    expect(evaluateMcpFirstToolGate).toHaveBeenCalledTimes(1);
  });

  test('(c) Valid verified hitlChallengeId → PERMIT with hitl_receipt_verified, gate not called', async () => {
    const result = await evaluate({
      req: fakeReq(),
      tool: 'create_transfer',
      params: { amount: 1000 },
      hitlChallengeId: 'valid-ch-001',
    });
    expect(result.decision).toBe('PERMIT');
    expect(result.reason).toBe('hitl_receipt_verified');
    expect(evaluateMcpFirstToolGate).not.toHaveBeenCalled();
  });

  test('legacy consentGiven=true body field is ignored — evaluate() does not accept it', async () => {
    // Call evaluate() with consentGiven as if it still existed.
    // After the hardening, it is simply not in the destructure, so it is ignored
    // and the gate runs normally, issuing HITL as policy demands.
    const result = await evaluate({
      req: fakeReq(),
      tool: 'create_transfer',
      params: { amount: 1000 },
      consentGiven: true,   // silently ignored after hardening
    });
    expect(result.decision).toBe('HITL');
    expect(evaluateMcpFirstToolGate).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4.2 — Run both regression suites to confirm all pass**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
npx jest agentPreflight.regression hitlBypass.regression --no-coverage --verbose
```

Expected output: two test suites, all tests green (approximately 10 tests total). No failures.

---

## Task 5 — Add "HITL Bypass" tab to `AiAttacksPanel.js`

**Files:**
- Modify: `demo_api_ui/src/components/education/AiAttacksPanel.js`

### Context

`AiAttacksPanel.js` was created by Plan 1 with an initial `tabs` array. This task appends one new entry to that array. The tab explains the attack, shows the vulnerable code, shows the hardened code, and describes the verification approach — all in JSX, matching the style of `HumanInLoopPanel.js` and `OboPanel.js`.

No new component, no new EDU id, no new PANEL_MAP entry — the panel already exists and is already registered.

- [ ] **Step 5.1 — Append the "HITL Bypass" tab object to the `tabs` array**

In `/Users/curtismuir/Development/AI-Demo/demo_api_ui/src/components/education/AiAttacksPanel.js`, locate the closing `]` of the `tabs` array and insert the following tab object as the last entry (before the `]`):

```js
    {
      id: 'hitl-bypass',
      label: 'HITL Bypass',
      content: (
        <>
          <p style={{ color: '#374151', marginBottom: '1rem' }}>
            <strong>Attack:</strong> A user (or a prompt-injected agent) posts{' '}
            <code>&#123;"message": "transfer $1000", "consentGiven": true&#125;</code> to{' '}
            <code>/api/banking-agent/message</code>. The pre-flight service sees{' '}
            <code>consentGiven === true</code> and returns <code>PERMIT</code> immediately —
            before token exchange, before any policy check, before HITL. The entire gate is skipped.
          </p>

          <h3>Vulnerable code (removed)</h3>
          <pre style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 14px', fontSize: '0.82rem', overflowX: 'auto', marginBottom: '1rem' }}>
{`// agentPreflightService.js — BEFORE hardening
async function evaluate({ req, tool, params = {}, consentGiven = false }) {
  if (consentGiven) {
    return { decision: 'PERMIT', reason: 'consent_given' };  // ❌ bypass
  }
  // ... token exchange, P1AZ gate, HITL ...
}`}
          </pre>
          <p>
            Any authenticated POST with <code>consentGiven: true</code> in the body reached line 2
            and returned before the gate ran. No challenge ID was verified. No policy was consulted.
          </p>

          <h3>Hardened code</h3>
          <pre style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '10px 14px', fontSize: '0.82rem', overflowX: 'auto', marginBottom: '1rem' }}>
{`// agentPreflightService.js — AFTER hardening
async function evaluate({ req, tool, params = {}, hitlChallengeId = null }) {
  // consentGiven removed — no raw-flag bypass exists

  // ... token exchange runs first ...

  if (hitlChallengeId) {
    const status = await hitlServiceClient.getChallengeStatus(hitlChallengeId);
    const verification = hitlServiceClient.verifyHitlReceipt(
      status, userSub, agentId, tool
    );
    if (verification.ok) {
      return { decision: 'PERMIT', reason: 'hitl_receipt_verified' };  // ✅
    }
    // Fall through to gate — it will re-issue HITL (fail-closed)
  }

  // ... P1AZ gate + HITL challenge creation ...
}`}
          </pre>

          <h3>Why the hardened path is safe</h3>
          <ul>
            <li>
              <strong>No raw boolean.</strong> The caller must supply a real challenge ID. There is no
              flag to forge — only a HITL challenge record in the canonical store (port 3009) counts.
            </li>
            <li>
              <strong>Receipt is verified, not trusted.</strong> <code>getChallengeStatus</code> fetches
              the live record. <code>verifyHitlReceipt</code> checks: status is <code>approved</code>,
              not expired, bound to this user, this agent, and this tool. A mismatch on any field
              falls through to the gate (fail-closed re-challenge).
            </li>
            <li>
              <strong>Fail-closed on error.</strong> If the HITL service is unreachable or returns 404,
              the code falls through to the P1AZ gate — never to PERMIT.
            </li>
            <li>
              <strong>Same contract as the gateway.</strong> <code>verifyHitlReceipt</code> in{' '}
              <code>hitlServiceClient.js</code> is a faithful port of the MCP gateway&apos;s TypeScript
              implementation — one verification contract, two runtimes.
            </li>
          </ul>

          <h3>Regression lock</h3>
          <p>
            <code>demo_api_server/tests/hitlBypass.regression.test.js</code> locks in four cases:{' '}
            no challenge ID → HITL, fake ID → HITL, valid ID → PERMIT, and{' '}
            <code>consentGiven: true</code> silently ignored → HITL. These tests must stay green.
          </p>
        </>
      ),
    },
```

- [ ] **Step 5.2 — Build the UI and confirm exit code 0**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build
```

Expected: build completes with exit code 0, no TypeScript/ESLint errors.

---

## Task 6 — Add regression log entry

**Files:**
- Modify: `REGRESSION_PLAN.md`

- [ ] **Step 6.1 — Add §4 Bug Fix Log entry**

Open `/Users/curtismuir/Development/AI-Demo/REGRESSION_PLAN.md` and append the following entry to the §4 Bug Fix Log table (insert after the most recent entry):

```markdown
| 2026-06-04 | `agentPreflightService.js` | Attack 2 — HITL bypass via `consentGiven=true`: removed the raw-boolean shortcut; replaced with `hitlChallengeId` + `verifyHitlReceipt` verification. `consentGiven` parameter removed from `evaluate()` and `dispatchVerticalIntent`. Regression locked in `hitlBypass.regression.test.js`. |
```

---

## Task 7 — Final verification run

- [ ] **Step 7.1 — Run both regression suites**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
npx jest agentPreflight.regression hitlBypass.regression --no-coverage
```

Expected: all tests pass, 0 failures.

- [ ] **Step 7.2 — Run the full BFF test suite to check for regressions**

```bash
cd /Users/curtismuir/Development/AI-Demo && npm run test:api-server
```

Expected: exit code 0. If any pre-existing failures exist, confirm they are not caused by this change (they must have existed before Task 1).

- [ ] **Step 7.3 — Confirm UI build is still green**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build
```

Expected: exit code 0.

- [ ] **Step 7.4 — Commit**

```bash
git -C /Users/curtismuir/Development/AI-Demo add \
  demo_api_server/services/agentPreflightService.js \
  demo_api_server/services/demoAgentLangGraphService.js \
  demo_api_server/tests/agentPreflight.regression.test.js \
  demo_api_server/tests/hitlBypass.regression.test.js \
  demo_api_ui/src/components/education/AiAttacksPanel.js \
  REGRESSION_PLAN.md
git -C /Users/curtismuir/Development/AI-Demo commit -m "fix(authz): close HITL bypass — replace consentGiven shortcut with hitlChallengeId verification"
```

---

## Self-review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Harden `evaluate()`: drop `consentGiven`, add `hitlChallengeId` | Task 1 |
| Verify via `getChallengeStatus` + `verifyHitlReceipt` when ID present | Task 1, Step 1.2 |
| No challenge ID + HITL policy → create new challenge, return HITL | Pre-existing path in `evaluate()` — unchanged. The P1AZ gate still runs and returns HITL block; `evaluate()` still calls `createChallenge` and returns `{ decision: 'HITL', ... }` |
| Update `demoAgentLangGraphService` to extract `hitlChallengeId` from body | Task 2 |
| Regression test (a): no ID on transfer → HITL | Task 4, test (a) |
| Regression test (b): fake ID → HITL re-issued | Task 4, test (b) |
| Regression test (c): valid verified ID → PERMIT | Task 4, test (c) |
| Update existing `agentPreflight.regression.test.js` | Task 3 |
| Add "HITL Bypass" tab to `AiAttacksPanel.js` | Task 5 |
| §4 regression log entry | Task 6 |

**Placeholder scan:** No TBDs, no "add appropriate error handling", no forward references to undefined functions. All code uses exact method signatures from the read files (`getChallengeStatus(id)`, `verifyHitlReceipt(status, userId, agentId, tool)`, `createChallenge(payload, correlationId)`).

**Type consistency:** `hitlChallengeId` is `string | null` throughout — destructure default `null`, body extraction produces `string | null` (the ternary forces null for falsy), gate receives `null` when absent. `verifyHitlReceipt` receives `(status, userSub || undefined, agentId || undefined, tool)` matching its signature `(status, expectedUserId, expectedAgentId, expectedTool, now?)`.
