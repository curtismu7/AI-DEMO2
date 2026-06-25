'use strict';
/**
 * resourceServer.transactions.regression.test.js
 * Regression tests for GET /api/resource-server/transactions.
 *
 * Covers: auth gating (Test 8), ?limit param (Test 9), default limit (Test 10).
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
    req.user = { sub: 'tx-test-user' };
    return next();
  },
  requireScopes: () => (req, res, next) => next(),
}));

// ─── Mock bankingDb ───────────────────────────────────────────────────────────
const mockGetTransactionsByUserId = jest.fn();
jest.mock('../../services/bankingDb', () => ({
  getAccountsByUserId:     jest.fn().mockReturnValue([]),
  getTransactionsByUserId: mockGetTransactionsByUserId,
  initBankingDb:           jest.fn(),
}));

// ─── Mock data/store ──────────────────────────────────────────────────────────
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

describe('resourceServer GET /transactions — regression tests', () => {

  beforeEach(() => {
    mockGetTransactionsByUserId.mockClear();
    mockGetTransactionsByUserId.mockReturnValue([]);
  });

  // Test 8: GET /transactions with NO bearer → 401
  it('Test 8: GET /transactions with no Authorization header → 401', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/resource-server/transactions');
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('transactions');
  });

  // Test 9: GET /transactions with valid bearer + ?limit=3 → 200, bankingDb called with limit 3
  it('Test 9: GET /transactions with ?limit=3 → bankingDb called with limit 3', async () => {
    const mockTxs = [
      { id: 'tx-1', type: 'debit',  amount: 50, description: 'Coffee', createdAt: '2024-01-01' },
      { id: 'tx-2', type: 'credit', amount: 100, description: 'Refund', createdAt: '2024-01-02' },
      { id: 'tx-3', type: 'debit',  amount: 20, description: 'Lunch', createdAt: '2024-01-03' },
    ];
    mockGetTransactionsByUserId.mockReturnValue(mockTxs);

    const app = buildApp();
    const res = await request(app)
      .get('/api/resource-server/transactions?limit=3')
      .set('Authorization', 'Bearer valid-bearer');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('transactions');
    expect(Array.isArray(res.body.transactions)).toBe(true);
    expect(res.body.transactions.length).toBe(3);
    // bankingDb was called with the user's sub and limit 3
    expect(mockGetTransactionsByUserId).toHaveBeenCalledWith('tx-test-user', 3);
  });

  // Test 10: GET /transactions without ?limit → bankingDb called with undefined limit (uses default)
  it('Test 10: GET /transactions without ?limit → bankingDb called with undefined (default limit)', async () => {
    mockGetTransactionsByUserId.mockReturnValue([{ id: 'tx-1', type: 'debit', amount: 10, description: 'test', createdAt: '2024-01-01' }]);

    const app = buildApp();
    const res = await request(app)
      .get('/api/resource-server/transactions')
      .set('Authorization', 'Bearer valid-bearer');

    expect(res.status).toBe(200);
    // bankingDb called with the user sub and undefined limit (route passes undefined, bankingDb uses DEFAULT_TX_LIMIT)
    expect(mockGetTransactionsByUserId).toHaveBeenCalledWith('tx-test-user', undefined);
  });
});
