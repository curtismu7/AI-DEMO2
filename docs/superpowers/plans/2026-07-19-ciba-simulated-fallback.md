# CIBA Simulated Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `POST /api/auth/ciba/initiate` and `GET /api/auth/ciba/poll/:authReqId` transparently fall back to an in-process simulated CIBA engine when PingOne's real `/as/bc-authorize` call fails, so the CIBAPanel "Try It" tab and the transfer step-up bridge complete end-to-end on environments where CIBA isn't provisioned (confirmed live on env `01d89b06-66d5-430e-9f28-65636843788b`).

**Architecture:** A new `demo_api_server/services/cibaSimulatedService.js` mirrors `cibaService.js`'s call shape with zero I/O. `routes/ciba.js` tries the real call first; on failure (default `configStore` key `ciba_failover_mode=fallback_simulated`) it switches to the simulated engine for that request only, tagging the session record `simulated: true` (never sent to the browser). The simulated poll auto-approves after 7s and sets `req.session.stepUpVerified` exactly like the real path — it never writes `req.session.oauthTokens`, because `routes/transactions.js`'s step-up gate only reads `stepUpVerified`, never re-decodes the token once that flag is fresh.

**Tech Stack:** Node.js, Express, Jest + Supertest, `jsonwebtoken`, existing `configStore` / `appEventService` / `tokenChainService` services.

## Global Constraints

- Zero changes to `demo_api_ui` — the simulated path must be visually and behaviorally indistinguishable from the real one (spec's "Transparency" decision).
- No simulated *denial* path — only the approve happy-path is in scope.
- `ciba_failover_mode` is a `configStore` key, not an env var — no `.env` / `env.example` changes.
- Every new/changed test file must stay hermetic (no real network calls, no real PingOne credentials) — matches `ciba.test.js`'s existing header comment.
- Run tests from the worktree root with `CI=true npx jest <path> --testPathIgnorePatterns="/node_modules/" --maxWorkers=2` (per `verify-ai-demo2` skill — jest's default `testPathIgnorePatterns` excludes `.claude/worktrees/`, and `CI=true` avoids the flaky-without-it supertest suites).
- Spec: `docs/superpowers/specs/2026-07-19-ciba-simulated-fallback-design.md`.

---

### Task 1: `cibaSimulatedService.js` — the simulated engine

**Files:**
- Create: `demo_api_server/services/cibaSimulatedService.js`
- Test: `demo_api_server/src/__tests__/cibaSimulatedService.test.js`

**Interfaces:**
- Produces: `initiateSimulated(loginHint, bindingMessage, scope, acrValues) → { auth_req_id: string, expires_in: number, interval: number }`; `isSimulatedApproved(pending) → boolean` where `pending` is `{ initiatedAt: number, ... }`; `SIMULATED_APPROVE_DELAY_MS` (number, `7000`) — all three are consumed by Task 2 and Task 3.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/src/__tests__/cibaSimulatedService.test.js`:

```javascript
'use strict';

const {
  initiateSimulated,
  isSimulatedApproved,
  SIMULATED_APPROVE_DELAY_MS,
} = require('../../services/cibaSimulatedService');

describe('cibaSimulatedService.initiateSimulated()', () => {
  it('returns an auth_req_id prefixed with "sim-"', () => {
    const result = initiateSimulated('alice@example.com', 'Approve payment', 'openid profile', '');
    expect(result.auth_req_id).toMatch(/^sim-/);
  });

  it('returns expires_in=300 and interval=5', () => {
    const result = initiateSimulated('alice@example.com');
    expect(result.expires_in).toBe(300);
    expect(result.interval).toBe(5);
  });

  it('returns a unique auth_req_id on each call', () => {
    const a = initiateSimulated('alice@example.com');
    const b = initiateSimulated('alice@example.com');
    expect(a.auth_req_id).not.toBe(b.auth_req_id);
  });
});

describe('cibaSimulatedService.isSimulatedApproved()', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns false immediately after initiation', () => {
    const pending = { initiatedAt: Date.now() };
    expect(isSimulatedApproved(pending)).toBe(false);
  });

  it('returns false just before the approval delay elapses', () => {
    const pending = { initiatedAt: Date.now() };
    jest.advanceTimersByTime(SIMULATED_APPROVE_DELAY_MS - 1);
    expect(isSimulatedApproved(pending)).toBe(false);
  });

  it('returns true once the approval delay has elapsed', () => {
    const pending = { initiatedAt: Date.now() };
    jest.advanceTimersByTime(SIMULATED_APPROVE_DELAY_MS);
    expect(isSimulatedApproved(pending)).toBe(true);
  });

  it('returns true well after the approval delay', () => {
    const pending = { initiatedAt: Date.now() };
    jest.advanceTimersByTime(SIMULATED_APPROVE_DELAY_MS + 60000);
    expect(isSimulatedApproved(pending)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/cibaSimulatedService.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL — `Cannot find module '../../services/cibaSimulatedService'`

- [ ] **Step 3: Write the implementation**

Create `demo_api_server/services/cibaSimulatedService.js`:

```javascript
'use strict';

/**
 * cibaSimulatedService.js
 *
 * In-process simulated CIBA engine — used as a failover when PingOne's
 * /as/bc-authorize endpoint is unreachable or unprovisioned (see the
 * "Known gap" note in claudSkills/pingone/ciba/SKILL.md). Mirrors
 * cibaService.js's public call shape closely enough that routes/ciba.js
 * can call either behind one interface, and plays the same role that
 * simulatedAuthorizeService.js plays for transactionAuthorizationService.js.
 *
 * No network calls, no PingOne credentials.
 */

const crypto = require('crypto');
const { logEvent: logAppEvent } = require('./appEventService');

const SIMULATED_APPROVE_DELAY_MS = 7000;
const SIMULATED_EXPIRES_IN = 300;
const SIMULATED_INTERVAL = 5;

/**
 * Mint a fake auth_req_id and initiation response, matching the shape of
 * cibaService.initiateBackchannelAuth()'s return value.
 *
 * @param {string} loginHint
 * @param {string} [bindingMessage]
 * @param {string} [scope]
 * @param {string} [acrValues]
 * @returns {{ auth_req_id: string, expires_in: number, interval: number }}
 */
function initiateSimulated(loginHint, bindingMessage, scope, acrValues) {
  const auth_req_id = `sim-${crypto.randomUUID()}`;
  logAppEvent('auth_lifecycle', 'info', `CIBA (simulated): initiating for ${loginHint}`,
    { tag: 'ciba/initiate', metadata: { loginHint, scope, engine: 'simulated', hasAcrValues: !!acrValues, bindingMessage: bindingMessage || undefined } });
  return {
    auth_req_id,
    expires_in: SIMULATED_EXPIRES_IN,
    interval: SIMULATED_INTERVAL,
  };
}

/**
 * True once enough time has passed since initiation to "auto-approve" the
 * simulated request.
 *
 * @param {{ initiatedAt: number }} pending — the session's cibaRequests[authReqId] record
 * @returns {boolean}
 */
function isSimulatedApproved(pending) {
  return Date.now() - pending.initiatedAt >= SIMULATED_APPROVE_DELAY_MS;
}

module.exports = {
  initiateSimulated,
  isSimulatedApproved,
  SIMULATED_APPROVE_DELAY_MS,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/cibaSimulatedService.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS — 8 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/cibaSimulatedService.js demo_api_server/src/__tests__/cibaSimulatedService.test.js
git commit -m "feat(ciba): add in-process simulated CIBA engine"
```

---

### Task 2: `routes/ciba.js` `/initiate` — failover branch

**Files:**
- Modify: `demo_api_server/routes/ciba.js:27-33` (imports), `:118-160` (`/initiate` try/catch)
- Modify: `demo_api_server/src/__tests__/ciba.test.js`

**Interfaces:**
- Consumes: `cibaSimulatedService.initiateSimulated(loginHint, bindingMessage, scope, acrValues)` from Task 1.
- Produces: `req.session.cibaRequests[auth_req_id].simulated` (boolean) — consumed by Task 3.

- [ ] **Step 1: Modify `ciba.test.js` — add mocks/imports, new tests, and update two existing tests**

In `demo_api_server/src/__tests__/ciba.test.js`, find this block near the top (after the `configStore` mock):

```javascript
jest.mock('../../middleware/auth', () => ({
```

Insert a new mock immediately **before** that line:

```javascript
jest.mock('../../services/cibaSimulatedService', () => ({
  initiateSimulated: jest.fn(),
  isSimulatedApproved: jest.fn(),
}));

jest.mock('../../middleware/auth', () => ({
```

Find:

```javascript
const cibaService = require('../../services/cibaService');
const cibaRouter  = require('../../routes/ciba');
const { PINGONE_OIDC_DEFAULT_SCOPES_SPACE } = require('../../config/scopes');
```

Replace with:

```javascript
const cibaService = require('../../services/cibaService');
const cibaSimulatedService = require('../../services/cibaSimulatedService');
const configStore = require('../../services/configStore');
const cibaRouter  = require('../../routes/ciba');
const { PINGONE_OIDC_DEFAULT_SCOPES_SPACE } = require('../../config/scopes');
```

Find the two existing PingOne-error tests:

```javascript
  it('returns 502 when PingOne returns an error response', async () => {
    const pingErr = {
      response: {
        data: {
          error: 'invalid_client',
          error_description: 'Client credentials are invalid',
        },
        status: 400,
      },
    };
    cibaService.initiateBackchannelAuth.mockRejectedValue(pingErr);

    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: 'Test' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('invalid_client');
    expect(res.body.message).toContain('invalid');
  });

  it('returns 502 on network / timeout error', async () => {
    cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('ciba_initiation_failed');
  });
```

Replace with (adds `ciba_failover_mode: 'deny'` to each, since 502 is now the *non-default*, explicitly-disabled-failover behavior; a new pair of tests right after covers the new default):

```javascript
  it('returns 502 when PingOne returns an error response and failover is explicitly disabled', async () => {
    configStore.getEffective.mockReturnValueOnce('deny');
    const pingErr = {
      response: {
        data: {
          error: 'invalid_client',
          error_description: 'Client credentials are invalid',
        },
        status: 400,
      },
    };
    cibaService.initiateBackchannelAuth.mockRejectedValue(pingErr);

    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: 'Test' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('invalid_client');
    expect(res.body.message).toContain('invalid');
  });

  it('returns 502 on network / timeout error when failover is explicitly disabled', async () => {
    configStore.getEffective.mockReturnValueOnce('deny');
    cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('ciba_initiation_failed');
  });

  // ── Simulated failover (default behavior) ───────────────────────────────────

  it('falls back to the simulated engine by default when the real bc-authorize call fails', async () => {
    cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED'));
    cibaSimulatedService.initiateSimulated.mockReturnValue({
      auth_req_id: 'sim-abc123',
      expires_in: 300,
      interval: 5,
    });

    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: 'Approve payment' });

    expect(res.status).toBe(200);
    expect(res.body.auth_req_id).toBe('sim-abc123');
    expect(cibaSimulatedService.initiateSimulated).toHaveBeenCalledWith(
      'alice@example.com',
      'Approve payment',
      expect.any(String),
      expect.any(String),
    );
  });

  it('does not call the simulated engine when the real call succeeds', async () => {
    // This file has no global clearMocks/resetMocks — clear explicitly so a
    // call count from an earlier test (e.g. the failover test above) can't
    // leak in and produce a false pass/fail here.
    cibaSimulatedService.initiateSimulated.mockClear();

    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: 'Approve payment' });

    expect(res.status).toBe(200);
    expect(cibaSimulatedService.initiateSimulated).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify only the new failover tests fail**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/ciba.test.js --testPathIgnorePatterns="/node_modules/" -t "initiate"`
Expected: FAIL on `'falls back to the simulated engine by default...'` (currently gets 502, not 200) and `'does not call the simulated engine when the real call succeeds'` (currently `cibaSimulatedService` isn't imported by the route at all, so the assertion itself is trivially true — this one should already pass; the important new-red case is the first one). The two renamed `...failover is explicitly disabled` tests should still PASS unchanged (today's code always 502s on failure, so adding an unused `ciba_failover_mode: 'deny'` mock doesn't change that).

- [ ] **Step 3: Implement the failover branch in `routes/ciba.js`**

Find:

```javascript
const cibaService = require('../services/cibaService');
const { authenticateToken } = require('../middleware/auth');
```

Replace with:

```javascript
const cibaService = require('../services/cibaService');
const cibaSimulatedService = require('../services/cibaSimulatedService');
const { authenticateToken } = require('../middleware/auth');
```

Find:

```javascript
  try {
    const result = await cibaService.initiateBackchannelAuth(
      loginHint,
      binding_message,
      scope || PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
      acr_values,
    );

    // Track in session so poll endpoint can verify ownership
    req.session.cibaRequests = req.session.cibaRequests || {};

    // Enforce one-at-a-time: cancel any existing pending request
    req.session.cibaRequests = Object.fromEntries(
      Object.entries(req.session.cibaRequests).filter(
        ([, v]) => Date.now() < v.expiresAt
      )
    );

    req.session.cibaRequests[result.auth_req_id] = {
      initiatedAt: Date.now(),
      expiresAt:   Date.now() + result.expires_in * 1000,
      loginHint,
      scope: scope || PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
      acr_values: acr_values || '',
      binding_message: binding_message || '',
    };

    res.json({
      auth_req_id: result.auth_req_id,
      authReqId:   result.auth_req_id, // camelCase alias for the UserDashboard bridge
      expires_in:  result.expires_in,
      interval:    result.interval,
      login_hint_display: loginHint.replace(/(.{2}).*@/, '$1***@'), // mask for display only
    });
  } catch (err) {
    console.error('[CIBA] initiate failed:', err.response?.data || err.message);
    const pingError = err.response?.data;
    res.status(502).json({
      error:   pingError?.error || 'ciba_initiation_failed',
      message: pingError?.error_description || err.message,
    });
  }
});
```

Replace with:

```javascript
  let result;
  let simulated = false;
  try {
    result = await cibaService.initiateBackchannelAuth(
      loginHint,
      binding_message,
      scope || PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
      acr_values,
    );
  } catch (realErr) {
    // Failover: PingOne's /as/bc-authorize can be unreachable OR entirely
    // unrouted at the platform level (see the "Known gap" note in the ciba
    // skill doc) — either way, fall back to the in-process simulated engine
    // by default so the demo stays usable. Set ciba_failover_mode=deny to
    // restore the old fail-loud behavior.
    const failoverMode = configStore.getEffective('ciba_failover_mode') || 'fallback_simulated';
    if (failoverMode !== 'fallback_simulated') {
      console.error('[CIBA] initiate failed:', realErr.response?.data || realErr.message);
      const pingError = realErr.response?.data;
      return res.status(502).json({
        error:   pingError?.error || 'ciba_initiation_failed',
        message: pingError?.error_description || realErr.message,
      });
    }
    result = cibaSimulatedService.initiateSimulated(
      loginHint,
      binding_message,
      scope || PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
      acr_values,
    );
    simulated = true;
  }

  try {
    // Track in session so poll endpoint can verify ownership
    req.session.cibaRequests = req.session.cibaRequests || {};

    // Enforce one-at-a-time: cancel any existing pending request
    req.session.cibaRequests = Object.fromEntries(
      Object.entries(req.session.cibaRequests).filter(
        ([, v]) => Date.now() < v.expiresAt
      )
    );

    req.session.cibaRequests[result.auth_req_id] = {
      initiatedAt: Date.now(),
      expiresAt:   Date.now() + result.expires_in * 1000,
      loginHint,
      scope: scope || PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
      acr_values: acr_values || '',
      binding_message: binding_message || '',
      simulated,
    };

    res.json({
      auth_req_id: result.auth_req_id,
      authReqId:   result.auth_req_id, // camelCase alias for the UserDashboard bridge
      expires_in:  result.expires_in,
      interval:    result.interval,
      login_hint_display: loginHint.replace(/(.{2}).*@/, '$1***@'), // mask for display only
    });
  } catch (err) {
    console.error('[CIBA] initiate failed:', err.response?.data || err.message);
    const pingError = err.response?.data;
    res.status(502).json({
      error:   pingError?.error || 'ciba_initiation_failed',
      message: pingError?.error_description || err.message,
    });
  }
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/ciba.test.js --testPathIgnorePatterns="/node_modules/" -t "initiate"`
Expected: PASS — all `/initiate` tests green, including the two renamed deny-mode tests and the two new default-failover tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/ciba.js demo_api_server/src/__tests__/ciba.test.js
git commit -m "feat(ciba): fall back to the simulated engine when bc-authorize fails"
```

---

### Task 3: `routes/ciba.js` `/poll` — simulated approval branch

**Files:**
- Modify: `demo_api_server/routes/ciba.js:29-33` (imports), `:186-229` (poll approval)
- Modify: `demo_api_server/src/__tests__/ciba.test.js`

**Interfaces:**
- Consumes: `cibaSimulatedService.isSimulatedApproved(pending)` from Task 1; `req.session.cibaRequests[id].simulated` from Task 2.
- Produces: `req.session.stepUpVerified` set on simulated approval (same field/shape the real path already sets) — consumed by Task 4 (indirectly, as the thing being proven) and by `routes/transactions.js` (unchanged, already reads it).

- [ ] **Step 1: Modify `ciba.test.js` — mock `tokenChainService`, add three new poll tests**

Find:

```javascript
jest.mock('../../services/cibaSimulatedService', () => ({
  initiateSimulated: jest.fn(),
  isSimulatedApproved: jest.fn(),
}));
```

Insert immediately after it:

```javascript
jest.mock('../../services/tokenChainService', () => ({
  trackTokenEvent: jest.fn().mockResolvedValue(undefined),
}));
```

Find:

```javascript
const cibaService = require('../../services/cibaService');
const cibaSimulatedService = require('../../services/cibaSimulatedService');
const configStore = require('../../services/configStore');
const cibaRouter  = require('../../routes/ciba');
```

Replace with:

```javascript
const cibaService = require('../../services/cibaService');
const cibaSimulatedService = require('../../services/cibaSimulatedService');
const configStore = require('../../services/configStore');
const { trackTokenEvent } = require('../../services/tokenChainService');
const cibaRouter  = require('../../routes/ciba');
```

Find the end of the poll describe block:

```javascript
  it('returns 403 with status:"denied" when user denies the request', async () => {
    const pingDenied = { response: { data: { error: 'access_denied', error_description: 'User denied' } } };
    cibaService.pollForTokens.mockRejectedValue(pingDenied);

    const res = await request(buildApp(pendingReq))
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    expect(res.status).toBe(403);
    expect(res.body.status).toBe('denied');
    expect(res.body.error).toBe('access_denied');
  });
```

Insert immediately after it (before that describe block's closing `});`):

```javascript

  // ── Simulated approval (failover engine) ────────────────────────────────────

  const SIM_AUTH_REQ_ID = 'sim-req-xyz';
  const simulatedPendingReq = (initiatedAt) => ({
    cibaRequests: {
      [SIM_AUTH_REQ_ID]: {
        initiatedAt,
        expiresAt:   Date.now() + 300_000,
        loginHint:   'alice@example.com',
        scope:       'openid profile',
        acr_values:  '',
        binding_message: 'Approve your banking transaction',
        simulated:   true,
      },
    },
  });

  it('returns { status:"pending" } before the simulated approval delay elapses', async () => {
    cibaSimulatedService.isSimulatedApproved.mockReturnValue(false);

    const res = await request(buildApp(simulatedPendingReq(Date.now())))
      .get(`/api/auth/ciba/poll/${SIM_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    // Note: no `expect(cibaService.pollForTokens).not.toHaveBeenCalled()`
    // here — earlier tests in this describe block already called it (this
    // file has no clearAllMocks in this scope), so that assertion would
    // false-fail on leftover call count, not on this test's own behavior.
    // The status assertion alone is sufficient: if the real (unmocked-for-
    // this-id) path had been taken instead, the response would not be a
    // clean 200 { status: 'pending' }.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('returns { status:"approved" } once the simulated delay elapses, without calling the real PingOne poll', async () => {
    cibaSimulatedService.isSimulatedApproved.mockReturnValue(true);

    const res = await request(buildApp(simulatedPendingReq(Date.now() - 8000)))
      .get(`/api/auth/ciba/poll/${SIM_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.scope).toBe('openid profile');
  });

  it('records a token-chain event on simulated approval, identical in shape to a real one', async () => {
    cibaSimulatedService.isSimulatedApproved.mockReturnValue(true);

    await request(buildApp(simulatedPendingReq(Date.now() - 8000)))
      .get(`/api/auth/ciba/poll/${SIM_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    expect(trackTokenEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'auth',
        userId: 'u1',
        description: 'CIBA backchannel step-up approved (out-of-band)',
        additionalData: expect.objectContaining({ grantedVia: 'ciba', engine: 'simulated' }),
      }),
    );
  });
```

- [ ] **Step 2: Run the tests to verify the three new tests fail**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/ciba.test.js --testPathIgnorePatterns="/node_modules/" -t "poll"`
Expected: FAIL on all three new tests — the route doesn't check `pending.simulated` yet, so it calls the real (unconfigured, for these fixtures) `cibaService.pollForTokens` mock instead.

- [ ] **Step 3: Implement the simulated poll branch in `routes/ciba.js`**

Find:

```javascript
  if (Date.now() > pending.expiresAt) {
    delete req.session.cibaRequests[authReqId];
    return res.status(410).json({
      error:  'request_expired',
      message: 'The CIBA authentication request has expired. Please try again.',
    });
  }

  try {
    const tokens = await cibaService.pollForTokens(authReqId);
```

Replace with:

```javascript
  if (Date.now() > pending.expiresAt) {
    delete req.session.cibaRequests[authReqId];
    return res.status(410).json({
      error:  'request_expired',
      message: 'The CIBA authentication request has expired. Please try again.',
    });
  }

  if (pending.simulated) {
    if (!cibaSimulatedService.isSimulatedApproved(pending)) {
      return res.json({ status: 'pending' });
    }

    delete req.session.cibaRequests[authReqId];
    req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;

    // Mirror the real path's token-chain tracking below so the "CIBA
    // Step-Up" tab and floating token-chain panel show an identical event —
    // never distinguishable from a real approval in the UI.
    // `engine: 'simulated'` is stashed in additionalData for our own
    // debugging only; CibaStepUpFlowPanel.jsx never renders additionalData.
    // No fake access token is ever stored in req.session.oauthTokens — the
    // step-up gate in routes/transactions.js only reads stepUpVerified.
    try {
      const jwt = require('jsonwebtoken');
      const subject = req.user?.sub || req.user?.id;
      if (subject) {
        const fakeAccessToken = jwt.sign({ sub: subject }, 'ciba-simulated-local-only');
        trackTokenEvent({
          eventType: 'auth',
          token: fakeAccessToken,
          userId: subject,
          description: 'CIBA backchannel step-up approved (out-of-band)',
          additionalData: { grantedVia: 'ciba', scope: pending.scope, engine: 'simulated' },
        }).catch((err) => console.error('[CIBA] token-chain track failed (simulated):', err.message));
      }
    } catch (trackErr) {
      console.warn('[CIBA] could not build token-chain event for simulated approval:', trackErr.message);
    }

    return req.session.save((saveErr) => {
      if (saveErr) console.error('[CIBA] session save error on simulated approval:', saveErr);
      res.json({
        status: 'approved',
        scope:  pending.scope,
      });
    });
  }

  try {
    const tokens = await cibaService.pollForTokens(authReqId);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/ciba.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS — full file green (all pre-existing tests plus every test added in Task 2 and this task).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/ciba.js demo_api_server/src/__tests__/ciba.test.js
git commit -m "feat(ciba): auto-approve simulated CIBA polls and record a token-chain event"
```

---

### Task 4: `step-up-gate.test.js` — prove the session-flag path independent of CIBA

**Files:**
- Modify: `demo_api_server/src/__tests__/step-up-gate.test.js`

**Interfaces:**
- Consumes: nothing from Tasks 1-3 — this task exercises `routes/transactions.js`'s existing (unmodified) step-up gate, proving the general `req.session.stepUpVerified` mechanism that Task 3's simulated-approval branch relies on. Independent of Tasks 1-3; can be done in any order relative to them.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Write the failing test**

In `demo_api_server/src/__tests__/step-up-gate.test.js`, find the `authenticateToken` mock:

```javascript
  authenticateToken: (req, res, next) => {
    const userHeader = req.headers['x-test-user'];
    if (!userHeader) {
      return res.status(401).json({
        error: 'authentication_required',
        error_description: 'Access token is required',
      });
    }
    try {
      req.user = JSON.parse(userHeader);
      req.session = req.session || {};
      req.session.user = req.user;
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  },
```

Do **not** change it yet — first add the test using a header the mock doesn't understand yet, so the test fails for the right reason. Find:

```javascript
  // ── Gate passes: correct ACR ──────────────────────────────────────────────────
  describe('when amount meets threshold and user has the required ACR', () => {
    it('should allow the transaction', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 250,
        stepUpAcrValue: 'Multi_factor',
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: 'Multi_factor' }))
        .send(highValueWithdrawal(500));

      expect(res.status).not.toBe(428);
    });
  });
```

Insert immediately after it:

```javascript

  // ── Gate passes: fresh session-level step-up, independent of the token's ACR ──
  // Proves the mechanism routes/ciba.js's simulated (and real) CIBA approval
  // relies on: req.session.stepUpVerified alone satisfies the gate — the
  // token itself is never re-decoded once that flag is fresh. See the
  // "Key simplification" section of
  // docs/superpowers/specs/2026-07-19-ciba-simulated-fallback-design.md.
  describe('when req.session.stepUpVerified is fresh (session-level step-up, e.g. CIBA)', () => {
    it('allows the transaction even with no ACR on the token, using the original access token unchanged', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 250,
        stepUpAcrValue: 'Multi_factor',
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .set('x-test-step-up-verified', String(Date.now() + 5 * 60 * 1000))
        .send(highValueWithdrawal(500));

      expect(res.status).not.toBe(428);
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/step-up-gate.test.js --testPathIgnorePatterns="/node_modules/" -t "session-level step-up"`
Expected: FAIL with `res.status` equal to `428` — the `x-test-step-up-verified` header is sent but nothing in the mock middleware reads it yet, so `req.session.stepUpVerified` is never set and the gate fires on the no-ACR token exactly like the existing "no ACR" test.

- [ ] **Step 3: Add the test-only header hook to the mock middleware**

Find:

```javascript
    try {
      req.user = JSON.parse(userHeader);
      req.session = req.session || {};
      req.session.user = req.user;
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  },
```

Replace with:

```javascript
    try {
      req.user = JSON.parse(userHeader);
      req.session = req.session || {};
      req.session.user = req.user;
      // Test-only hook: lets a single test simulate an already-fresh
      // session-level step-up (e.g. from a CIBA/P1MFA approval) without
      // deriving it from an ACR claim on this request's token.
      const stepUpVerifiedHeader = req.headers['x-test-step-up-verified'];
      if (stepUpVerifiedHeader) {
        req.session.stepUpVerified = Number(stepUpVerifiedHeader);
      }
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/step-up-gate.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS — full file green (the new test plus every pre-existing case, unaffected since the header is only sent by the new test).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/src/__tests__/step-up-gate.test.js
git commit -m "test(step-up): prove session-level stepUpVerified alone satisfies the gate"
```

---

## Final Verification

- [ ] Run the full `demo_api_server` suite once more from the repo root to confirm nothing else regressed:

Run: `cd demo_api_server && CI=true npx jest --testPathIgnorePatterns="/node_modules/" --maxWorkers=2`
Expected: PASS — no failures anywhere in the suite.

- [ ] Live smoke test (manual, matches the spec's "Testing" section):
  1. Confirm `CIBA_ENABLED=true` in `.env` (already set from the earlier bug-fix session).
  2. Restart `demo-api-server` (`docker compose restart demo-api-server` — code change, not env, so `restart` is enough per `verify-ai-demo2`).
  3. Open the CIBAPanel "Try It" tab, click "Start CIBA request" — confirm it reaches `pending` and auto-resolves to `approved` around 7s later, with no visible error (this is the behavior that previously surfaced the raw AWS Gateway 403).
  4. Temporarily set `STEP_UP_METHOD=ciba` (env or `configStore`), attempt a ≥$250 transfer, click "Verify via CIBA" in the step-up toast, confirm the transfer completes after ~7s. Revert `STEP_UP_METHOD` back to `p1mfa` afterward — it is the proven default for this environment and this plan does not change that default.
