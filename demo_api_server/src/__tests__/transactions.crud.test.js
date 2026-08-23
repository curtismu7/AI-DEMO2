/**
 * @file transactions.crud.test.js
 * HTTP-level tests for transaction endpoints NOT covered by transaction-flows.test.js.
 *
 * Covers:
 *   GET  /api/transactions/:id   owner access, admin access, 403 other user, 404 missing
 *   PUT  /api/transactions/:id   admin update, 403 non-admin, 404 missing
 *   DELETE /api/transactions/:id admin delete, 403 non-admin, 404 missing
 *   POST /api/transactions       amount_exceeds_hard_limit (configStore max), amount > 1,000,000
 *
 * Step-up and HITL gates are mocked out so they don't interfere.
 */

'use strict';

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
  requireScopes: () => (req, res, next) => next(),
  requireAdmin:  (req, res, next) => next(),
  requireNotAdmin: (_req, _res, next) => next(),
  hasRequiredScopes: () => true,
  parseTokenScopes: () => [],
  requireAIAgent: (_req, _res, next) => next(),
  requireOwnershipOrAdmin: (_req, _res, next) => next(),
  requireSession: (req, res, next) => next(),
  hashPassword: (p) => p,
}));

// ── Mock data store ───────────────────────────────────────────────────────────
const _txns = [
  { id: 'tx-1', userId: 'user-1', fromAccountId: 'acct-1', amount: 100, type: 'withdrawal', status: 'completed' },
  { id: 'tx-2', userId: 'user-1', fromAccountId: 'acct-1', amount: 50, type: 'deposit', status: 'completed' },
];

jest.mock('../../data/store', () => ({
  getUserById: jest.fn((id) =>
    id === 'user-1' ? { id: 'user-1', firstName: 'Alice', email: 'alice@bank.com' } : null,
  ),
  getAllUsers: jest.fn(() => [{ id: 'user-1', username: 'alice', firstName: 'Alice', lastName: 'A', email: 'alice@bank.com' }]),
  getAccountById: jest.fn((id) =>
    id === 'acct-1'
      ? { id: 'acct-1', userId: 'user-1', accountType: 'checking', balance: 5000 }
      : null,
  ),
  getAccountsByUserId: jest.fn((uid) =>
    uid === 'user-1'
      ? [{ id: 'acct-1', userId: 'user-1', accountType: 'checking', balance: 5000 }]
      : [],
  ),
  getTransactionById: jest.fn((id) => _txns.find((t) => t.id === id) || null),
  getTransactionsByUserId: jest.fn(() => []),
  getAllTransactions: jest.fn(() => _txns),
  createTransaction: jest.fn((data) => ({ ...data, id: 'tx-new', createdAt: new Date().toISOString() })),
  updateAccountBalance: jest.fn(),
  updateTransaction: jest.fn(async (id, data) => {
    const txn = _txns.find((t) => t.id === id);
    return txn ? { ...txn, ...data } : null;
  }),
  deleteTransaction: jest.fn(async (id) => {
    const idx = _txns.findIndex((t) => t.id === id);
    return idx >= 0 ? true : null;
  }),
}));

// ── Mock PingOne + authorization services ─────────────────────────────────────
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn().mockResolvedValue({ decision: 'PERMIT', raw: {} }),
  evaluateMcpToolDelegation: jest.fn().mockResolvedValue({ decision: 'PERMIT', stepUpRequired: false, raw: {} }),
  isMcpDelegationDecisionReady: jest.fn(() => false),
}));

jest.mock('../../services/transactionAuthorizationService', () => ({
  evaluateTransactionPolicy: jest.fn().mockResolvedValue({ ran: false, reason: 'disabled' }),
}));

jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn((key) => {
    if (key === 'ff_hitl_enabled') return 'false';
    if (key === 'max_transaction_amount') return '10000';
    return null;
  }),
  setConfig: jest.fn().mockResolvedValue(undefined),
  isReadOnly: jest.fn(() => false),
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
  isConfigured: jest.fn(() => false),
  FIELD_DEFS: {},
  SECRET_KEYS: [],
  validateTwoExchangeConfig: jest.fn(() => ({ valid: false, missing: [] })),
  buildAllowedScopesByAudience: jest.fn(() => ({})),
}));

// ── Mock demoScenarioStore ────────────────────────────────────────────────────
jest.mock('../../services/demoScenarioStore', () => ({
  load: jest.fn(async () => ({ accountSnapshot: [] })),
  save: jest.fn(async () => {}),
}));

jest.mock('../../middleware/demoMode', () => ({
  blockInDemoMode: () => (req, res, next) => next(),
}));

const app = require('../../server');
const runtimeSettings = require('../../config/runtimeSettings');
const configStore = require('../../services/configStore');

beforeAll(() => {
  runtimeSettings.update({ stepUpEnabled: false, authorizeEnabled: false });
});

const adminUser  = () => JSON.stringify({ id: 'admin-1', role: 'admin',  scopes: ['write', 'read'] });
const ownerUser  = () => JSON.stringify({ id: 'user-1',  role: 'user',   scopes: ['write', 'read'], acr: 'Multi_factor' });
const otherUser  = () => JSON.stringify({ id: 'user-2',  role: 'user',   scopes: ['write', 'read'], acr: 'Multi_factor' });

// ── GET / — admin list-all + pagination ───────────────────────────────────────

describe('GET /api/transactions — admin list', () => {
  it('returns every transaction and the total when no limit/offset is given', async () => {
    const res = await request(app).get('/api/transactions').set('x-test-user', adminUser());
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(_txns.length);
    expect(res.body.total).toBe(_txns.length);
  });

  it('slices the response when limit/offset are given', async () => {
    const res = await request(app)
      .get('/api/transactions?limit=1&offset=1')
      .set('x-test-user', adminUser());
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0].id).toBe(_txns[1].id);
    expect(res.body.total).toBe(_txns.length);
  });
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

describe('GET /api/transactions/:id', () => {
  it('returns the transaction to the owning user', async () => {
    const res = await request(app).get('/api/transactions/tx-1').set('x-test-user', ownerUser());
    expect(res.status).toBe(200);
    expect(res.body.transaction.id).toBe('tx-1');
  });

  it('returns the transaction to an admin', async () => {
    const res = await request(app).get('/api/transactions/tx-1').set('x-test-user', adminUser());
    expect(res.status).toBe(200);
  });

  it('returns 403 when a different user tries to view the transaction', async () => {
    const res = await request(app).get('/api/transactions/tx-1').set('x-test-user', otherUser());
    expect(res.status).toBe(403);
  });

  it('returns 404 when the transaction does not exist', async () => {
    const res = await request(app).get('/api/transactions/no-such-tx').set('x-test-user', adminUser());
    expect(res.status).toBe(404);
  });
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────

describe('PUT /api/transactions/:id', () => {
  it('admin updates transaction and returns 200', async () => {
    const res = await request(app)
      .put('/api/transactions/tx-1')
      .set('x-test-user', adminUser())
      .send({ description: 'Updated description' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('transaction');
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .put('/api/transactions/tx-1')
      .set('x-test-user', ownerUser())
      .send({ description: 'hacked' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown transaction', async () => {
    const res = await request(app)
      .put('/api/transactions/no-such-tx')
      .set('x-test-user', adminUser())
      .send({ description: 'whatever' });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('DELETE /api/transactions/:id', () => {
  it('admin deletes transaction and returns 200', async () => {
    const res = await request(app).delete('/api/transactions/tx-1').set('x-test-user', adminUser());
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app).delete('/api/transactions/tx-1').set('x-test-user', ownerUser());
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown transaction', async () => {
    const res = await request(app).delete('/api/transactions/no-such-tx').set('x-test-user', adminUser());
    expect(res.status).toBe(404);
  });
});

// ── POST / — amount limit guards ──────────────────────────────────────────────

describe('POST /api/transactions — amount limit gates', () => {
  it('returns 400 amount_exceeds_limit when amount exceeds $1,000,000', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', ownerUser())
      .send({ fromAccountId: 'acct-1', amount: 1_000_001, type: 'withdrawal', description: 'too large' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('amount_exceeds_limit');
  });

  it('returns 400 amount_exceeds_hard_limit when amount exceeds configStore max ($10,000)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', ownerUser())
      .send({ fromAccountId: 'acct-1', amount: 10_001, type: 'withdrawal', description: 'over hard limit' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('amount_exceeds_hard_limit');
  });

  it('honors an explicit configStore max of 0 (admin "freeze all transactions") instead of falling back to $1000', async () => {
    // Regression: MAX_TRANSACTION_AMOUNT was computed with `parseFloat(...) || 1000`,
    // and parseFloat('0') === 0 is falsy, so an admin-set hard limit of 0 silently
    // reinstated the $1000 default instead of blocking every transaction.
    const original = configStore.getEffective.getMockImplementation();
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ff_hitl_enabled') return 'false';
      if (key === 'max_transaction_amount') return '0';
      return null;
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', ownerUser())
      .send({ fromAccountId: 'acct-1', amount: 1, type: 'withdrawal', description: 'should be frozen' });

    configStore.getEffective.mockImplementation(original);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('amount_exceeds_hard_limit');
    expect(res.body.limit).toBe(0);
  });

  it('returns 400 invalid_amount for non-positive amount', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', ownerUser())
      .send({ fromAccountId: 'acct-1', amount: -50, type: 'withdrawal', description: 'negative' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_amount');
  });

  it('returns 403 when admin tries to post a transaction (must use customer account)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', adminUser())
      .send({ fromAccountId: 'acct-1', amount: 100, type: 'withdrawal', description: 'admin tx' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
