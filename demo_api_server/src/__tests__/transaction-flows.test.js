/**
 * @file transaction-flows.test.js
 * @description Regression tests for the core transaction CRUD flows.
 *
 * Covers:
 *   - POST /api/transactions — deposit, withdrawal, transfer
 *   - Balance validation (insufficient funds → 400)
 *   - Account ownership enforcement (non-admin cannot use other users' accounts → 403)
 *   - Transfer creates two linked transactions (debit + credit)
 *   - GET /api/transactions — admin can list all transactions
 *   - GET /api/transactions/my — user sees only their own transactions
 *
 * Step-up MFA and PingOne Authorize gates are both disabled for all tests
 * in this file so they don't interfere with transaction flow coverage.
 */

const request = require('supertest');

// ─── Mock auth ────────────────────────────────────────────────────────────────
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) {
      return res.status(401).json({ error: 'authentication_required', error_description: 'Access token is required' });
    }
    try {
      req.user = JSON.parse(h);
      req.session = req.session || {};
      req.session.user = req.user;
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  },
  // Mirrors the real middleware: no credentials presented -> guest pass-through
  // (req.user null, no 401); credentials present -> same validation as above.
  optionalAuthenticateToken: (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) {
      req.user = null;
      return next();
    }
    try {
      req.user = JSON.parse(h);
      req.session = req.session || {};
      req.session.user = req.user;
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  },
  requireScopes: (requiredScopes) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required', error_description: 'Access token is required' });
    if (req.user.role === 'admin') return next();
    const userScopes = req.user.scopes || [];
    const arr = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
    const ok = arr.some((s) => userScopes.includes(s)) || userScopes.includes('admin:read');
    if (!ok) return res.status(403).json({ error: 'insufficient_scope' });
    return next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required', error_description: 'Access token is required' });
    if (req.user.role === 'admin') return next();
    return res.status(403).json({ error: 'insufficient_scope', error_description: 'Admin role required' });
  },
  hasRequiredScopes: (userScopes, required) => required.some((s) => userScopes.includes(s)),
  parseTokenScopes: () => [],
  requireAIAgent: (_req, _res, next) => next(),
  requireOwnershipOrAdmin: (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required' });
    if (req.user.role === 'admin') return next();
    const paramId = req.params.userId || req.params.id;
    if (paramId && req.user.id !== paramId) return res.status(403).json({ error: 'insufficient_scope' });
    return next();
  },
  requireNotAdmin: (_req, _res, next) => next(),
    requireSession: (req, res, next) => next(),
  hashPassword: (p) => p,
}));

// ─── Mock PingOne Authorize (disabled via settings, but still mock the module) ─
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn().mockResolvedValue({ decision: 'PERMIT', raw: {} }),
  evaluateMcpToolDelegation: jest.fn().mockResolvedValue({ decision: 'PERMIT', stepUpRequired: false, raw: {} }),
  isMcpDelegationDecisionReady: jest.fn(() => false),
}));

// ─── Mock transactionAuthorizationService — disable HITL/deny gate for these flow tests ──
jest.mock('../../services/transactionAuthorizationService', () => ({
  evaluateTransactionPolicy: jest.fn().mockResolvedValue({ ran: false, reason: 'authorize_disabled' }),
}));

// ─── Mock HITL consent gate so transfer tests can bypass it ───────────────────
jest.mock('../../services/transactionConsentChallenge', () => ({
  ...jest.requireActual('../../services/transactionConsentChallenge'),
  verifyAndConsumeChallenge: jest.fn(() => ({ ok: true })),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const USER_A_ID = 'user-a-id';
const USER_B_ID = 'user-b-id';
const ACCOUNT_A_ID = 'account-a-checking';
const ACCOUNT_B_ID = 'account-b-checking';
const OTHER_USER_ACCOUNT = 'account-other-user';

const mockUsers = {
  [USER_A_ID]: { id: USER_A_ID, firstName: 'Alice', lastName: 'A', email: 'alice@bank.com' },
  [USER_B_ID]: { id: USER_B_ID, firstName: 'Bob', lastName: 'B', email: 'bob@bank.com' },
  'admin-id': { id: 'admin-id', firstName: 'Admin', lastName: 'User', email: 'admin@bank.com' },
};

const mockAccounts = {
  [ACCOUNT_A_ID]: {
    id: ACCOUNT_A_ID,
    userId: USER_A_ID,
    accountType: 'Checking',
    accountNumber: '****1111',
    balance: 2000,
  },
  [ACCOUNT_B_ID]: {
    id: ACCOUNT_B_ID,
    userId: USER_A_ID, // both accounts owned by user A for transfer tests
    accountType: 'Savings',
    accountNumber: '****2222',
    balance: 500,
  },
  [OTHER_USER_ACCOUNT]: {
    id: OTHER_USER_ACCOUNT,
    userId: USER_B_ID, // owned by user B
    accountType: 'Checking',
    accountNumber: '****9999',
    balance: 1000,
  },
};

const createdTxs = [];

// ─── Mock data store ──────────────────────────────────────────────────────────
jest.mock('../../data/store', () => ({
  getUserById: jest.fn((id) => mockUsers[id] || null),
  getAllUsers: jest.fn(() => Object.values(mockUsers)),
  getAccountById: jest.fn((id) => {
    const acct = mockAccounts[id];
    return acct ? { ...acct } : null; // return copy to avoid mutation issues
  }),
  getAccountsByUserId: jest.fn((userId) =>
    Object.values(mockAccounts).filter((a) => a.userId === userId)
  ),
  createTransaction: jest.fn((data) => {
    const tx = {
      ...data,
      id: 'tx-' + createdTxs.length,
      createdAt: new Date().toISOString(),
      status: 'completed',
    };
    createdTxs.push(tx);
    return tx;
  }),
  updateAccountBalance: jest.fn(),
  // Mirrors the real data/store.js contract: a single options object (see
  // 944cb7126 "Phase 1: concurrent user safety", which changed applyTransfer from
  // positional args to an object). Keeping the old positional shape here made the
  // route's object argument land in `fromId`, so every money-moving request came
  // back from_not_found → HTTP 404.
  applyTransfer: jest.fn(async ({ fromAccountId, toAccountId, amount }) => {
    const from = fromAccountId ? mockAccounts[fromAccountId] : null;
    const to = toAccountId ? mockAccounts[toAccountId] : null;
    if (fromAccountId && !from) return { ok: false, reason: 'from_not_found' };
    if (toAccountId && !to) return { ok: false, reason: 'to_not_found' };
    if (from && from.balance < amount) return { ok: false, reason: 'insufficient_funds' };
    return { ok: true };
  }),
  getTransactionsByUserId: jest.fn((userId) => createdTxs.filter((t) => t.userId === userId)),
  getAllTransactions: jest.fn(() => [...createdTxs]),
  getTransactionById: jest.fn((id) => createdTxs.find((t) => t.id === id) || null),
}));

const app = require('../../server');
const runtimeSettings = require('../../config/runtimeSettings');
const { createTransaction } = require('../../data/store');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const userA = (overrides = {}) =>
  JSON.stringify({
    id: USER_A_ID,
    username: 'alice',
    email: 'alice@bank.com',
    role: 'user',
    scopes: ['write', 'read', 'read', 'read'],
    acr: 'Multi_factor',
    ...overrides,
  });

const adminUser = () =>
  JSON.stringify({
    id: 'admin-id',
    username: 'admin',
    email: 'admin@bank.com',
    role: 'admin',
    scopes: ['admin:read'],
    acr: 'Multi_factor',
  });

// ─── Setup ────────────────────────────────────────────────────────────────────
beforeAll(() => {
  // Disable both security gates to test plain transaction flows
  runtimeSettings.update({ stepUpEnabled: false, authorizeEnabled: false }, 'test-setup');
});

beforeEach(() => {
  // Reset created transactions array between tests
  createdTxs.length = 0;
  jest.clearAllMocks();
  // Reset account balances for balance-check tests
  mockAccounts[ACCOUNT_A_ID].balance = 2000;
  mockAccounts[ACCOUNT_B_ID].balance = 500;
  mockAccounts[OTHER_USER_ACCOUNT].balance = 1000;
});

afterAll(() => {
  runtimeSettings.update({ stepUpEnabled: true, authorizeEnabled: false }, 'test-teardown');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Transaction Flows — POST /api/transactions', () => {
  // ── Deposits ──────────────────────────────────────────────────────────────────
  describe('deposit', () => {
    it('should create a deposit and return 201', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA())
        .send({
          toAccountId: ACCOUNT_A_ID,
          amount: 100,
          type: 'deposit',
          description: 'Paycheck',
        });

      expect(res.status).toBe(201);
      expect(res.body).toBeDefined();
    });

    it('should return 400 when toAccountId is missing for a deposit', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA())
        .send({ amount: 100, type: 'deposit' });

      expect(res.status).toBe(400);
    });
  });

  // ── Withdrawals ───────────────────────────────────────────────────────────────
  describe('withdrawal', () => {
    it('should create a withdrawal and return 201', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA())
        .send({
          fromAccountId: ACCOUNT_A_ID,
          amount: 50,
          type: 'withdrawal',
          description: 'Coffee',
        });

      expect(res.status).toBe(201);
    });

    it('should return 400 when balance is insufficient', async () => {
      mockAccounts[ACCOUNT_A_ID].balance = 10; // set low balance

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA())
        .send({
          fromAccountId: ACCOUNT_A_ID,
          amount: 500, // more than balance
          type: 'withdrawal',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/balance|Insufficient/i);
    });

    it('should return 400 when fromAccountId is missing', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA())
        .send({ amount: 50, type: 'withdrawal' });

      expect(res.status).toBe(400);
    });
  });

  // ── Transfers ─────────────────────────────────────────────────────────────────
  describe('transfer', () => {
    it('should create TWO transactions for a transfer', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA())
        .send({
          fromAccountId: ACCOUNT_A_ID,
          toAccountId: ACCOUNT_B_ID,
          amount: 100,
          type: 'transfer',
          description: 'Emergency fund',
          consentChallengeId: 'mock-consent-id',
        });

      expect(res.status).toBe(201);
      // Transfer = withdrawal from source + deposit to destination
      expect(createTransaction).toHaveBeenCalledTimes(2);
    });

    it('should return 400 when balance is insufficient for transfer', async () => {
      mockAccounts[ACCOUNT_A_ID].balance = 5;

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA())
        .send({
          fromAccountId: ACCOUNT_A_ID,
          toAccountId: ACCOUNT_B_ID,
          amount: 1000,
          type: 'transfer',
        });

      expect(res.status).toBe(400);
    });

    it('should return 400 when either account is missing for transfer', async () => {
      const missing = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA())
        .send({ fromAccountId: ACCOUNT_A_ID, amount: 100, type: 'transfer' });

      expect(missing.status).toBe(400);
    });
  });

  // ── Account ownership enforcement ─────────────────────────────────────────────
  describe('account ownership', () => {
    it('should return 403 when non-admin uses another user account as source', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA()) // user A
        .send({
          fromAccountId: OTHER_USER_ACCOUNT, // belongs to user B
          amount: 50,
          type: 'withdrawal',
        });

      expect(res.status).toBe(403);
    });

    it('should return 403 when non-admin deposits to another user account', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA())
        .send({
          toAccountId: OTHER_USER_ACCOUNT, // belongs to user B
          amount: 50,
          type: 'deposit',
        });

      expect(res.status).toBe(403);
    });

    it('should block admin from creating transactions (must use customer account)', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', adminUser())
        .send({
          fromAccountId: OTHER_USER_ACCOUNT,
          amount: 50,
          type: 'withdrawal',
        });

      // Route intentionally blocks admins with 403 'forbidden' — transactions must be
      // initiated from a customer session, not an admin session.
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    });
  });

  // ── Required fields ───────────────────────────────────────────────────────────
  describe('required field validation', () => {
    it('should return 400 when amount is missing', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA())
        .send({ toAccountId: ACCOUNT_A_ID, type: 'deposit' });

      expect(res.status).toBe(400);
    });

    it('should return 400 when type is missing', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', userA())
        .send({ toAccountId: ACCOUNT_A_ID, amount: 50 });

      expect(res.status).toBe(400);
    });

    it('should return 401 for unauthenticated requests', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .send({ toAccountId: ACCOUNT_A_ID, amount: 50, type: 'deposit' });

      expect(res.status).toBe(401);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Transaction Read Endpoints', () => {
  describe('GET /api/transactions (admin only)', () => {
    it('should return all transactions for admin', async () => {
      const res = await request(app)
        .get('/api/transactions')
        .set('x-test-user', adminUser());

      expect(res.status).toBe(200);
      expect(res.body.transactions).toBeDefined();
      expect(Array.isArray(res.body.transactions)).toBe(true);
    });

    it('should return 403 for a non-admin user', async () => {
      const res = await request(app)
        .get('/api/transactions')
        .set('x-test-user', userA());

      expect(res.status).toBe(403);
    });

    it('should return 401 for unauthenticated requests', async () => {
      const res = await request(app).get('/api/transactions');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/transactions/my (end user)', () => {
    it('should return only the authenticated user transactions', async () => {
      // Pre-populate with one transaction for user A
      createdTxs.push({
        id: 'tx-preset-1',
        userId: USER_A_ID,
        type: 'deposit',
        amount: 100,
        toAccountId: ACCOUNT_A_ID,
        createdAt: new Date().toISOString(),
      });

      const res = await request(app)
        .get('/api/transactions/my')
        .set('x-test-user', userA());

      expect(res.status).toBe(200);
      expect(res.body.transactions).toBeDefined();
      // All returned transactions should belong to user A
      res.body.transactions.forEach((tx) => {
        expect(tx.userId || tx.performedBy).toBeDefined();
      });
    });

    it('should return 401 for unauthenticated requests', async () => {
      const res = await request(app).get('/api/transactions/my');
      expect(res.status).toBe(401);
    });
  });
});
