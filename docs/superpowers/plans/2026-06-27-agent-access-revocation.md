# Agent Access Revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `may_act` as the agent authorization gate with LMDB delegation records, and add soft/hard revocation for users (self-service) and admins.

**Architecture:** Agent grant writes an LMDB delegation record alongside the existing PingOne `mayAct` write. A new `delegationGate` middleware checks that record on agent-proxied routes. Soft revoke deletes the record; hard revoke deletes it and kills the live token via RFC 7009, returning `sessionClear: true` to trigger a UI modal and login redirect.

**Tech Stack:** Node.js/Express (BFF), LMDB (`delegationStore.lmdb.js`), React (UI), Vitest + RTL (frontend tests), Jest (backend tests), `axios` for RFC 7009 calls.

## Global Constraints

- No changes to PingOne token policy — `may_act` claim issuance stays in PingOne config
- Do not touch `delegationService.js` internals — use `delegationStore.lmdb.js` directly for new agent-delegation records
- Reuse existing `tokenRevocation.revokeToken(token, hint, clientId, clientSecret)` for RFC 7009
- Client credentials for revocation: `configStore.getEffective('pingone_client_id') || process.env.PINGONE_CLIENT_ID` and same pattern for `pingone_client_secret`
- All backend route files keep `'use strict'` at top
- Frontend components use inline styles (matching `AdminDelegationPage.js` pattern) — no new CSS files

---

## File Map

**New files:**
- `demo_api_server/middleware/delegationGate.js` — gate middleware (checks LMDB record for agent-proxied routes)
- `demo_api_ui/src/components/AgentAccessCard.js` — user self-service revoke UI
- `demo_api_server/tests/delegationStore.unit.test.js`
- `demo_api_server/tests/delegationGate.unit.test.js`
- `demo_api_server/tests/agentAuthorizationRevoke.unit.test.js`
- `demo_api_ui/src/components/__tests__/AgentAccessCard.test.jsx`

**Modified files:**
- `demo_api_server/services/lmdb/delegationStore.lmdb.js` — add `findActiveByActorAndGrantor`, add `access_token` field to `grantDelegation`
- `demo_api_server/routes/agentAuthorization.js` — extend `POST /grant` to write LMDB; add `DELETE /` (soft) and `DELETE /hard`
- `demo_api_server/routes/delegation.js` — add `DELETE /admin/:id/hard`
- `demo_api_ui/src/components/AdminDelegationPage.js` — add "Revoke Immediately" button per active row
- `demo_api_ui/src/components/Profile.js` — import and render `AgentAccessCard`

---

## Task 1: Extend `delegationStore.lmdb.js` — query method + `access_token` field

**Files:**
- Modify: `demo_api_server/services/lmdb/delegationStore.lmdb.js`
- Test: `demo_api_server/tests/delegationStore.unit.test.js`

**Interfaces:**
- Produces:
  - `grantDelegation({ delegator_user_id, delegate_user_id?, delegate_email, delegator_email?, scopes, status?, access_token? }): { id: string }` — unchanged signature, `access_token` added as optional param (default `null`)
  - `findActiveByActorAndGrantor(actorSub: string, grantorUserId: string): record | null` — new export

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/delegationStore.unit.test.js`:

```js
'use strict';
jest.mock('../services/lmdb/openEnv', () => {
  const store = new Map();
  const db = {
    putSync: (k, v) => store.set(k, v),
    get: (k) => store.get(k) || null,
    getRange: () => [...store.values()].map(value => ({ value })),
  };
  return { openEnv: () => ({ openDB: () => db }) };
});
const ds = require('../services/lmdb/delegationStore.lmdb');

describe('findActiveByActorAndGrantor', () => {
  beforeEach(() => {
    // clear by re-requiring fresh store — mock store persists between tests
    // so we just grant unique IDs per test
  });

  it('returns the active record when grantor+actor match', () => {
    ds.grantDelegation({
      delegator_user_id: 'user-1',
      delegate_email: 'agent-client-id',
      scopes: [],
    });
    const result = ds.findActiveByActorAndGrantor('agent-client-id', 'user-1');
    expect(result).not.toBeNull();
    expect(result.delegator_user_id).toBe('user-1');
    expect(result.status).toBe('active');
  });

  it('returns null when no active record exists', () => {
    const result = ds.findActiveByActorAndGrantor('agent-client-id', 'unknown-user');
    expect(result).toBeNull();
  });

  it('returns null after the record is revoked', () => {
    const { id } = ds.grantDelegation({
      delegator_user_id: 'user-2',
      delegate_email: 'agent-client-id',
      scopes: [],
    });
    ds.revokeDelegation(id);
    const result = ds.findActiveByActorAndGrantor('agent-client-id', 'user-2');
    expect(result).toBeNull();
  });
});

describe('grantDelegation with access_token', () => {
  it('stores access_token field on the record', () => {
    const { id } = ds.grantDelegation({
      delegator_user_id: 'user-3',
      delegate_email: 'agent-id',
      scopes: [],
      access_token: 'tok-abc',
    });
    const record = ds.getDelegationById(id);
    expect(record.access_token).toBe('tok-abc');
  });

  it('stores null access_token when not provided', () => {
    const { id } = ds.grantDelegation({
      delegator_user_id: 'user-4',
      delegate_email: 'agent-id',
      scopes: [],
    });
    const record = ds.getDelegationById(id);
    expect(record.access_token).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server && npm test -- --testPathPattern=delegationStore.unit 2>&1 | tail -20
```

Expected: FAIL — `findActiveByActorAndGrantor is not a function`

- [ ] **Step 3: Implement changes in `delegationStore.lmdb.js`**

Open `demo_api_server/services/lmdb/delegationStore.lmdb.js`. Make two changes:

**Change 1** — add `access_token` param and field to `grantDelegation`:

```js
function grantDelegation({ delegator_user_id, delegate_user_id, delegate_email, delegator_email, scopes, status = 'active', access_token = null }) {
  const id = randomUUID();
  const record = {
    id,
    delegator_user_id,
    delegate_user_id: delegate_user_id || null,
    delegate_email,
    delegator_email: delegator_email || null,
    scopes: Array.isArray(scopes) ? scopes : [],
    status,
    granted_at: new Date().toISOString(),
    revoked_at: null,
    access_token,
  };
  _db().putSync(id, record);
  return { id };
}
```

**Change 2** — add `findActiveByActorAndGrantor` before `module.exports`:

```js
function findActiveByActorAndGrantor(actorSub, grantorUserId) {
  for (const { value } of _db().getRange()) {
    if (
      value.delegator_user_id === grantorUserId &&
      value.delegate_email === actorSub &&
      value.status === 'active'
    ) {
      return value;
    }
  }
  return null;
}
```

**Change 3** — update `module.exports`:

```js
module.exports = { grantDelegation, revokeDelegation, getDelegations, getDelegationById, findActiveByActorAndGrantor };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server && npm test -- --testPathPattern=delegationStore.unit 2>&1 | tail -20
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2
git add demo_api_server/services/lmdb/delegationStore.lmdb.js demo_api_server/tests/delegationStore.unit.test.js
git commit -m "feat: extend delegationStore with findActiveByActorAndGrantor + access_token field"
```

---

## Task 2: Extend `agentAuthorization.js` — write LMDB on grant, add soft/hard DELETE

**Files:**
- Modify: `demo_api_server/routes/agentAuthorization.js`
- Test: `demo_api_server/tests/agentAuthorizationRevoke.unit.test.js`

**Interfaces:**
- Consumes: `delegationStore.findActiveByActorAndGrantor(sub, userId)`, `delegationStore.grantDelegation(...)`, `delegationStore.revokeDelegation(id)`, `revokeToken(token, hint, clientId, clientSecret)` from `tokenRevocation.js`
- Produces:
  - `DELETE /api/agent-authorization` → `{ ok: true, revoked: 'soft' }` or `404 { error: 'no_active_delegation' }`
  - `DELETE /api/agent-authorization/hard` → `{ ok: true, revoked: 'hard', sessionClear: true }` or `404 { error: 'no_active_delegation' }`

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/agentAuthorizationRevoke.unit.test.js`:

```js
'use strict';
const express = require('express');
const request = require('supertest');

jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  setMayActAttribute: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'ai_agent_client_id') return 'agent-client-id';
    if (key === 'pingone_client_id') return 'client-id';
    if (key === 'pingone_client_secret') return 'client-secret';
    if (key === 'ff_require_may_act') return false;
    return null;
  }),
}));
jest.mock('../services/lmdb/delegationStore.lmdb', () => ({
  grantDelegation: jest.fn().mockReturnValue({ id: 'delegation-id-1' }),
  findActiveByActorAndGrantor: jest.fn(),
  revokeDelegation: jest.fn(),
}));
jest.mock('../services/tokenRevocation', () => ({
  revokeToken: jest.fn().mockResolvedValue(true),
}));

const delegationStore = require('../services/lmdb/delegationStore.lmdb');
const { revokeToken } = require('../services/tokenRevocation');

function makeApp(session = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', email: 'user@example.com' };
    req.session = { oauthTokens: { accessToken: 'access-tok', ...session } };
    next();
  });
  app.use('/api/agent-authorization', require('../routes/agentAuthorization'));
  return app;
}

describe('POST /api/agent-authorization/grant writes LMDB', () => {
  it('calls grantDelegation with delegator_user_id and delegate_email', async () => {
    const res = await request(makeApp()).post('/api/agent-authorization/grant');
    expect(res.status).toBe(200);
    expect(delegationStore.grantDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        delegator_user_id: 'user-1',
        delegate_email: 'agent-client-id',
      })
    );
  });
});

describe('DELETE /api/agent-authorization (soft revoke)', () => {
  it('returns 404 when no active delegation exists', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue(null);
    const res = await request(makeApp()).delete('/api/agent-authorization');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_active_delegation');
  });

  it('revokes the delegation and returns soft', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue({ id: 'del-1' });
    const res = await request(makeApp()).delete('/api/agent-authorization');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, revoked: 'soft' });
    expect(delegationStore.revokeDelegation).toHaveBeenCalledWith('del-1');
  });
});

describe('DELETE /api/agent-authorization/hard (hard revoke)', () => {
  it('returns 404 when no active delegation', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue(null);
    const res = await request(makeApp()).delete('/api/agent-authorization/hard');
    expect(res.status).toBe(404);
  });

  it('revokes delegation, calls revokeToken, returns sessionClear', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue({ id: 'del-2' });
    revokeToken.mockResolvedValue(true);
    const res = await request(makeApp()).delete('/api/agent-authorization/hard');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, revoked: 'hard', sessionClear: true });
    expect(revokeToken).toHaveBeenCalledWith('access-tok', 'access_token', 'client-id', 'client-secret');
  });

  it('still returns sessionClear even if revokeToken throws', async () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue({ id: 'del-3' });
    revokeToken.mockRejectedValue(new Error('network error'));
    const res = await request(makeApp()).delete('/api/agent-authorization/hard');
    expect(res.status).toBe(200);
    expect(res.body.sessionClear).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server && npm test -- --testPathPattern=agentAuthorizationRevoke.unit 2>&1 | tail -20
```

Expected: FAIL — routes not yet implemented

- [ ] **Step 3: Implement changes in `agentAuthorization.js`**

Add new `require` lines at the top (after existing requires):

```js
const delegationStore = require('../services/lmdb/delegationStore.lmdb');
const { revokeToken } = require('../services/tokenRevocation');
```

Replace the existing `router.post('/grant', ...)` handler with:

```js
router.post('/grant', async (req, res) => {
  const sub = agentMayActSub();
  if (!sub) return res.status(503).json({ error: 'agent_not_configured', message: 'AI Agent client id (ai_agent_client_id) not configured.' });
  try {
    pingOneUserService.initialize();
    await pingOneUserService.setMayActAttribute(req.user.id, { sub });
    const accessToken = req.session?.oauthTokens?.accessToken || null;
    delegationStore.grantDelegation({
      delegator_user_id: req.user.id,
      delegator_email: req.user.email || '',
      delegate_email: sub,
      scopes: [],
      access_token: accessToken,
    });
    res.json({ ok: true, reauthRequired: true });
  } catch (err) {
    res.status(502).json({ error: 'mayact_write_failed', message: 'Could not update agent authorization. Try again.' });
  }
});
```

Add the two new DELETE routes before `module.exports`:

```js
router.delete('/', async (req, res) => {
  const sub = agentMayActSub();
  if (!sub) return res.status(503).json({ error: 'agent_not_configured', message: 'AI Agent client id not configured.' });
  const record = delegationStore.findActiveByActorAndGrantor(sub, req.user.id);
  if (!record) return res.status(404).json({ error: 'no_active_delegation' });
  delegationStore.revokeDelegation(record.id);
  res.json({ ok: true, revoked: 'soft' });
});

router.delete('/hard', async (req, res) => {
  const sub = agentMayActSub();
  if (!sub) return res.status(503).json({ error: 'agent_not_configured', message: 'AI Agent client id not configured.' });
  const record = delegationStore.findActiveByActorAndGrantor(sub, req.user.id);
  if (!record) return res.status(404).json({ error: 'no_active_delegation' });
  delegationStore.revokeDelegation(record.id);
  const accessToken = req.session?.oauthTokens?.accessToken;
  if (accessToken) {
    const clientId = configStore.getEffective('pingone_client_id') || process.env.PINGONE_CLIENT_ID;
    const clientSecret = configStore.getEffective('pingone_client_secret') || process.env.PINGONE_CLIENT_SECRET;
    try {
      await revokeToken(accessToken, 'access_token', clientId, clientSecret);
    } catch (err) {
      console.error('[agent-authorization] RFC 7009 revocation failed (non-fatal):', err.message);
    }
  }
  res.json({ ok: true, revoked: 'hard', sessionClear: true });
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server && npm test -- --testPathPattern=agentAuthorizationRevoke.unit 2>&1 | tail -20
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2
git add demo_api_server/routes/agentAuthorization.js demo_api_server/tests/agentAuthorizationRevoke.unit.test.js
git commit -m "feat: agent-authorization grant writes LMDB; add soft/hard DELETE revoke endpoints"
```

---

## Task 3: Add admin hard revoke to `delegation.js`

**Files:**
- Modify: `demo_api_server/routes/delegation.js`

**Interfaces:**
- Consumes: `delegationStore.getDelegationById(id)` (reads `access_token`), `adminRevokeDelegation(id)` from delegationService, `revokeToken(...)` from tokenRevocation, `configStore`
- Produces: `DELETE /api/delegation/admin/:id/hard` → `{ ok: true, revoked: 'hard', userId }` or `{ ok: true, revoked: 'soft', note: 'token_unavailable', userId }`

- [ ] **Step 1: Add requires to `delegation.js`**

Add at the top of `demo_api_server/routes/delegation.js` after existing requires:

```js
const delegationStore = require('../services/lmdb/delegationStore.lmdb');
const { revokeToken } = require('../services/tokenRevocation');
const configStore = require('../services/configStore');
```

- [ ] **Step 2: Add the hard revoke route**

Add before `module.exports = router;` in `delegation.js`:

```js
// DELETE /api/delegation/admin/:id/hard — revoke + kill live token (admin)
router.delete('/admin/:id/hard', requireAdmin, async (req, res) => {
  try {
    const record = delegationStore.getDelegationById(req.params.id);
    const result = await adminRevokeDelegation(req.params.id);
    if (!result.ok) return res.status(404).json(result);

    const userId = record?.delegator_user_id || null;
    const storedToken = record?.access_token;
    const clientId = configStore.getEffective('pingone_client_id') || process.env.PINGONE_CLIENT_ID;
    const clientSecret = configStore.getEffective('pingone_client_secret') || process.env.PINGONE_CLIENT_SECRET;

    if (storedToken && clientId && clientSecret) {
      try {
        await revokeToken(storedToken, 'access_token', clientId, clientSecret);
        return res.json({ ok: true, revoked: 'hard', userId });
      } catch (err) {
        console.error('[delegation] admin hard revoke token failed (non-fatal):', err.message);
      }
    }
    res.json({ ok: true, revoked: 'soft', note: 'token_unavailable', userId });
  } catch (err) {
    console.error('[delegation] DELETE /admin/:id/hard error:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
```

- [ ] **Step 3: Verify no syntax errors**

```bash
node -e "require('./demo_api_server/routes/delegation')" && echo "OK"
```

Expected: `OK` with no errors

- [ ] **Step 4: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2
git add demo_api_server/routes/delegation.js
git commit -m "feat: add DELETE /api/delegation/admin/:id/hard for admin hard revoke"
```

---

## Task 4: `delegationGate.js` middleware

**Files:**
- Create: `demo_api_server/middleware/delegationGate.js`
- Test: `demo_api_server/tests/delegationGate.unit.test.js`

**Interfaces:**
- Consumes: `delegationStore.findActiveByActorAndGrantor(actorSub, grantorUserId)`; reads `act.client_id` from the bearer token (no re-verification — auth middleware already verified)
- Produces: exported `delegationGate` function — Express middleware `(req, res, next) => void`; attaches `req.activeDelegation` on success

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/delegationGate.unit.test.js`:

```js
'use strict';
jest.mock('../services/lmdb/delegationStore.lmdb', () => ({
  findActiveByActorAndGrantor: jest.fn(),
}));

const delegationStore = require('../services/lmdb/delegationStore.lmdb');
const { delegationGate } = require('../middleware/delegationGate');

function makeReqRes(bearerPayload = {}) {
  const token = 'x.' + Buffer.from(JSON.stringify(bearerPayload)).toString('base64') + '.x';
  const req = {
    headers: { authorization: `Bearer ${token}` },
    user: { id: 'user-1' },
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('delegationGate', () => {
  it('calls next when active delegation record exists', () => {
    const record = { id: 'del-1', delegator_user_id: 'user-1' };
    delegationStore.findActiveByActorAndGrantor.mockReturnValue(record);
    const { req, res, next } = makeReqRes({ act: { client_id: 'agent-id' } });
    delegationGate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.activeDelegation).toBe(record);
  });

  it('returns 403 when no active delegation record', () => {
    delegationStore.findActiveByActorAndGrantor.mockReturnValue(null);
    const { req, res, next } = makeReqRes({ act: { client_id: 'agent-id' } });
    delegationGate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'delegation_revoked' })
    );
  });

  it('calls next when token has no act claim (non-delegated request)', () => {
    const { req, res, next } = makeReqRes({});
    delegationGate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(delegationStore.findActiveByActorAndGrantor).not.toHaveBeenCalled();
  });

  it('calls next when authorization header is absent', () => {
    const req = { headers: {}, user: { id: 'u' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    delegationGate(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server && npm test -- --testPathPattern=delegationGate.unit 2>&1 | tail -20
```

Expected: FAIL — `delegationGate.js` not found

- [ ] **Step 3: Create `delegationGate.js`**

Create `demo_api_server/middleware/delegationGate.js`:

```js
'use strict';
const delegationStore = require('../services/lmdb/delegationStore.lmdb');

function _extractActClientId(req) {
  const auth = req.headers?.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const parts = auth.slice(7).split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload.act?.client_id || null;
  } catch {
    return null;
  }
}

function delegationGate(req, res, next) {
  const actorSub = _extractActClientId(req);
  if (!actorSub) return next(); // non-delegated request — pass through
  const record = delegationStore.findActiveByActorAndGrantor(actorSub, req.user?.id);
  if (!record) {
    return res.status(403).json({ error: 'delegation_revoked', message: 'Agent access has been revoked.' });
  }
  req.activeDelegation = record;
  next();
}

module.exports = { delegationGate };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_server && npm test -- --testPathPattern=delegationGate.unit 2>&1 | tail -20
```

Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2
git add demo_api_server/middleware/delegationGate.js demo_api_server/tests/delegationGate.unit.test.js
git commit -m "feat: add delegationGate middleware — blocks agent requests with no active LMDB record"
```

---

## Task 5: `AgentAccessCard` UI component

**Files:**
- Create: `demo_api_ui/src/components/AgentAccessCard.js`
- Test: `demo_api_ui/src/components/__tests__/AgentAccessCard.test.jsx`

**Interfaces:**
- Props: none (reads status from `/api/agent-authorization/status`)
- Calls: `GET /api/agent-authorization/status`, `DELETE /api/agent-authorization`, `DELETE /api/agent-authorization/hard`
- On hard revoke success (`sessionClear: true`): renders blocking modal; "Log in again" redirects to `/login?revoked=1`

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/components/__tests__/AgentAccessCard.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AgentAccessCard from '../AgentAccessCard';

vi.mock('../../services/bffAxios', () => ({
  default: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

import bffAxios from '../../services/bffAxios';

describe('AgentAccessCard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows "No agent access" when authorized is false', async () => {
    bffAxios.get.mockResolvedValue({ data: { authorized: false, enforced: false } });
    render(<AgentAccessCard />);
    await screen.findByText(/no agent access/i);
    expect(screen.queryByText(/revoke/i)).toBeNull();
  });

  it('shows Revoke and Revoke Immediately when authorized is true', async () => {
    bffAxios.get.mockResolvedValue({ data: { authorized: true, enforced: true } });
    render(<AgentAccessCard />);
    await screen.findByText(/revoke immediately/i);
    expect(screen.getByText(/^revoke$/i)).toBeTruthy();
  });

  it('soft revoke calls DELETE / and updates card to inactive', async () => {
    bffAxios.get.mockResolvedValue({ data: { authorized: true, enforced: true } });
    bffAxios.delete.mockResolvedValue({ data: { ok: true, revoked: 'soft' } });
    render(<AgentAccessCard />);
    await screen.findByText(/^revoke$/i);
    fireEvent.click(screen.getByText(/^revoke$/i));
    // confirm dialog
    await screen.findByText(/confirm revoke/i);
    fireEvent.click(screen.getByText(/confirm revoke/i));
    await waitFor(() => expect(bffAxios.delete).toHaveBeenCalledWith('/api/agent-authorization'));
    await screen.findByText(/no agent access/i);
  });

  it('hard revoke shows blocking modal on sessionClear', async () => {
    bffAxios.get.mockResolvedValue({ data: { authorized: true, enforced: true } });
    bffAxios.delete.mockResolvedValue({ data: { ok: true, revoked: 'hard', sessionClear: true } });
    render(<AgentAccessCard />);
    await screen.findByText(/revoke immediately/i);
    fireEvent.click(screen.getByText(/revoke immediately/i));
    await screen.findByText(/confirm revoke immediately/i);
    fireEvent.click(screen.getByText(/confirm revoke immediately/i));
    await waitFor(() => expect(bffAxios.delete).toHaveBeenCalledWith('/api/agent-authorization/hard'));
    await screen.findByText(/agent access revoked/i);
    expect(screen.getByText(/log in again/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_ui && npx vitest run src/components/__tests__/AgentAccessCard.test.jsx 2>&1 | tail -20
```

Expected: FAIL — `AgentAccessCard.js` not found

- [ ] **Step 3: Create `AgentAccessCard.js`**

Create `demo_api_ui/src/components/AgentAccessCard.js`:

```jsx
import React, { useEffect, useState } from 'react';
import bffAxios from '../services/bffAxios';

export default function AgentAccessCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showHardModal, setShowHardModal] = useState(false);
  const [confirmSoft, setConfirmSoft] = useState(false);
  const [confirmHard, setConfirmHard] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    bffAxios.get('/api/agent-authorization/status')
      .then(r => setStatus(r.data))
      .catch(() => setStatus({ authorized: false, enforced: false }));
  }, []);

  const handleSoftRevoke = async () => {
    setBusy(true);
    try {
      await bffAxios.delete('/api/agent-authorization');
      setStatus(s => ({ ...s, authorized: false }));
      setConfirmSoft(false);
      setSuccess('Agent access revoked.');
      setTimeout(() => setSuccess(''), 3000);
    } finally {
      setBusy(false);
    }
  };

  const handleHardRevoke = async () => {
    setBusy(true);
    try {
      const res = await bffAxios.delete('/api/agent-authorization/hard');
      if (res.data.sessionClear) {
        setConfirmHard(false);
        setShowHardModal(true);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  const sectionStyle = { margin: '24px 0', padding: '20px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' };
  const titleStyle = { fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 12 };
  const emptyStyle = { fontSize: 13, color: '#6b7280' };
  const btnBase = { padding: '7px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid' };
  const btnSecondary = { ...btnBase, background: '#f9fafb', color: '#374151', borderColor: '#d1d5db' };
  const btnDanger = { ...btnBase, background: '#fee2e2', color: '#dc2626', borderColor: '#fca5a5' };
  const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const modalStyle = { background: '#fff', borderRadius: 10, padding: 28, maxWidth: 400, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' };

  return (
    <div style={sectionStyle}>
      <div style={titleStyle}>Agent Access</div>

      {showHardModal && (
        <div style={overlayStyle}>
          <div style={modalStyle} role="dialog" aria-modal="true">
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Agent access revoked</div>
            <p style={{ fontSize: 14, color: '#374151', marginBottom: 20 }}>
              The AI agent can no longer act on your behalf. Your session has been cleared for security.
            </p>
            <button style={btnDanger} onClick={() => { window.location.href = '/login?revoked=1'; }}>
              Log in again
            </button>
          </div>
        </div>
      )}

      {!status.authorized ? (
        <p style={emptyStyle}>No agent access is currently granted.</p>
      ) : (
        <div>
          <p style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
            AI agent access is <strong>active</strong>.
          </p>
          {success && <p style={{ fontSize: 13, color: '#15803d', marginBottom: 8 }}>{success}</p>}

          {!confirmSoft && !confirmHard && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btnSecondary} onClick={() => setConfirmSoft(true)}>Revoke</button>
              <button style={btnDanger} onClick={() => setConfirmHard(true)}>Revoke Immediately</button>
            </div>
          )}

          {confirmSoft && (
            <div style={{ fontSize: 13 }}>
              <p style={{ marginBottom: 10, color: '#374151' }}>Remove agent access? The change takes effect on next login.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnSecondary} onClick={() => setConfirmSoft(false)} disabled={busy}>Cancel</button>
                <button style={btnDanger} onClick={handleSoftRevoke} disabled={busy}>
                  {busy ? 'Revoking…' : 'Confirm Revoke'}
                </button>
              </div>
            </div>
          )}

          {confirmHard && (
            <div style={{ fontSize: 13 }}>
              <p style={{ marginBottom: 10, color: '#374151' }}>This will also invalidate your current session. You will need to log in again.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnSecondary} onClick={() => setConfirmHard(false)} disabled={busy}>Cancel</button>
                <button style={btnDanger} onClick={handleHardRevoke} disabled={busy}>
                  {busy ? 'Revoking…' : 'Confirm Revoke Immediately'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_ui && npx vitest run src/components/__tests__/AgentAccessCard.test.jsx 2>&1 | tail -20
```

Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2
git add demo_api_ui/src/components/AgentAccessCard.js demo_api_ui/src/components/__tests__/AgentAccessCard.test.jsx
git commit -m "feat: add AgentAccessCard component with soft/hard revoke and session-cleared modal"
```

---

## Task 6: `AdminDelegationPage.js` — "Revoke Immediately" button

**Files:**
- Modify: `demo_api_ui/src/components/AdminDelegationPage.js`

**Interfaces:**
- Consumes: `DELETE /api/delegation/admin/:id/hard` (Task 3)
- Produces: two action buttons per active row — "Revoke" (existing, unchanged) and "Revoke Immediately" (new)

- [ ] **Step 1: Add `revokingHard` state**

In `AdminDelegationPage.js`, add a new state variable alongside the existing `revoking` state (around line 26):

```js
const [revokingHard, setRevokingHard] = useState(null);
```

- [ ] **Step 2: Add `handleRevokeHard` function**

Add after the existing `handleRevoke` function (around line 80):

```js
const handleRevokeHard = async (id) => {
  setRevokingHard(id);
  setPageError('');
  try {
    const res = await fetch(`/api/delegation/admin/${id}/hard`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) {
      setPageError('Hard revoke failed: ' + (data.message || data.error));
    } else {
      const level = data.revoked === 'hard' ? 'Token invalidated.' : 'Delegation revoked (token unavailable).';
      setPageSuccess(`Delegation revoked immediately. ${level}`);
      await load();
      setTimeout(() => setPageSuccess(''), 4000);
    }
  } catch (err) {
    setPageError('Hard revoke error: ' + err.message);
  } finally {
    setRevokingHard(null);
  }
};
```

- [ ] **Step 3: Replace the action cell content in the table row**

Find the action `<td>` cell in the table row (around line 634 in the original — the cell that renders the "Revoke" button or "—"). Replace that cell's content with both buttons:

```jsx
<td style={{ padding: '10px 16px' }}>
  {d.status === 'active' ? (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        onClick={() => handleRevoke(d.id)}
        disabled={revoking === d.id || revokingHard === d.id}
        style={{
          padding: '5px 12px',
          background: '#fee2e2',
          color: (revoking === d.id) ? '#fca5a5' : '#dc2626',
          border: '1px solid #fca5a5',
          borderRadius: 5,
          fontSize: 12,
          fontWeight: 600,
          cursor: (revoking === d.id || revokingHard === d.id) ? 'not-allowed' : 'pointer',
        }}
      >
        {revoking === d.id ? 'Revoking…' : 'Revoke'}
      </button>
      <button
        onClick={() => handleRevokeHard(d.id)}
        disabled={revoking === d.id || revokingHard === d.id}
        style={{
          padding: '5px 12px',
          background: '#7f1d1d',
          color: (revokingHard === d.id) ? '#fca5a5' : '#fff',
          border: '1px solid #991b1b',
          borderRadius: 5,
          fontSize: 12,
          fontWeight: 600,
          cursor: (revoking === d.id || revokingHard === d.id) ? 'not-allowed' : 'pointer',
        }}
      >
        {revokingHard === d.id ? 'Revoking…' : 'Revoke Immediately'}
      </button>
    </div>
  ) : (
    <span style={{ fontSize: 12, color: '#d1d5db' }}>—</span>
  )}
</td>
```

- [ ] **Step 4: Verify no syntax errors**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_ui && npx vitest run src/components/__tests__/ 2>&1 | tail -20
```

Expected: existing test suite passes (no regressions)

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2
git add demo_api_ui/src/components/AdminDelegationPage.js
git commit -m "feat: add Revoke Immediately button to admin delegation table rows"
```

---

## Task 7: Add `AgentAccessCard` to `Profile.js`

**Files:**
- Modify: `demo_api_ui/src/components/Profile.js`

**Interfaces:**
- Consumes: `AgentAccessCard` (Task 5) — no props required
- Produces: `AgentAccessCard` rendered at the bottom of the Profile page, after the devices section

- [ ] **Step 1: Add import**

At the top of `demo_api_ui/src/components/Profile.js`, after the existing imports, add:

```js
import AgentAccessCard from './AgentAccessCard';
```

- [ ] **Step 2: Render `AgentAccessCard`**

In the `return` of `Profile`, find the closing `</div>` of the outermost wrapper. Add `<AgentAccessCard />` just before it:

```jsx
      <AgentAccessCard />
    </div>
  );
}
```

- [ ] **Step 3: Verify the component renders without errors**

```bash
cd /Users/cmuir/Development/AI-DEMO2/demo_api_ui && npx vitest run src/components/__tests__/ 2>&1 | tail -20
```

Expected: all tests PASS (no regressions)

- [ ] **Step 4: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2
git add demo_api_ui/src/components/Profile.js
git commit -m "feat: render AgentAccessCard in Profile page for user self-service agent revocation"
```

---

## Self-Review

Spec coverage check:

| Spec requirement | Task |
| --- | --- |
| LMDB record as gate | Task 4 (delegationGate middleware) |
| Grant writes LMDB record | Task 2 (POST /grant extended) |
| Soft revoke endpoint `DELETE /` | Task 2 |
| Hard revoke endpoint `DELETE /hard` + RFC 7009 | Task 2 |
| Admin hard revoke `DELETE /admin/:id/hard` | Task 3 |
| `findActiveByActorAndGrantor` on store | Task 1 |
| `access_token` stored at grant for admin revoke | Task 1 + Task 2 |
| AgentAccessCard — user self-service | Task 5 |
| Hard revoke modal with "Log in again" | Task 5 |
| AdminDelegationPage — Revoke Immediately | Task 6 |
| Profile — AgentAccessCard rendered | Task 7 |
| Error: 404 on soft revoke with no record | Task 2 (tested) |
| Error: RFC 7009 fail is non-fatal | Task 2 (tested) |
| Error: admin token unavailable → soft fallback | Task 3 |
| Scopes control what agent can do (existing behavior) | No change needed |
