'use strict';
/**
 * resourceServer.accounts.regression.test.js
 * Regression tests for GET /api/resource-server/accounts.
 *
 * Covers: auth gating (Test 6) + accounts returned from bankingDb (Test 7).
 *
 * Per CLAUDE.md two-tier test pattern: mock everything external.
 */

const express = require('express');
const request = require('supertest');

// ─── Mock authenticateToken ───────────────────────────────────────────────────
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'authentication_required' });
    }
    const token = auth.slice(7);
    if (token === 'invalid') {
      return res.status(401).json({ error: 'invalid_token' });
    }
    req.user = { sub: 'test-user-sub' };
    return next();
  },
  requireScopes: () => (req, res, next) => next(),
}));

// ─── Mock bankingDb ───────────────────────────────────────────────────────────
const mockGetAccountsByUserId = jest.fn();
jest.mock('../../services/bankingDb', () => ({
  getAccountsByUserId:     mockGetAccountsByUserId,
  getTransactionsByUserId: jest.fn().mockReturnValue([]),
  initBankingDb:           jest.fn(),
}));

// ─── Mock data/store (required by /summary route in same file) ────────────────
jest.mock('../../data/store', () => ({
  getAccountsByUserId:     jest.fn().mockReturnValue([]),
  getTransactionsByUserId: jest.fn().mockReturnValue([]),
}));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn().mockReturnValue(''),
}));

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
  EVENT_CATEGORIES: { AUTHORIZE: 'authorize', HITL: 'hitl', THRESHOLD: 'threshold' },
}));

// ─── App builder ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { oauthTokens: {} };
    next();
  });
  const { authenticateToken } = require('../../middleware/auth');
  const router = require('../../routes/resourceServer');
  app.use('/api/resource-server', authenticateToken, router);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resourceServer GET /accounts — regression tests', () => {

  beforeEach(() => {
    mockGetAccountsByUserId.mockClear();
  });

  // Test 6: GET /accounts with NO bearer → 401 (token gating)
  it('Test 6: GET /accounts with no Authorization header → 401', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/resource-server/accounts');
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('accounts');
  });

  // Test 7: GET /accounts with valid bearer → 200 + accounts array from bankingDb
  it('Test 7: GET /accounts with valid bearer → 200 + accounts from bankingDb', async () => {
    const mockAccounts = [
      { id: 'acc-1', userId: 'test-user-sub', accountType: 'checking', name: 'Test', balance: 1000, currency: 'USD', status: 'active', accountNumber: '****1234' },
    ];
    mockGetAccountsByUserId.mockReturnValue(mockAccounts);

    const app = buildApp();
    const res = await request(app)
      .get('/api/resource-server/accounts')
      .set('Authorization', 'Bearer valid-bearer');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accounts');
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts.length).toBe(1);
    expect(res.body.accounts[0]).toHaveProperty('id', 'acc-1');
    expect(res.body.accounts[0]).toHaveProperty('balance', 1000);
    // bankingDb was called with the authenticated user's sub
    expect(mockGetAccountsByUserId).toHaveBeenCalledWith('test-user-sub');
  });
});
