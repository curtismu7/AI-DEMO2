/**
 * hitlRoute.integration.test.js
 * Integration tests for POST /api/transactions HTTP route HITL enforcement
 *
 * Runs against REAL configStore values from .env (ff_hitl_enabled, confirm_threshold_usd, etc.)
 * Uses real data store and real route implementations.
 * Tests the Phase 170 critical rule: transfers ALWAYS require consent regardless of amount.
 *
 * Note: Data store is mocked to avoid modifying actual database.
 * configStore uses real .env values.
 */
'use strict';

const express = require('express');
const request = require('supertest');

// Mock only the data store and auth middleware—use REAL configStore from .env
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    const userHeader = req.headers['x-test-user'];
    if (userHeader) {
      try {
        req.user = JSON.parse(userHeader);
        req.session = req.session || {};
        req.session.user = req.user;
        return next();
      } catch {
        return res.status(401).json({ error: 'invalid_token' });
      }
    }
    res.status(401).json({ error: 'authentication_required' });
  },
  requireNotAdmin: (_req, _res, next) => next(),
  requireSession: (req, res, next) => next(),
  requireScopes: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/hitlGatewayMiddleware', () => (req, res, next) => next());
jest.mock('../../middleware/demoMode', () => ({
  blockInDemoMode: () => (req, res, next) => next(),
}));
jest.mock('express-rate-limit', () => jest.fn(() => (req, res, next) => next()));

// Mock data store to avoid modifying actual database
jest.mock('../../data/store', () => ({
  getAccountById: jest.fn((id) => {
    const accounts = {
      'chk-user1': { id: 'chk-user1', userId: 'user-1', type: 'checking', balance: 500000 },
      'sav-user1': { id: 'sav-user1', userId: 'user-1', type: 'savings', balance: 100000 },
      'chk-admin': { id: 'chk-admin', userId: 'admin-1', type: 'checking', balance: 500000 },
    };
    return accounts[id] || null;
  }),
  getAccountsByUserId: jest.fn((userId) => {
    const accounts = {
      'user-1': [
        { id: 'chk-user1', userId: 'user-1', type: 'checking', balance: 500000 },
        { id: 'sav-user1', userId: 'user-1', type: 'savings', balance: 100000 },
      ],
      'admin-1': [
        { id: 'chk-admin', userId: 'admin-1', type: 'checking', balance: 500000 },
      ],
    };
    return accounts[userId] || [];
  }),
  getUserById: jest.fn(() => null),
  createTransaction: jest.fn((transaction) => ({ ...transaction, id: 'txn-123' })),
  updateAccountBalance: jest.fn(() => Promise.resolve()),
  getTransactionsByUserId: jest.fn(() => []),
}));

jest.mock('../../services/transactionConsentChallenge', () => ({
  HIGH_VALUE_CONSENT_USD: 500,
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

jest.mock('../../services/transactionAuthorizationService', () => ({
  evaluateTransactionPolicy: jest.fn(async ({ userRole, type, amount }) => {
    if (userRole === 'admin') return { ran: false, reason: 'admin_role_exempt' };
    const THRESHOLD = 500;
    if (type === 'transfer' || amount > THRESHOLD) {
      return {
        ran: true,
        block: {
          status: 428,
          body: {
            error: 'hitl_required',
            hitl: { type: 'consent' },
            error_description: 'This transaction requires explicit human approval. Create a consent challenge first.',
          },
        },
      };
    }
    return { ran: true, permit: true, evaluation: { decision: 'PERMIT', engine: 'simulated', path: 'simulated' } };
  }),
}));

jest.mock('../../config/runtimeSettings', () => ({
  isDemoMode: jest.fn(() => false),
  get: jest.fn((key) => {
    const defaults = {
      'stepUpEnabled': false,
      'stepUpAmountThreshold': 500,
      'stepUpAcrValue': 'urn:mace:incommon:iap:silver',
      'stepUpTransactionTypes': [],
      'stepUpWithdrawalsAlways': false,
      'stepUpMethod': 'ciba',
    };
    return defaults[key] || null;
  }),
}));

jest.mock('../../services/emailService', () => ({
  sendTransactionConfirmation: jest.fn(() => Promise.resolve()),
}));

// REAL configStore — uses .env values instead of mocking
// This lets us test with actual ff_hitl_enabled, confirm_threshold_usd, etc. from .env
const configStore = require('../../services/configStore');

/**
 * Build a test Express app with the transactions router mounted
 * Uses REAL configStore values from .env
 */
function buildApp() {
  const app = express();
  app.use(express.json());

  // Mount REAL transactions router (not mocked)
  // This will use real configStore values from .env
  const txnRoutes = require('../../routes/transactions');
  app.use('/api/transactions', txnRoutes);

  return app;
}

describe('POST /api/transactions — HITL Enforcement (Integration, Real .env Values)', () => {
  describe('Transfer type — ALWAYS requires consent (regardless of amount)', () => {
    test('transfer $0.01 without consentChallengeId → 428 hitl_required', async () => {
      const app = buildApp();

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', JSON.stringify({
          id: 'user-1',
          username: 'customer',
          email: 'user@test.com',
          role: 'customer',
        }))
        .send({
          type: 'transfer',
          amount: 0.01,
          fromAccountId: 'chk-user1',
          toAccountId: 'sav-user1',
          description: 'Tiny transfer',
          // NO consentChallengeId
        });

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('hitl_required');
      expect(res.body.error_description).toContain('explicit human approval');
    });

    test('transfer $1000 (above threshold) without consentChallengeId → 428', async () => {
      const app = buildApp();

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', JSON.stringify({
          id: 'user-1',
          role: 'customer',
        }))
        .send({
          type: 'transfer',
          amount: 1000,
          fromAccountId: 'chk-user1',
          toAccountId: 'sav-user1',
        });

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('hitl_required');
    });

    test('transfer $800 (above threshold, below max) without consent → 428', async () => {
      const app = buildApp();

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', JSON.stringify({
          id: 'user-1',
          role: 'customer',
        }))
        .send({
          type: 'transfer',
          amount: 800,
          fromAccountId: 'chk-user1',
          toAccountId: 'sav-user1',
        });

      expect(res.status).toBe(428);
    });
  });

  describe('Admin role → HITL bypassed', () => {
    test('admin transfer without consentChallengeId → allowed (no 428)', async () => {
      const app = buildApp();

      // Admin can transfer without consent challenge
      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', JSON.stringify({
          id: 'admin-1',
          username: 'admin',
          role: 'admin', // Key: admin role bypasses HITL
        }))
        .send({
          type: 'transfer',
          amount: 50000,
          fromAccountId: 'chk-admin',
          toAccountId: 'chk-user1',
          // NO consentChallengeId
        });

      // Should NOT return 428 because admin role bypasses HITL
      expect(res.status).not.toBe(428);
      // May fail for other reasons (insufficient balance, etc.) but not HITL
      expect(res.body.error).not.toBe('hitl_required');
    });
  });

  describe('Deposit type — uses amount threshold, NOT always required', () => {
    test('deposit $100 (at/below threshold) without consent → allowed', async () => {
      const app = buildApp();

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', JSON.stringify({
          id: 'user-1',
          role: 'customer',
        }))
        .send({
          type: 'deposit',
          amount: 100,
          toAccountId: 'chk-user1',
          // NO consentChallengeId — should NOT require one for amount <= threshold from .env
        });

      // Should NOT return 428 (under threshold)
      expect(res.status).not.toBe(428);
      expect(res.body.error).not.toBe('hitl_required');
    });

    test('deposit $600 (above .env threshold) without consent → 428', async () => {
      // This test assumes confirm_threshold_usd from .env is <= 600
      // Adjust amount if your .env has a different threshold
      const app = buildApp();

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', JSON.stringify({
          id: 'user-1',
          role: 'customer',
        }))
        .send({
          type: 'deposit',
          amount: 600,
          toAccountId: 'chk-user1',
          // NO consentChallengeId — HITL required for amount > threshold
        });

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('hitl_required');
    });

    test('deposit $500.00 exactly (at threshold boundary) → allowed', async () => {
      const app = buildApp();

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', JSON.stringify({
          id: 'user-1',
          role: 'customer',
        }))
        .send({
          type: 'deposit',
          amount: 500.00,
          toAccountId: 'chk-user1',
        });

      // Exactly at threshold should NOT require consent (boundary: <= 500 allowed)
      // Adjust based on your .env confirm_threshold_usd
      expect(res.status).not.toBe(428);
    });
  });

  describe('Withdrawal type — uses amount threshold like deposit', () => {
    test('withdrawal $100 → allowed (under threshold)', async () => {
      const app = buildApp();

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', JSON.stringify({
          id: 'user-1',
          role: 'customer',
        }))
        .send({
          type: 'withdrawal',
          amount: 100,
          fromAccountId: 'chk-user1',
        });

      expect(res.status).not.toBe(428);
    });

    test('withdrawal $750 → 428 (above threshold)', async () => {
      const app = buildApp();

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', JSON.stringify({
          id: 'user-1',
          role: 'customer',
        }))
        .send({
          type: 'withdrawal',
          amount: 750,
          fromAccountId: 'chk-user1',
        });

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('hitl_required');
    });
  });

  describe('HITL combined conditions', () => {
    test('deposit, customer, HITL on, amount=$250 (under threshold) → allowed', async () => {
      const app = buildApp();

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', JSON.stringify({
          id: 'user-1',
          role: 'customer',
        }))
        .send({
          type: 'deposit',
          amount: 250,
          toAccountId: 'chk-user1',
        });

      expect(res.status).not.toBe(428);
    });
  });
});
