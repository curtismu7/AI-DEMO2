'use strict';
/**
 * HITL Route Regression Tests
 *
 * Tests for POST /api/transactions with HITL (Human-in-the-Loop) consent requirements
 * Critical gaps covered:
 * - Transfer without consentChallengeId when HITL enabled: returns 428
 * - Transfer with admin role: HITL bypassed
 * - Transfer when ff_hitl_enabled=false: HITL bypassed
 * - Deposit below threshold: no 428
 * - Deposit above threshold without consentChallengeId: returns 428
 * - Transfer ALWAYS requires consent regardless of amount (Phase 170 invariant)
 */

'use strict';

const express = require('express');
const request = require('supertest');

// Mock auth middleware BEFORE requiring routes
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => next(),
  requireNotAdmin: (_req, _res, next) => next(),
  requireSession: (req, res, next) => next(),
  requireScopes: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/hitlGatewayMiddleware', () => (req, res, next) => next());
jest.mock('../../middleware/demoMode', () => ({
  blockInDemoMode: () => (req, res, next) => next(),
}));
jest.mock('express-rate-limit', () => jest.fn(() => (req, res, next) => next()));

jest.mock('../../data/store', () => ({
  getAccountById: jest.fn((id) => {
    return { id, userId: 'test-user-1', type: 'checking', accountType: 'checking', accountNumber: '0001', balance: 5000 };
  }),
  getUserById: jest.fn(() => ({ id: 'test-user-1', username: 'test_user' })),
  createTransaction: jest.fn((tx) => ({ ...tx, id: 'tx-456' })),
  getTransactionsByUserId: jest.fn(() => []),
  getAccountsByUserId: jest.fn(() => []),
  updateAccountBalance: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/transactionConsentChallenge', () => ({
  HIGH_VALUE_CONSENT_USD: 500,
  createChallenge: jest.fn(),
  confirmChallenge: jest.fn(),
  verifyOtp: jest.fn(),
  verifyMfa: jest.fn(),
  selectMfaDevice: jest.fn(),
  getChallenge: jest.fn(),
  verifyAndConsumeChallenge: jest.fn(() => ({ ok: true })),
}));

jest.mock('../../services/demoScenarioStore', () => ({
  load: jest.fn(() => Promise.resolve({ accountSnapshot: [], transactionSnapshot: [] })),
  save: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
  EVENT_CATEGORIES: { AUTHORIZE: 'authorize', HITL: 'hitl', THRESHOLD: 'threshold' },
}));

// evaluateTransactionPolicy returns a HITL consent block for transfers (always) and large deposits.
// Small deposits (≤ confirm_threshold_usd) get a permit.
jest.mock('../../services/transactionAuthorizationService', () => ({
  evaluateTransactionPolicy: jest.fn(({ type, amount }) => {
    const HITL_THRESHOLD = 500;
    const needsConsent = type === 'transfer' || (type !== 'deposit' ? false : amount > HITL_THRESHOLD);
    if (needsConsent) {
      return Promise.resolve({
        ran: true,
        block: {
          status: 428,
          body: {
            error: 'hitl_required',
            hitl: { type: 'consent' },
            error_description: 'This transaction requires explicit human approval.',
          },
        },
      });
    }
    return Promise.resolve({ ran: true, permit: true, evaluation: { decision: 'PERMIT', engine: 'simulated', path: 'simulated' } });
  }),
}));

jest.mock('../../config/runtimeSettings', () => ({
  isDemoMode: jest.fn(() => false),
  get: jest.fn((key) => {
    const defaults = {
      'stepUpEnabled': false,
      'stepUpAmountThreshold': 500,
    };
    return defaults[key] || null;
  }),
}));

jest.mock('../../services/emailService', () => ({
  sendTransactionConfirmation: jest.fn(() => Promise.resolve()),
}));

// Mock configStore to control ff_hitl_enabled per test.
// Must expose both get() and getEffective() — the transactions route calls both.
const mockConfigStore = {
  get: jest.fn(() => null),
  getEffective: jest.fn((key) => {
    const defaults = {
      'ff_hitl_enabled': 'true',
      'confirm_threshold_usd': '500',
    };
    return defaults[key] || null;
  }),
};
jest.mock('../../services/configStore', () => mockConfigStore);

function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject test user via middleware
  app.use((req, res, next) => {
    const userRole = req.get('x-test-role') || 'customer';
    req.user = {
      id: 'test-user-1',
      username: 'test_user',
      email: 'test@example.com',
      role: userRole,
      // Required for inline scope check in transactions route (write for write ops)
      scopes: ['read', 'write'],
    };
    req.session = req.session || {};
    req.session.user = req.user;
    next();
  });

  const txnRoutes = require('../../routes/transactions');
  app.use('/api/transactions', txnRoutes);

  return app;
}

describe('POST /api/transactions HITL Gate', () => {
  let app, agent;

  beforeEach(() => {
    // Reset config to defaults
    mockConfigStore.getEffective.mockImplementation((key) => {
      const defaults = {
        'ff_hitl_enabled': 'true',
        'confirm_threshold_usd': '500',
      };
      return defaults[key] || null;
    });
    app = buildApp();
    agent = request.agent(app);
  });

  test('Transfer without consentChallengeId when HITL enabled: returns 428', async () => {
    const res = await agent
      .post('/api/transactions')
      .send({
        fromAccountId: 'acc-123',
        toAccountId: 'acc-456',
        amount: 100,
        type: 'transfer',
        description: 'Test transfer',
      });

    expect(res.status).toBe(428);
    expect(res.body.error).toBe('hitl_required');
  });

  test('Transfer with admin role: HITL bypassed', async () => {
    const res = await agent
      .set('x-test-role', 'admin')
      .post('/api/transactions')
      .send({
        fromAccountId: 'acc-123',
        toAccountId: 'acc-456',
        amount: 100,
        type: 'transfer',
        description: 'Test transfer',
      });

    expect(res.status).not.toBe(428);
  });

  test('Transfer when ff_hitl_enabled=false: HITL bypassed', async () => {
    mockConfigStore.getEffective.mockImplementation((key) => {
      const vals = { 'ff_hitl_enabled': 'false', 'confirm_threshold_usd': '500' };
      return vals[key] || null;
    });

    const res = await agent
      .post('/api/transactions')
      .send({
        fromAccountId: 'acc-123',
        toAccountId: 'acc-456',
        amount: 100,
        type: 'transfer',
        description: 'Test transfer',
      });

    expect(res.status).not.toBe(428);
  });

  test('Deposit below threshold ($100): no 428', async () => {
    const res = await agent
      .post('/api/transactions')
      .send({
        fromAccountId: null,
        toAccountId: 'acc-123',
        amount: 100,
        type: 'deposit',
        description: 'Test deposit',
      });

    expect(res.status).not.toBe(428);
  });

  test('Deposit above threshold ($600) without consentChallengeId: returns 428', async () => {
    const res = await agent
      .post('/api/transactions')
      .send({
        fromAccountId: null,
        toAccountId: 'acc-123',
        amount: 600,
        type: 'deposit',
        description: 'Test deposit',
      });

    expect(res.status).toBe(428);
    expect(res.body.error).toBe('hitl_required');
  });

  test('Transfer of $0.01 ALWAYS requires consent (Phase 170 invariant)', async () => {
    const res = await agent
      .post('/api/transactions')
      .send({
        fromAccountId: 'acc-123',
        toAccountId: 'acc-456',
        amount: 0.01,
        type: 'transfer',
        description: 'Test micro-transfer',
      });

    expect(res.status).toBe(428);
    expect(res.body.error).toBe('hitl_required');
  });

  test('Transfer with valid consentChallengeId: proceeds', async () => {
    const res = await agent
      .post('/api/transactions')
      .send({
        fromAccountId: 'acc-123',
        toAccountId: 'acc-456',
        amount: 100,
        type: 'transfer',
        description: 'Test transfer',
        consentChallengeId: 'challenge-xyz',
      });

    expect(res.status).not.toBe(428);
  });
});
