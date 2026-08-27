/**
 * @file accounts.route.test.js
 * HTTP-level tests for the accounts route endpoints NOT covered by
 * accounts-cold-start.test.js (which covers GET /my cold-start restoration).
 *
 * Covers:
 *   GET  /                  admin lists all accounts (403 for non-admin)
 *   GET  /:id               admin fetches account by ID (403/404)
 *   GET  /:id/balance       owner or admin balance; type-name alias; 403 other user
 *   POST /                  admin creates account (403 non-admin, demo-mode blocked)
 *   PUT  /:id               admin updates account (403 non-admin, 404 missing)
 *   DELETE /:id             admin deletes account (403 non-admin, 404 missing)
 *   POST /reset-demo        resets current user's demo accounts
 *   POST /reset-all-demo    admin resets all demo accounts (403 non-admin)
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Mock auth ─────────────────────────────────────────────────────────────────
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) return res.status(401).json({ error: 'authentication_required' });
    try {
      req.user = JSON.parse(h);
      req.session = req.session || {};
      req.session.user = req.user;
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  },
  requireNotAdmin: (_req, _res, next) => next(),
  requireScopes: () => (req, res, next) => next(),
}));

// ── Mock demoMode ─────────────────────────────────────────────────────────────
jest.mock('../../middleware/demoMode', () => ({
  blockInDemoMode: (action) => (req, res, next) => {
    if (req.headers['x-demo-mode'] === 'true') {
      return res.status(403).json({ error: 'demo_mode', action });
    }
    return next();
  },
}));

// ── Mock posthog ──────────────────────────────────────────────────────────────
jest.mock('../../services/posthog', () => ({ capture: jest.fn() }));

// ── Mutable in-memory store ───────────────────────────────────────────────────
const _store = {
  accounts: [
    {
      id: 'acct-1', userId: 'user-1', accountType: 'checking', name: 'Checking',
      balance: 5000, currency: 'USD', accountNumber: '****1234',
      accountNumberFull: '011234567890', routingNumber: '026073150',
    },
    {
      id: 'acct-2', userId: 'user-1', accountType: 'savings', name: 'Savings',
      balance: 2500, currency: 'USD', accountNumber: '****5678',
    },
  ],
  users: [
    { id: 'user-1', username: 'alice', email: 'alice@bank.com', firstName: 'Alice', lastName: 'Smith' },
  ],
  transactions: [],
};

jest.mock('../../data/store', () => ({
  getAllAccounts: jest.fn(() => _store.accounts),
  getAllUsers: jest.fn(() => _store.users),
  getAccountsByUserId: jest.fn((uid) => _store.accounts.filter((a) => a.userId === uid)),
  getAccountById: jest.fn((id) => _store.accounts.find((a) => a.id === id) || null),
  getAccountBalance: jest.fn((id) => {
    const acct = _store.accounts.find((a) => a.id === id);
    return acct ? acct.balance : null;
  }),
  createAccount: jest.fn(async (data) => {
    const acct = { ...data, id: data.id || `acct-new-${Date.now()}` };
    _store.accounts.push(acct);
    return acct;
  }),
  updateAccount: jest.fn(async (id, data) => {
    const idx = _store.accounts.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    _store.accounts[idx] = { ..._store.accounts[idx], ...data };
    return _store.accounts[idx];
  }),
  deleteAccount: jest.fn(async (id) => {
    const idx = _store.accounts.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const [removed] = _store.accounts.splice(idx, 1);
    return removed;
  }),
  getTransactionsByUserId: jest.fn(() => []),
  deleteTransaction: jest.fn(async () => true),
  createTransaction: jest.fn(async (data) => ({ ...data, id: `tx-${Date.now()}`, createdAt: new Date().toISOString() })),
}));

// ── Mock demoScenarioStore ────────────────────────────────────────────────────
jest.mock('../../services/demoScenarioStore', () => ({
  load: jest.fn(async () => ({ accountSnapshot: [] })),
  save: jest.fn(async () => {}),
}));

const accountsRouter = require('../../routes/accounts');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {};
    next();
  });
  app.use('/api/accounts', accountsRouter);
  return app;
}

const adminHeader = () => JSON.stringify({ id: 'admin-1', role: 'admin', scopes: ['read', 'write'] });
const userHeader  = () => JSON.stringify({ id: 'user-1',  role: 'user',  scopes: ['read'] });
const otherHeader = () => JSON.stringify({ id: 'user-2',  role: 'user',  scopes: ['read'] });

// ── GET / ─────────────────────────────────────────────────────────────────────

describe('GET /api/accounts — admin list', () => {
  it('returns all accounts enriched with owner info for admin', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts').set('x-test-user', adminHeader());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts[0]).toHaveProperty('ownerUsername');
  });

  it('returns 403 for non-admin', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts').set('x-test-user', userHeader());
    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(401);
  });

  it('returns every account and the total when no limit/offset is given', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts').set('x-test-user', adminHeader());
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(_store.accounts.length);
    expect(res.body.total).toBe(_store.accounts.length);
  });

  it('slices the response when limit/offset are given', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/accounts?limit=1&offset=1')
      .set('x-test-user', adminHeader());
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].id).toBe(_store.accounts[1].id);
    expect(res.body.total).toBe(_store.accounts.length);
  });
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

describe('GET /api/accounts/:id — get by ID', () => {
  it('returns account for admin', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts/acct-1').set('x-test-user', adminHeader());
    expect(res.status).toBe(200);
    expect(res.body.account.id).toBe('acct-1');
  });

  it('returns 404 for unknown account', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts/no-such-id').set('x-test-user', adminHeader());
    expect(res.status).toBe(404);
  });

  it('returns 403 for non-admin', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts/acct-1').set('x-test-user', userHeader());
    expect(res.status).toBe(403);
  });
});

// ── GET /:id/balance ──────────────────────────────────────────────────────────

describe('GET /api/accounts/:id/balance — balance check', () => {
  it('returns balance for account owner', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts/acct-1/balance').set('x-test-user', userHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('balance', 5000);
  });

  it('returns balance for admin (not owner)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts/acct-1/balance').set('x-test-user', adminHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('balance');
  });

  it('returns 403 when a different user checks another users account', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts/acct-1/balance').set('x-test-user', otherHeader());
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown account', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts/does-not-exist/balance').set('x-test-user', adminHeader());
    expect(res.status).toBe(404);
  });

  it('resolves type-name alias "checking" to the user account', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/accounts/checking/balance').set('x-test-user', userHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('balance');
  });
});

// ── POST / ────────────────────────────────────────────────────────────────────

describe('POST /api/accounts — create account', () => {
  it('admin creates account and returns 201', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/accounts')
      .set('x-test-user', adminHeader())
      .send({ userId: 'user-1', accountType: 'investment', name: 'Investment', balance: 0, currency: 'USD' });
    expect(res.status).toBe(201);
    expect(res.body.account).toHaveProperty('accountType', 'investment');
  });

  it('returns 403 for non-admin', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/accounts')
      .set('x-test-user', userHeader())
      .send({ userId: 'user-1', accountType: 'savings' });
    expect(res.status).toBe(403);
  });

  it('returns 403 in demo mode', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/accounts')
      .set('x-test-user', adminHeader())
      .set('x-demo-mode', 'true')
      .send({ userId: 'user-1', accountType: 'savings' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('demo_mode');
  });
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────

describe('PUT /api/accounts/:id — update account', () => {
  it('admin updates account successfully', async () => {
    const app = buildApp();
    const res = await request(app)
      .put('/api/accounts/acct-1')
      .set('x-test-user', adminHeader())
      .send({ name: 'Primary Checking' });
    expect(res.status).toBe(200);
    expect(res.body.account.name).toBe('Primary Checking');
  });

  it('returns 403 for non-admin', async () => {
    const app = buildApp();
    const res = await request(app)
      .put('/api/accounts/acct-1')
      .set('x-test-user', userHeader())
      .send({ name: 'hacked' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown account', async () => {
    const app = buildApp();
    const res = await request(app)
      .put('/api/accounts/no-such-id')
      .set('x-test-user', adminHeader())
      .send({ name: 'whatever' });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('DELETE /api/accounts/:id — delete account', () => {
  it('admin deletes account successfully', async () => {
    // Add a throwaway account so we don't corrupt the fixture
    _store.accounts.push({ id: 'acct-del', userId: 'user-1', accountType: 'checking', balance: 0 });
    const app = buildApp();
    const res = await request(app).delete('/api/accounts/acct-del').set('x-test-user', adminHeader());
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
  });

  it('returns 403 for non-admin', async () => {
    const app = buildApp();
    const res = await request(app).delete('/api/accounts/acct-1').set('x-test-user', userHeader());
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown account', async () => {
    const app = buildApp();
    const res = await request(app).delete('/api/accounts/no-such-id').set('x-test-user', adminHeader());
    expect(res.status).toBe(404);
  });
});

// ── POST /reset-demo ──────────────────────────────────────────────────────────

describe('POST /api/accounts/reset-demo — reset user demo', () => {
  it('returns 200 with accounts after reset', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/accounts/reset-demo').set('x-test-user', userHeader());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
  });
});

// ── POST /reset-all-demo ──────────────────────────────────────────────────────

describe('POST /api/accounts/reset-all-demo — admin reset all', () => {
  it('returns 200 for admin', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/accounts/reset-all-demo').set('x-test-user', adminHeader());
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reset/i);
  });

  it('returns 403 for non-admin', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/accounts/reset-all-demo').set('x-test-user', userHeader());
    expect(res.status).toBe(403);
  });
});
