# Manager-as-Approver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a manager a real, second-principal way to approve an employee's high-value workforce action (a $600 expense), replacing today's self-approval-only CIBA flow with a genuine cross-session approval for this one case, while leaving every other CIBA flow (banking's `bk-ciba`, any vertical without a manager delegation) completely unchanged.

**Architecture:** The pending-approval state lives as a new `pendingApproval` sub-object on the existing delegation LMDB record (no new store). The employee's side reuses the existing CIBA UI/polling untouched except for one new branch: when CIBA's `/initiate` finds the employee has an active manager delegation with `create_transfer` scope, it tags the session's CIBA record with that delegation's id and writes the pending approval onto the delegation record instead of relying on the timer; `/poll` then reads that record's status instead of the simulated timer. The manager's side is a plain authenticated REST action — two new endpoints on `routes/delegation.js`, surfaced as an inline Approve/Deny row on the existing `/delegation` page for a delegation the manager granted. Two new workforce demo personas (manager `demoWfManager`, employee `demoWfEmployee`) and one new workforce chip (`wf-ciba`) complete the demo path.

**Tech Stack:** Node/Express, LMDB (`lmdb` package via `services/lmdb/openEnv.js`), Jest + Supertest (API), React + Vitest/RTL (UI).

## Global Constraints

- **Emoji allowlist (REGRESSION_PLAN §0):** only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` may appear in UI text/code.
- **Worktree only:** all edits in `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/manager-approver`. Stage files explicitly (`git add <path>`), never `git add -A`. Verify `git branch --show-current` before each commit.
- **No new PingOne platform dependency:** this plan works entirely inside the *simulated* CIBA engine (`cibaSimulatedService.js`) and the existing delegation LMDB record. Do not touch `cibaService.js`'s real `bc-authorize` branch.
- **No behavior change for existing CIBA flows:** every new branch in `routes/ciba.js` must fall through to today's exact behavior when the acting user has no active manager delegation with `create_transfer` scope. This must be asserted explicitly in tests, not just assumed.
- **Ownership check, not existence-leaking:** the two new approve/deny endpoints must return the same undifferentiated `404 not_found` for "doesn't exist," "not yours," and "nothing pending" — mirroring `revokeDelegation`'s existing security posture (`demo_api_server/services/delegationService.js`), never a distinguishing error that reveals which case occurred to a non-owner.
- **One pending approval at a time per delegation** (no queue) — a new `requestApproval` call overwrites any prior pending/resolved approval on that record, matching how CIBA's own `/initiate` already replaces a session's prior pending request.
- **Provisioning is code-only in this plan.** Task 6 adds the provisioning method and a mocked unit test; it does **not** run `setup:fresh` / `pingone:bootstrap` against a real PingOne environment — that is a separate, explicit action for the user to trigger when ready (per CLAUDE.md: PingOne lifecycle scripts mutate a live environment and must be read before running).
- **UI build gate:** after any `demo_api_ui/` change, run `cd demo_api_ui && npm run build` — must exit `0`.
- **Worktree jest gotcha:** running jest from inside `.claude/worktrees/` needs the ignore-pattern override documented in the `verify-ai-demo2` skill: `--testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"` (drop only the `.claude/worktrees/` entry — never replace the whole array with just `/node_modules/`, or `tests/real/`'s live-backend suite un-ignores and produces unrelated failures).

---

### Task 1: `delegationService` — pendingApproval data model

**Files:**
- Modify: `demo_api_server/services/delegationService.js`
- Create: `demo_api_server/tests/delegationApproval.test.js`

**Interfaces:**
- Produces: `requestApproval(delegationId, { authReqId, amount, tool, bindingMessage }) → Promise<{ ok: boolean, error?: string }>`; `resolveApproval(delegationId, managerUserId, decision) → Promise<{ ok: boolean, error?: string }>` where `decision` is `'approved'|'denied'`; `findActiveByDelegate(delegateUserId) → Promise<record|null>` (record has `id`, `delegator_user_id`, `scopes`, etc. — same shape `toRecord()` already produces); `getApprovalStatus(delegationId) → Promise<{ status: 'pending'|'approved'|'denied', approverUserId: string|null }>`.
- Consumes: nothing new — uses the module's existing `_db()`/`toRecord()`.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/delegationApproval.test.js`:

```js
'use strict';

const mockRecords = new Map();

jest.mock('../services/lmdb/openEnv', () => ({
  getDb: () => ({
    putSync: (k, v) => mockRecords.set(k, v),
    get:     (k)    => mockRecords.get(k),
    getRange: ()    => [...mockRecords.values()].map(value => ({ value })),
  }),
}));

jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserByUsername: jest.fn().mockResolvedValue({ user: null }),
}));
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockRejectedValue(new Error('not configured')),
}));
jest.mock('../services/pingoneBootstrapService', () => ({
  fetchFirstPopulationId: jest.fn().mockResolvedValue('pop-id'),
}));
jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  setDelegatedToAttribute: jest.fn().mockResolvedValue(undefined),
}));

const {
  grantDelegation,
  requestApproval,
  resolveApproval,
  findActiveByDelegate,
  getApprovalStatus,
} = require('../services/delegationService');

beforeEach(() => mockRecords.clear());

describe('findActiveByDelegate', () => {
  test('finds an active delegation with create_transfer scope for the delegate user', async () => {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1',
      delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com',
      scopes: ['view_accounts', 'create_transfer'],
    });
    // Manually attach a delegate_user_id — grantDelegation leaves it null when
    // PingOne management creds aren't configured (mocked above), but a real
    // grant always sets it once the delegate user is provisioned/found.
    const rec = { ...grant.delegation, delegate_user_id: 'dana-1' };
    mockRecords.set(rec.id, rec);

    const found = await findActiveByDelegate('dana-1');
    expect(found).not.toBeNull();
    expect(found.id).toBe(rec.id);
    expect(found.delegator_user_id).toBe('manager-1');
  });

  test('returns null when the delegate has no active create_transfer delegation', async () => {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1',
      delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com',
      scopes: ['view_accounts'], // no create_transfer
    });
    const rec = { ...grant.delegation, delegate_user_id: 'dana-1' };
    mockRecords.set(rec.id, rec);

    expect(await findActiveByDelegate('dana-1')).toBeNull();
  });

  test('returns null for a revoked delegation', async () => {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1',
      delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com',
      scopes: ['create_transfer'],
    });
    const rec = { ...grant.delegation, delegate_user_id: 'dana-1', status: 'revoked' };
    mockRecords.set(rec.id, rec);

    expect(await findActiveByDelegate('dana-1')).toBeNull();
  });
});

describe('requestApproval / getApprovalStatus', () => {
  test('writes a pending approval, readable via getApprovalStatus', async () => {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1', delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com', scopes: ['create_transfer'],
    });
    const id = grant.delegation.id;

    const result = await requestApproval(id, {
      authReqId: 'auth-1', amount: 600, tool: 'submit_expense', bindingMessage: 'Approve $600 expense',
    });
    expect(result.ok).toBe(true);

    const status = await getApprovalStatus(id);
    expect(status.status).toBe('pending');
    expect(status.approverUserId).toBe('manager-1');
  });

  test('overwrites a prior pending approval on the same delegation (no queue)', async () => {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1', delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com', scopes: ['create_transfer'],
    });
    const id = grant.delegation.id;

    await requestApproval(id, { authReqId: 'auth-1', amount: 300, tool: 'submit_expense', bindingMessage: 'first' });
    await requestApproval(id, { authReqId: 'auth-2', amount: 600, tool: 'submit_expense', bindingMessage: 'second' });

    const status = await getApprovalStatus(id);
    expect(status.status).toBe('pending');
  });

  test('returns ok:false for an unknown delegation id', async () => {
    const result = await requestApproval('no-such-id', { authReqId: 'a', amount: 1, tool: 't', bindingMessage: 'b' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
  });
});

describe('resolveApproval', () => {
  async function seedPending() {
    const grant = await grantDelegation({
      delegatorUserId: 'manager-1', delegatorEmail: 'sam@example.com',
      delegateEmail: 'dana@example.com', scopes: ['create_transfer'],
    });
    const id = grant.delegation.id;
    await requestApproval(id, { authReqId: 'auth-1', amount: 600, tool: 'submit_expense', bindingMessage: 'b' });
    return id;
  }

  test('manager approves — status becomes approved', async () => {
    const id = await seedPending();
    const result = await resolveApproval(id, 'manager-1', 'approved');
    expect(result.ok).toBe(true);
    expect((await getApprovalStatus(id)).status).toBe('approved');
  });

  test('manager denies — status becomes denied', async () => {
    const id = await seedPending();
    const result = await resolveApproval(id, 'manager-1', 'denied');
    expect(result.ok).toBe(true);
    expect((await getApprovalStatus(id)).status).toBe('denied');
  });

  test('a non-owner cannot resolve the approval (undifferentiated not_found)', async () => {
    const id = await seedPending();
    const result = await resolveApproval(id, 'someone-else', 'approved');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
    expect((await getApprovalStatus(id)).status).toBe('pending'); // unchanged
  });

  test('resolving an unknown delegation id returns not_found', async () => {
    const result = await resolveApproval('no-such-id', 'manager-1', 'approved');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && npx jest tests/delegationApproval.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: FAIL — `requestApproval`, `resolveApproval`, `findActiveByDelegate`, `getApprovalStatus` are not exported yet (`TypeError: ... is not a function`).

- [ ] **Step 3: Implement in `delegationService.js`**

Add these four functions after `revokeDelegation` (before the `listDelegations` section) in `demo_api_server/services/delegationService.js`:

```js
// ---------------------------------------------------------------------------
// findActiveByDelegate — the active delegation (if any) where this user is
// the delegate AND holds create_transfer scope. This is what makes a CIBA
// request into a manager-approval flow instead of self-approval.
// ---------------------------------------------------------------------------

async function findActiveByDelegate(delegateUserId) {
  if (!delegateUserId) return null;
  for (const { value } of _db().getRange()) {
    if (
      value.delegate_user_id === delegateUserId &&
      value.status === 'active' &&
      Array.isArray(value.scopes) &&
      value.scopes.includes('create_transfer')
    ) {
      return toRecord(value);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// requestApproval / resolveApproval / getApprovalStatus — the pendingApproval
// sub-object lives on the delegation record itself (no new store). One
// pending approval per delegation at a time — a new request overwrites a
// prior pending or resolved one, matching CIBA's own one-at-a-time model.
// ---------------------------------------------------------------------------

async function requestApproval(delegationId, { authReqId, amount, tool, bindingMessage }) {
  const rec = _db().get(delegationId);
  if (!rec) return { ok: false, error: 'not_found' };
  const pendingApproval = {
    authReqId,
    amount,
    tool: tool || null,
    bindingMessage: bindingMessage || '',
    status: 'pending',
    requestedAt: new Date().toISOString(),
    resolvedAt: null,
  };
  _db().putSync(delegationId, { ...rec, pendingApproval });
  return { ok: true };
}

async function resolveApproval(delegationId, managerUserId, decision) {
  const rec = _db().get(delegationId);
  if (
    !rec ||
    rec.delegator_user_id !== managerUserId ||
    !rec.pendingApproval ||
    rec.pendingApproval.status !== 'pending'
  ) {
    return { ok: false, error: 'not_found' };
  }
  const pendingApproval = { ...rec.pendingApproval, status: decision, resolvedAt: new Date().toISOString() };
  _db().putSync(delegationId, { ...rec, pendingApproval });
  logAppEvent('auth_lifecycle', 'info', `Delegation approval ${decision}: id=${delegationId}`,
    { tag: `delegation/approval-${decision}`, metadata: { delegationId, managerUserId } }
  );
  return { ok: true };
}

async function getApprovalStatus(delegationId) {
  const rec = _db().get(delegationId);
  return {
    status: rec?.pendingApproval?.status || 'pending',
    approverUserId: rec?.delegator_user_id || null,
  };
}
```

Then update the final `module.exports` line to include the four new names:

```js
module.exports = {
  grantDelegation, revokeDelegation, listDelegations, getDelegationHistory,
  getDelegationsGrantedToMe, listAllDelegations, adminRevokeDelegation, adminGrantDelegation,
  findActiveByDelegate, requestApproval, resolveApproval, getApprovalStatus,
};
```

Note: `toRecord()` already spreads `{ ...row, scopes: ... }`, so any `pendingApproval` field written onto a record is automatically included wherever `toRecord()` is called (e.g. `listDelegations`, used by `GET /api/delegation`) — no change needed there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && npx jest tests/delegationApproval.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/manager-approver
git add demo_api_server/services/delegationService.js demo_api_server/tests/delegationApproval.test.js
git commit -m "feat(delegation): pendingApproval data model on the delegation record

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `routes/delegation.js` — manager approve/deny endpoints

**Files:**
- Modify: `demo_api_server/routes/delegation.js`
- Create: `demo_api_server/tests/delegationApproval.route.test.js`

**Interfaces:**
- Consumes: `resolveApproval(delegationId, managerUserId, decision)` from Task 1.
- Produces: `POST /api/delegation/:id/approve`, `POST /api/delegation/:id/deny` — both return `resolveApproval`'s result as JSON, `404` on `{ ok: false }`.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/delegationApproval.route.test.js`:

```js
'use strict';

const mockRecords = new Map();

jest.mock('../services/lmdb/openEnv', () => ({
  getDb: () => ({
    putSync: (k, v) => mockRecords.set(k, v),
    get:     (k)    => mockRecords.get(k),
    getRange: ()    => [...mockRecords.values()].map(value => ({ value })),
  }),
}));

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, res, next) => next(),
}));

jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserByUsername: jest.fn().mockResolvedValue({ user: null }),
}));
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockRejectedValue(new Error('not configured')),
}));
jest.mock('../services/pingoneBootstrapService', () => ({
  fetchFirstPopulationId: jest.fn().mockResolvedValue('pop-id'),
}));
jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  setDelegatedToAttribute: jest.fn().mockResolvedValue(undefined),
}));

const express = require('express');
const request = require('supertest');

const delegationRouter = require('../routes/delegation');

function makeApp(userId, email) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: userId, email }; next(); });
  app.use('/api/delegation', delegationRouter);
  return app;
}

beforeEach(() => mockRecords.clear());

async function grantAsManager() {
  const managerApp = makeApp('manager-1', 'sam@example.com');
  const res = await request(managerApp)
    .post('/api/delegation')
    .send({ delegateEmail: 'dana@example.com', scopes: ['create_transfer'] });
  return res.body.delegation.id;
}

describe('POST /api/delegation/:id/approve', () => {
  test('manager approves their own pending delegation', async () => {
    const id = await grantAsManager();
    mockRecords.set(id, { ...mockRecords.get(id), pendingApproval: { status: 'pending', authReqId: 'a1', amount: 600 } });

    const res = await request(makeApp('manager-1', 'sam@example.com'))
      .post(`/api/delegation/${id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockRecords.get(id).pendingApproval.status).toBe('approved');
  });

  test('a non-owner gets 404, not the manager\'s pending record', async () => {
    const id = await grantAsManager();
    mockRecords.set(id, { ...mockRecords.get(id), pendingApproval: { status: 'pending', authReqId: 'a1', amount: 600 } });

    const res = await request(makeApp('someone-else', 'eve@example.com'))
      .post(`/api/delegation/${id}/approve`);
    expect(res.status).toBe(404);
    expect(mockRecords.get(id).pendingApproval.status).toBe('pending'); // unchanged
  });

  test('404 for a delegation with nothing pending', async () => {
    const id = await grantAsManager(); // no pendingApproval set
    const res = await request(makeApp('manager-1', 'sam@example.com'))
      .post(`/api/delegation/${id}/approve`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/delegation/:id/deny', () => {
  test('manager denies their own pending delegation', async () => {
    const id = await grantAsManager();
    mockRecords.set(id, { ...mockRecords.get(id), pendingApproval: { status: 'pending', authReqId: 'a1', amount: 600 } });

    const res = await request(makeApp('manager-1', 'sam@example.com'))
      .post(`/api/delegation/${id}/deny`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockRecords.get(id).pendingApproval.status).toBe('denied');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && npx jest tests/delegationApproval.route.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: FAIL with 404s — the routes don't exist yet (Express falls through to no matching route).

- [ ] **Step 3: Implement in `routes/delegation.js`**

Add `resolveApproval` to the destructured import at the top of `demo_api_server/routes/delegation.js`:

```js
const {
  grantDelegation,
  revokeDelegation,
  listDelegations,
  getDelegationHistory,
  getDelegationsGrantedToMe,
  listAllDelegations,
  adminRevokeDelegation,
  adminGrantDelegation,
  resolveApproval,
} = require('../services/delegationService');
```

Then add these two routes immediately after the existing `DELETE /:id` route (`router.delete('/:id', ...)`), before the `// Admin routes` comment block:

```js
// POST /api/delegation/:id/approve — manager approves a pending elevated action
router.post('/:id/approve', async (req, res) => {
  const result = await resolveApproval(req.params.id, req.user.id, 'approved');
  if (!result.ok) {
    return res.status(404).json(result);
  }
  res.json(result);
});

// POST /api/delegation/:id/deny — manager denies a pending elevated action
router.post('/:id/deny', async (req, res) => {
  const result = await resolveApproval(req.params.id, req.user.id, 'denied');
  if (!result.ok) {
    return res.status(404).json(result);
  }
  res.json(result);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && npx jest tests/delegationApproval.route.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: PASS (4 tests).

- [ ] **Step 5: Run Task 1's suite too (regression guard)**

Run: `cd demo_api_server && npx jest tests/delegationApproval.test.js tests/delegationApproval.route.test.js tests/delegationGrantedToMe.regression.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/delegation.js demo_api_server/tests/delegationApproval.route.test.js
git commit -m "feat(delegation): manager approve/deny endpoints

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `routes/ciba.js` — manager-approval branch on initiate/poll

**Files:**
- Modify: `demo_api_server/routes/ciba.js`
- Create: `demo_api_server/src/__tests__/ciba.managerApproval.test.js`

**Interfaces:**
- Consumes: `findActiveByDelegate(userId)`, `requestApproval(delegationId, {...})`, `getApprovalStatus(delegationId)` from Task 1.
- Produces: no new HTTP surface — same `/initiate` and `/poll/:authReqId` endpoints, one new internal branch each. The session's `cibaRequests[authReqId]` record gains a `delegationId` field (present only when a manager-approval flow applies).

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/src/__tests__/ciba.managerApproval.test.js` (a focused sibling to the existing `ciba.test.js`, which already covers every other branch of this router — kept separate so that already-large file doesn't grow further):

```js
'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');

jest.mock('../../services/cibaService', () => ({
  initiateBackchannelAuth: jest.fn(),
  pollForTokens: jest.fn(),
  isEnabled: jest.fn().mockReturnValue(true),
}));

jest.mock('../../services/cibaSimulatedService', () => ({
  initiateSimulated: jest.fn(),
  isSimulatedApproved: jest.fn(),
  SIMULATED_APPROVE_DELAY_MS: 7000,
}));

jest.mock('../../services/tokenChainService', () => ({
  trackTokenEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

jest.mock('../../services/delegationService', () => ({
  findActiveByDelegate: jest.fn(),
  requestApproval: jest.fn(),
  getApprovalStatus: jest.fn(),
}));

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) return res.status(401).json({ error: 'authentication_required' });
    req.user = JSON.parse(h);
    next();
  },
}));

const cibaService = require('../../services/cibaService');
const cibaSimulatedService = require('../../services/cibaSimulatedService');
const delegationService = require('../../services/delegationService');
const cibaRouter = require('../../routes/ciba');

const EMPLOYEE_HDR = JSON.stringify({ id: 'dana-1', email: 'dana@example.com' });
const AUTH_REQ_ID = 'sim-manager-approval-req';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use('/api/auth/ciba', cibaRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  cibaService.isEnabled.mockReturnValue(true);
  cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED')); // always simulated in this suite
  cibaSimulatedService.initiateSimulated.mockReturnValue({ auth_req_id: AUTH_REQ_ID, expires_in: 300, interval: 5 });
});

describe('POST /api/auth/ciba/initiate — manager-approval branch', () => {
  test('tags the session record with delegationId and calls requestApproval when an active manager delegation exists', async () => {
    delegationService.findActiveByDelegate.mockResolvedValue({ id: 'deleg-1', delegator_user_id: 'sam-1' });
    delegationService.requestApproval.mockResolvedValue({ ok: true });

    const agent = request.agent(buildApp());
    const res = await agent
      .set('x-test-user', EMPLOYEE_HDR)
      .post('/api/auth/ciba/initiate')
      .send({ binding_message: 'Approve $600 expense', amount: 600, tool: 'submit_expense' });

    expect(res.status).toBe(200);
    expect(delegationService.findActiveByDelegate).toHaveBeenCalledWith('dana-1');
    expect(delegationService.requestApproval).toHaveBeenCalledWith('deleg-1', expect.objectContaining({
      authReqId: AUTH_REQ_ID, amount: 600, tool: 'submit_expense',
    }));
  });

  test('does not call requestApproval when the employee has no active manager delegation (unchanged behavior)', async () => {
    delegationService.findActiveByDelegate.mockResolvedValue(null);

    const agent = request.agent(buildApp());
    const res = await agent
      .set('x-test-user', EMPLOYEE_HDR)
      .post('/api/auth/ciba/initiate')
      .send({ binding_message: 'Approve transfer' });

    expect(res.status).toBe(200);
    expect(delegationService.requestApproval).not.toHaveBeenCalled();
  });

  test('a lookup failure does not break initiate (falls through to self-approval)', async () => {
    delegationService.findActiveByDelegate.mockRejectedValue(new Error('db unavailable'));

    const agent = request.agent(buildApp());
    const res = await agent
      .set('x-test-user', EMPLOYEE_HDR)
      .post('/api/auth/ciba/initiate')
      .send({ binding_message: 'Approve transfer' });

    expect(res.status).toBe(200);
  });
});

describe('GET /api/auth/ciba/poll/:authReqId — manager-approval branch', () => {
  async function initiateWithDelegation() {
    delegationService.findActiveByDelegate.mockResolvedValue({ id: 'deleg-1', delegator_user_id: 'sam-1' });
    delegationService.requestApproval.mockResolvedValue({ ok: true });
    const agent = request.agent(buildApp());
    await agent.set('x-test-user', EMPLOYEE_HDR).post('/api/auth/ciba/initiate').send({ amount: 600 });
    return agent;
  }

  test('stays pending while the delegation record is still pending', async () => {
    const agent = await initiateWithDelegation();
    delegationService.getApprovalStatus.mockResolvedValue({ status: 'pending', approverUserId: 'sam-1' });

    const res = await agent.set('x-test-user', EMPLOYEE_HDR).get(`/api/auth/ciba/poll/${AUTH_REQ_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(cibaSimulatedService.isSimulatedApproved).not.toHaveBeenCalled();
  });

  test('resolves approved once the manager approves, tracking approvedBy', async () => {
    const { trackTokenEvent } = require('../../services/tokenChainService');
    const agent = await initiateWithDelegation();
    delegationService.getApprovalStatus.mockResolvedValue({ status: 'approved', approverUserId: 'sam-1' });

    const res = await agent.set('x-test-user', EMPLOYEE_HDR).get(`/api/auth/ciba/poll/${AUTH_REQ_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(trackTokenEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalData: expect.objectContaining({ approvedBy: 'sam-1' }),
      }),
    );
  });

  test('returns 403 denied when the manager denies', async () => {
    const agent = await initiateWithDelegation();
    delegationService.getApprovalStatus.mockResolvedValue({ status: 'denied', approverUserId: 'sam-1' });

    const res = await agent.set('x-test-user', EMPLOYEE_HDR).get(`/api/auth/ciba/poll/${AUTH_REQ_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.status).toBe('denied');
  });

  test('falls through to the plain simulated timer when there is no delegationId (unchanged behavior)', async () => {
    delegationService.findActiveByDelegate.mockResolvedValue(null);
    const agent = request.agent(buildApp());
    await agent.set('x-test-user', EMPLOYEE_HDR).post('/api/auth/ciba/initiate').send({});

    cibaSimulatedService.isSimulatedApproved.mockReturnValue(false);
    const res = await agent.set('x-test-user', EMPLOYEE_HDR).get(`/api/auth/ciba/poll/${AUTH_REQ_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(delegationService.getApprovalStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && npx jest src/__tests__/ciba.managerApproval.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: FAIL — `delegationService.findActiveByDelegate`/`requestApproval`/`getApprovalStatus` are never called because `routes/ciba.js` doesn't require or call them yet.

- [ ] **Step 3: Implement in `routes/ciba.js`**

Add the import near the top, alongside the other service requires:

```js
const delegationService = require('../services/delegationService');
```

In the `POST /initiate` handler, insert this block immediately **after** the `try { result = await cibaService.initiateBackchannelAuth(...) } catch (realErr) { ... }` block (i.e., right after line 157's closing `}`, before the `try {` that builds `req.session.cibaRequests`):

```js
  // Manager-as-approver: if the acting user is a workforce employee with an
  // active manager delegation carrying create_transfer scope, this becomes a
  // second-principal approval flow — the manager approves via their own
  // session on /delegation, not via this CIBA channel. Any lookup failure
  // falls through to today's plain self-approval behavior, unchanged.
  let delegationId = null;
  try {
    const activeDelegation = await delegationService.findActiveByDelegate(req.user?.id);
    if (activeDelegation) {
      delegationId = activeDelegation.id;
      await delegationService.requestApproval(delegationId, {
        authReqId: result.auth_req_id,
        amount,
        tool: req.body.tool || null,
        bindingMessage: binding_message || '',
      });
    }
  } catch (delegErr) {
    console.warn('[CIBA] manager-approval delegation lookup failed (continuing as self-approval):', delegErr.message);
  }
```

Then add `delegationId,` as a new field in the `req.session.cibaRequests[result.auth_req_id] = { ... }` object literal (the block starting at the existing `initiatedAt: Date.now(),` line):

```js
    req.session.cibaRequests[result.auth_req_id] = {
      initiatedAt: Date.now(),
      expiresAt:   Date.now() + result.expires_in * 1000,
      loginHint,
      scope: scope || PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
      acr_values: acr_values || '',
      binding_message: binding_message || '',
      simulated,
      amount,
      fromAccountLabel,
      toAccountLabel,
      delegationId,
    };
```

In `GET /poll/:authReqId`, inside the existing `if (pending.simulated) { ... }` block, replace this exact fragment:

```js
    if (!cibaSimulatedService.isSimulatedApproved(pending)) {
      return res.json({ status: 'pending' });
    }
```

with:

```js
    let approvalStatus = 'approved';
    let approverUserId = null;
    if (pending.delegationId) {
      const approval = await delegationService.getApprovalStatus(pending.delegationId);
      approvalStatus = approval.status;
      approverUserId = approval.approverUserId;
    } else if (!cibaSimulatedService.isSimulatedApproved(pending)) {
      approvalStatus = 'pending';
    }

    if (approvalStatus === 'denied') {
      delete req.session.cibaRequests[authReqId];
      return res.status(403).json({
        status: 'denied',
        error: 'access_denied',
        message: 'The manager denied the approval request.',
      });
    }

    if (approvalStatus !== 'approved') {
      return res.json({ status: 'pending' });
    }
```

Then, still inside the same `if (pending.simulated)` block, update the `trackTokenEvent` call's `additionalData` (the block starting `const subject = req.user?.sub || req.user?.id;`) so the closing object gains the approver when present:

```js
        trackTokenEvent({
          eventType: 'auth',
          token: fakeAccessToken,
          userId: subject,
          description: 'CIBA backchannel step-up approved (out-of-band)',
          additionalData: {
            grantedVia: 'ciba',
            scope: pending.scope,
            engine: 'simulated',
            ...(approverUserId ? { approvedBy: approverUserId } : {}),
          },
        }).catch((err) => console.error('[CIBA] token-chain track failed (simulated):', err.message));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && npx jest src/__tests__/ciba.managerApproval.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the existing full ciba.test.js suite (regression guard — must be unaffected)**

Run: `cd demo_api_server && npx jest src/__tests__/ciba.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: PASS (all pre-existing tests, unchanged) — this is the proof that banking's `bk-ciba` and every other existing CIBA path is untouched.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/ciba.js demo_api_server/src/__tests__/ciba.managerApproval.test.js
git commit -m "feat(ciba): manager-approval branch on initiate/poll for delegated employees

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `DelegationPage.js` — manager Approve/Deny UI

**Files:**
- Modify: `demo_api_ui/src/components/DelegationPage.js`
- Create: `demo_api_ui/src/components/__tests__/DelegationPage.approval.test.js`

**Interfaces:**
- Consumes: `d.pendingApproval` field (from Task 1, surfaced through `GET /api/delegation`) on each delegation row.
- Produces: `POST /api/delegation/:id/approve` and `/deny` calls (Task 2), triggered by new Approve/Deny buttons.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/DelegationPage.approval.test.js` (first test file for this component — scoped to only the new behavior, not a full-page suite):

```jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DelegationPage from '../DelegationPage';

jest.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ pageManifest: null }),
}));
jest.mock('../../context/DemoTourContext', () => ({
  useDemoTour: () => ({ start: jest.fn() }),
}));
jest.mock('../../services/agentAuthorizationService', () => ({
  getAgentAuthStatus: jest.fn().mockResolvedValue({ authorized: false, enforced: false }),
  setAgentAuthorization: jest.fn(),
}));
jest.mock('../../utils/authUi', () => ({ requestSilentReauth: jest.fn() }));

const PENDING_DELEGATION = {
  id: 'deleg-1',
  delegate_email: 'dana@example.com',
  scopes: ['create_transfer'],
  granted_at: '2026-07-22T00:00:00.000Z',
  pendingApproval: { status: 'pending', amount: 600, tool: 'submit_expense' },
};

function mockFetchSequence() {
  global.fetch = jest.fn((url) => {
    if (url === '/api/delegation') {
      return Promise.resolve({ json: () => Promise.resolve({ delegations: [PENDING_DELEGATION] }) });
    }
    if (url === '/api/delegation/history') {
      return Promise.resolve({ json: () => Promise.resolve({ history: [] }) });
    }
    if (url === '/api/delegation/deleg-1/approve') {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({}) });
  });
}

describe('DelegationPage — manager approve/deny row', () => {
  beforeEach(() => mockFetchSequence());
  afterEach(() => { delete global.fetch; });

  it('shows an Approve/Deny row for a delegation with a pending approval', async () => {
    render(<DelegationPage user={{ id: 'manager-1' }} />);
    await waitFor(() => expect(screen.getByText(/dana@example.com/)).toBeInTheDocument());
    expect(screen.getByText(/pending approval/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
  });

  it('calls the approve endpoint and reloads on click', async () => {
    render(<DelegationPage user={{ id: 'manager-1' }} />);
    await waitFor(() => expect(screen.getByText(/dana@example.com/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/delegation/deleg-1/approve', expect.objectContaining({ method: 'POST' }));
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && CI=true npx vitest run src/components/__tests__/DelegationPage.approval.test.js --testPathIgnorePatterns="/node_modules/,/\\.claude/worktrees/"` — actually this is Jest via CRA/vitest; use: `CI=true npx vitest run src/components/__tests__/DelegationPage.approval.test.js`
Expected: FAIL — no "pending approval" text, no Approve/Deny buttons rendered yet.

- [ ] **Step 3: Implement in `DelegationPage.js`**

Add state for the in-flight approve/deny action, alongside the existing `revoking` state (find `const [revoking, setRevoking] = useState(null);` and add directly after it):

```js
  // Manager approve/deny
  const [approving, setApproving] = useState(null);
```

Add the two handlers alongside `handleRevoke` (after its closing `};`):

```js
  const handleApprove = async (id) => {
    setApproving(id);
    try {
      await fetch(`/api/delegation/${id}/approve`, { method: 'POST' });
      await loadData();
    } catch (err) {
      console.error('[DelegationPage] approve error:', err.message);
    } finally {
      setApproving(null);
    }
  };

  const handleDeny = async (id) => {
    setApproving(id);
    try {
      await fetch(`/api/delegation/${id}/deny`, { method: 'POST' });
      await loadData();
    } catch (err) {
      console.error('[DelegationPage] deny error:', err.message);
    } finally {
      setApproving(null);
    }
  };
```

In the delegations list render, inside `delegations.map(d => ( <div key={d.id} style={S.delegCard}> ... )`, find the closing `</div>` of `S.delegCardLeft` (right after the `S.pillsRow` div) and insert the new pending-approval block immediately after it, still inside `S.delegCardLeft`:

```jsx
                          <div style={S.pillsRow}>
                            {(d.scopes || []).map(s => (
                              <span key={s} style={S.pill}>{s.replace(/_/g, ' ')}</span>
                            ))}
                          </div>
                          {d.pendingApproval?.status === 'pending' && (
                            <div style={{ marginTop: 8, padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6 }}>
                              <p style={{ margin: '0 0 6px 0', fontSize: 12, color: '#92400e', fontWeight: 600 }}>
                                Pending approval: ${d.pendingApproval.amount}{d.pendingApproval.tool ? ` (${d.pendingApproval.tool.replace(/_/g, ' ')})` : ''}
                              </p>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  onClick={() => handleApprove(d.id)}
                                  disabled={approving === d.id}
                                  style={S.primaryBtn}
                                >
                                  {approving === d.id ? 'Approving…' : 'Approve'}
                                </button>
                                <button
                                  onClick={() => handleDeny(d.id)}
                                  disabled={approving === d.id}
                                  style={S.dangerBtn}
                                >
                                  Deny
                                </button>
                              </div>
                            </div>
                          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && CI=true npx vitest run src/components/__tests__/DelegationPage.approval.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit `0`.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/DelegationPage.js demo_api_ui/src/components/__tests__/DelegationPage.approval.test.js
git commit -m "feat(delegation): manager Approve/Deny row on the delegation list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Workforce manifest — CIBA chip + manager/employee demo personas

**Files:**
- Modify: `demo_api_server/config/verticals/workforce/manifest.json`

**Interfaces:** none (data-only change) — the chip's `useCaseId: 'ciba-out-of-band-approval'` is what makes `mcpToolAuthorizationService`'s existing `declaresCiba` logic fire for this chip (Task 3's server code doesn't need to know the chip exists; it activates purely from the employee's active delegation).

- [ ] **Step 1: Add the `wf-ciba` chip**

In `demo_api_server/config/verticals/workforce/manifest.json`, find the line defining `wf5` (`{ "id": "wf5", "label": "🔐 Request time off", ... "useCaseId": "hitl-consent" },`) and insert this new chip immediately after it:

```json
      { "id": "wf-ciba", "label": "🔑 Submit expense (manager approval)", "message": "submit a $600 expense with manager approval", "mode": "both", "challenge": "both", "hitlTrigger": true, "tool": "submit_expense", "useCaseId": "ciba-out-of-band-approval", "group": "advanced" },
```

- [ ] **Step 2: Add the two demo personas**

Find the `demoUsers` block (around line 320, containing `"customer": { "hint": "demoUser", ... }` and `"admin": { "hint": "demoAdmin", ... }`) and add two new entries:

```json
    "manager":  { "hint": "demoWfManager",  "passwordHint": "Tigers7&" },
    "employee": { "hint": "demoWfEmployee", "passwordHint": "Tigers7&" }
```
(Match the existing block's exact comma placement — these are two more entries in the same object as `customer`/`admin`.)

- [ ] **Step 3: Run the config-correctness gates**

Run: `cd demo_api_server && npx jest tests/useCases.primaryTool.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: PASS — `wf-ciba`'s `submit a $600 expense with manager approval` message contains the canonical `$600` amount, so it satisfies the repo-wide "canonical dollar amount" check this test enforces. If it fails, read the assertion output — it either flags a genuinely non-canonical amount (fix the chip's wording) or the test's phrase-extraction regex needs the exact substring `$600` unbroken (adjust the chip message, not the test).

Run: `cd demo_api_server && npx jest tests/verticalManifest/snapshot.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: PASS unchanged (this test snapshots overlay/restore behavior, not raw per-vertical manifest content — it should be unaffected by adding a chip/demoUsers entries; if it fails on a literal content snapshot, run with `-u` to update the snapshot, since the new chip/personas are the intended change, and note the updated snapshot file in the commit).

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/config/verticals/workforce/manifest.json
git commit -m "feat(workforce): CIBA chip + manager/employee demo personas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Provisioning — create the two workforce demo users (code only, not run)

**Files:**
- Modify: `demo_api_server/services/pingoneProvisionService.js`
- Create: `demo_api_server/src/__tests__/pingoneProvisionService.workforceApprovalUsers.test.js`

**Interfaces:** produces `PingOneProvisionService.prototype.provisionWorkforceApprovalDemoUsers()` — an isolated method (not inlined into the giant orchestrator function), so it's testable directly, matching how `pingoneProvisionService.regression.test.js` already tests individual methods on a bare instance.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/src/__tests__/pingoneProvisionService.workforceApprovalUsers.test.js`:

```js
'use strict';

const { PingOneProvisionService } = require('../../services/pingoneProvisionService');

function buildSvc() {
  const svc = new PingOneProvisionService();
  svc.config = {
    environmentId: 'test-env',
    region: 'com',
    workerClientId: 'worker-client',
    workerClientSecret: 'worker-secret',
    publicAppUrl: 'https://demo.example.com',
  };
  svc.getWorkerToken = jest.fn().mockResolvedValue('fake-worker-token');
  return svc;
}

describe('provisionWorkforceApprovalDemoUsers', () => {
  let svc;

  beforeEach(() => {
    svc = buildSvc();
    svc.createUser = jest.fn()
      .mockResolvedValueOnce({ exists: false, user: { id: 'manager-id' } })
      .mockResolvedValueOnce({ exists: false, user: { id: 'employee-id' } });
    svc.setUserPassword = jest.fn().mockResolvedValue({ changed: true });
  });

  test('creates both the manager and employee demo users with the demo password', async () => {
    const result = await svc.provisionWorkforceApprovalDemoUsers();

    expect(svc.createUser).toHaveBeenCalledWith(
      'demoWfManager', expect.any(String), expect.any(String), expect.stringContaining('demoWfManager@'),
    );
    expect(svc.createUser).toHaveBeenCalledWith(
      'demoWfEmployee', expect.any(String), expect.any(String), expect.stringContaining('demoWfEmployee@'),
    );
    expect(svc.setUserPassword).toHaveBeenCalledTimes(2);
    expect(result.manager.id).toBe('manager-id');
    expect(result.employee.id).toBe('employee-id');
  });

  test('reuses existing users without erroring (idempotent, matches demoDelegate pattern)', async () => {
    svc.createUser = jest.fn()
      .mockResolvedValueOnce({ exists: true, user: { id: 'manager-id' } })
      .mockResolvedValueOnce({ exists: true, user: { id: 'employee-id' } });

    const result = await svc.provisionWorkforceApprovalDemoUsers();
    expect(result.manager.id).toBe('manager-id');
    expect(result.employee.id).toBe('employee-id');
  });

  test('continues (does not throw) if password-setting fails for one user', async () => {
    svc.setUserPassword = jest.fn()
      .mockRejectedValueOnce(new Error('password policy rejected'))
      .mockResolvedValueOnce({ changed: true });

    await expect(svc.provisionWorkforceApprovalDemoUsers()).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/pingoneProvisionService.workforceApprovalUsers.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: FAIL — `svc.provisionWorkforceApprovalDemoUsers is not a function`.

- [ ] **Step 3: Implement the method in `pingoneProvisionService.js`**

Add this method to the `PingOneProvisionService` class — place it directly after the existing `createUser` method (around line 1176+, after its closing `}`), following Step 14.5's exact create-user/set-password shape but for two users instead of one:

```js
  /**
   * Provision the two workforce manager-as-approver demo personas (manager
   * grants + approves; employee acts under the grant). Mirrors the
   * demoDelegate pattern (Step 14.5) — idempotent, never throws (password
   * failures are logged and continue, matching demoDelegate's behavior).
   * Code-only path: NOT wired into the main provisioning orchestrator by
   * this task — invoked manually/from a follow-up wiring step when the
   * user is ready to provision against a real PingOne environment.
   */
  async provisionWorkforceApprovalDemoUsers() {
    const emailDomain = demoEmailDomain(this.config.publicAppUrl);

    const managerResult = await this.createUser(
      'demoWfManager', 'Demo', 'WfManager', `demoWfManager@${emailDomain}`,
    );
    const employeeResult = await this.createUser(
      'demoWfEmployee', 'Demo', 'WfEmployee', `demoWfEmployee@${emailDomain}`,
    );

    for (const [label, result] of [['demoWfManager', managerResult], ['demoWfEmployee', employeeResult]]) {
      try {
        await this.setUserPassword(result.user.id, DEMO_PASSWORD);
      } catch (err) {
        console.warn(`[pingoneProvisionService] password set failed for ${label}: ${err.message}`);
      }
    }

    return {
      manager: { ...managerResult.user, password: DEMO_PASSWORD },
      employee: { ...employeeResult.user, password: DEMO_PASSWORD },
    };
  }
```

(`demoEmailDomain` and `DEMO_PASSWORD` are already in scope in this file — confirmed by their use in Step 14.5 just above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/pingoneProvisionService.workforceApprovalUsers.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing provisioning regression suite (guard against drift)**

Run: `cd demo_api_server && npx jest src/__tests__/pingoneProvisionService.regression.test.js --testPathIgnorePatterns="/node_modules/,/\\.kilo/worktrees/,/tests/real/"`
Expected: PASS unchanged.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/pingoneProvisionService.js demo_api_server/src/__tests__/pingoneProvisionService.workforceApprovalUsers.test.js
git commit -m "feat(provisioning): add provisionWorkforceApprovalDemoUsers (code only, not wired into setup:fresh)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Do not run `setup:fresh` / `pingone:bootstrap` as part of this task.** Once this branch is reviewed, ask the user whether/when to actually provision these two users against a real PingOne environment, and whether `provisionWorkforceApprovalDemoUsers()` should be wired into the main orchestrator's call sequence (next to Step 14.5) at that time.

---

## Self-Review

- **Spec coverage:** every component in the design doc's Architecture section (data model, employee-side hook, manager-side endpoints + UI, provisioning, chip) has exactly one task. The design's Error Handling section (no-delegation fallthrough, deny, non-owner, expiry) is covered by Task 1/2/3's tests except the expiry-cleanup detail the design flagged as an open implementation nuance — deliberately left as-is: the existing session-side `expiresAt` check already deletes the *session* record on timeout; the delegation record's stale `pendingApproval` simply remains `'pending'` until overwritten by a new request (matches the "overwrite, no queue" model already tested in Task 1) — acceptable for a demo, not a silent gap.
- **Placeholder scan:** none — every step has complete, runnable code.
- **Type consistency:** `getApprovalStatus` returns `{ status, approverUserId }` consistently across Task 1 (definition), Task 3 (consumer in `routes/ciba.js`), and its tests. `requestApproval`'s parameter object shape (`{ authReqId, amount, tool, bindingMessage }`) matches between Task 1's definition and Task 3's call site.
- **Regression guarding:** Task 3 Step 5 and Task 6 Step 5 explicitly re-run the pre-existing suites those files already had, proving the new branches don't alter old behavior — not just asserted in prose.
