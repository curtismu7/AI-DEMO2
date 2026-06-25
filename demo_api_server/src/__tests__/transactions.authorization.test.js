/**
 * @file transactions.authorization.test.js
 * Regression tests for the authorization gate in POST /api/transactions.
 *
 * Bugs caught:
 *   1. $600 transfer bypassed all HITL when ff_hitl_enabled=false.
 *      Root cause: transactionAuthorizationService checked r.consentRequired before
 *      r.stepUpRequired, so a $600 transaction (>= both $250 confirm and $500 step-up
 *      thresholds) returned a hitl_required block. The route's ff_hitl_enabled=false
 *      bypass then let the transaction through without any step-up challenge.
 *      Fix: check r.stepUpRequired first so the stronger security gate is enforced.
 *
 *   2. Successful transfers and withdrawals did not call saveTransactionSnapshot, so
 *      a cold Lambda serving GET /my restored from a stale Redis snapshot and the new
 *      transaction was absent.
 *      Fix: call saveTransactionSnapshot() after every successful write transaction.
 *
 * Strategy:
 *   - transactionAuthorizationService is mocked so each test controls the decision.
 *   - configStore.getEffective is reset in beforeEach with safe defaults, overridden
 *     per-test where needed.
 *   - demoScenarioStore.save is a spy — checked to confirm snapshot persistence.
 */

'use strict';

const request = require('supertest');

// ── Mocks ─────────────────────────────────────────────────────────────────────

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
  requireAdmin: (req, res, next) => next(),
  requireNotAdmin: (_req, _res, next) => next(),
  hasRequiredScopes: () => true,
  parseTokenScopes: () => [],
  requireAIAgent: (_req, _res, next) => next(),
  requireOwnershipOrAdmin: (_req, _res, next) => next(),
  requireSession: (req, res, next) => next(),
  hashPassword: (p) => p,
}));

// Two accounts owned by user-1: savings (from) and checking (to)
jest.mock('../../data/store', () => ({
  getUserById: jest.fn((id) =>
    id === 'user-1'
      ? { id: 'user-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@bank.com' }
      : null,
  ),
  getAccountById: jest.fn((id) => {
    if (id === 'savings-1')
      return { id: 'savings-1', userId: 'user-1', accountType: 'savings', accountNumber: 'S001', balance: 5000 };
    if (id === 'checking-1')
      return { id: 'checking-1', userId: 'user-1', accountType: 'checking', accountNumber: 'C001', balance: 2000 };
    return null;
  }),
  getAccountsByUserId: jest.fn((uid) =>
    uid === 'user-1'
      ? [
          { id: 'savings-1', userId: 'user-1', accountType: 'savings', accountNumber: 'S001', balance: 5000 },
          { id: 'checking-1', userId: 'user-1', accountType: 'checking', accountNumber: 'C001', balance: 2000 },
        ]
      : [],
  ),
  getTransactionById: jest.fn(() => null),
  getTransactionsByUserId: jest.fn(() => []),
  getAllTransactions: jest.fn(() => []),
  createTransaction: jest.fn((data) => ({ ...data, id: 'tx-new', createdAt: new Date().toISOString() })),
  updateAccountBalance: jest.fn(),
  applyTransfer: jest.fn(async () => ({ ok: true })),
  updateTransaction: jest.fn(),
  deleteTransaction: jest.fn(),
  getAllUsers: jest.fn(() => []),
}));

jest.mock('../../services/transactionAuthorizationService', () => ({
  evaluateTransactionPolicy: jest.fn(),
  getAuthorizationStatusSummary: jest.fn(() => ({ activeEngine: 'simulated' })),
}));

jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(),
  setConfig: jest.fn().mockResolvedValue(undefined),
  isReadOnly: jest.fn(() => false),
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
  isConfigured: jest.fn(() => false),
  FIELD_DEFS: {},
  SECRET_KEYS: [],
  validateTwoExchangeConfig: jest.fn(() => ({ valid: false, missing: [] })),
  buildAllowedScopesByAudience: jest.fn(() => ({})),
}));

jest.mock('../../services/demoScenarioStore', () => ({
  load: jest.fn(async () => ({ accountSnapshot: [], transactionSnapshot: [] })),
  save: jest.fn(async () => {}),
}));

jest.mock('../../middleware/demoMode', () => ({
  blockInDemoMode: () => (req, res, next) => next(),
}));

jest.mock('../../services/transactionConsentChallenge', () => ({
  createChallenge: jest.fn(),
  confirmChallenge: jest.fn(),
  verifyOtp: jest.fn(),
  verifyMfa: jest.fn(),
  selectMfaDevice: jest.fn(),
  getChallenge: jest.fn(),
  verifyAndConsumeChallenge: jest.fn(() => ({ ok: true, challengeId: 'ch-1' })),
}));

jest.mock('../../services/emailService', () => ({
  sendTransactionConfirmation: jest.fn(),
}));

jest.mock('../../services/posthog', () => ({ capture: jest.fn() }));

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
  EVENT_CATEGORIES: { AUTHORIZE: 'authorize', HITL: 'hitl', THRESHOLD: 'threshold' },
}));

// ── Module-level references (stable across jest.resetModules() in setup.js) ───

const app = require('../../server');
const { evaluateTransactionPolicy } = require('../../services/transactionAuthorizationService');
const configStore = require('../../services/configStore');
const demoScenarioStore = require('../../services/demoScenarioStore');

// ── Helpers ───────────────────────────────────────────────────────────────────

const userToken = () =>
  JSON.stringify({ id: 'user-1', role: 'user', scopes: ['write', 'read'] });

const TRANSFER_600 = {
  fromAccountId: 'savings-1',
  toAccountId: 'checking-1',
  amount: 600,
  type: 'transfer',
  description: 'Transfer savings to checking',
};

const TRANSFER_300 = {
  fromAccountId: 'savings-1',
  toAccountId: 'checking-1',
  amount: 300,
  type: 'transfer',
  description: 'Mid-range transfer',
};

const WITHDRAWAL_100 = {
  fromAccountId: 'savings-1',
  amount: 100,
  type: 'withdrawal',
  description: 'ATM withdrawal',
};

// ── beforeEach: reset mock implementations to safe defaults ───────────────────

beforeEach(() => {
  evaluateTransactionPolicy.mockReset();
  configStore.get.mockReset();
  configStore.getEffective.mockReset();
  demoScenarioStore.save.mockReset();
  demoScenarioStore.load.mockReset();

  // Default: authorization not triggered (simulates type not in scope)
  evaluateTransactionPolicy.mockResolvedValue({ ran: false, reason: 'type_not_in_scope' });

  // Default config: HITL enabled, max $10k
  configStore.getEffective.mockImplementation((key) => {
    if (key === 'ff_hitl_enabled') return 'true';
    if (key === 'max_transaction_amount') return '10000';
    return null;
  });
  configStore.get.mockReturnValue(null);

  demoScenarioStore.load.mockResolvedValue({ accountSnapshot: [], transactionSnapshot: [] });
  demoScenarioStore.save.mockResolvedValue(undefined);
});

// ── step_up_required — always enforced regardless of ff_hitl_enabled ──────────

describe('POST /api/transactions — step_up_required block', () => {
  it('returns 428 step_up_required when authorization requires step-up', async () => {
    evaluateTransactionPolicy.mockResolvedValue({
      ran: true,
      block: { status: 428, body: { error: 'step_up_required', hitl: { type: 'step_up' } } },
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', userToken())
      .send(TRANSFER_600);

    expect(res.status).toBe(428);
    expect(res.body.error).toBe('step_up_required');
  });

  it('step_up_required is enforced even when ff_hitl_enabled=false', async () => {
    // Regression: a $600 transfer (>= $500 step-up threshold) was returning
    // hitl_required because transactionAuthorizationService checked consentRequired
    // first. The ff_hitl_enabled=false bypass then let the transaction through.
    evaluateTransactionPolicy.mockResolvedValue({
      ran: true,
      block: { status: 428, body: { error: 'step_up_required', hitl: { type: 'step_up' } } },
    });

    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ff_hitl_enabled') return 'false';
      if (key === 'max_transaction_amount') return '10000';
      return null;
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', userToken())
      .send(TRANSFER_600);

    expect(res.status).toBe(428);
    expect(res.body.error).toBe('step_up_required');
  });
});

// ── hitl_required — enforced when ff_hitl_enabled=true, bypassed when false ───

describe('POST /api/transactions — hitl_required block', () => {
  it('returns 428 hitl_required when ff_hitl_enabled=true and no challengeId', async () => {
    evaluateTransactionPolicy.mockResolvedValue({
      ran: true,
      block: { status: 428, body: { error: 'hitl_required', hitl: { type: 'consent' } } },
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', userToken())
      .send(TRANSFER_300);

    expect(res.status).toBe(428);
    expect(res.body.error).toBe('hitl_required');
    expect(res.body.hitl.type).toBe('consent');
  });

  it('returns 201 when ff_hitl_enabled=false (consent enforcement disabled by flag)', async () => {
    // This is correct product behavior: the feature flag intentionally bypasses
    // consent-only HITL (e.g., during development or when step-up is the sole guard).
    evaluateTransactionPolicy.mockResolvedValue({
      ran: true,
      block: { status: 428, body: { error: 'hitl_required', hitl: { type: 'consent' } } },
    });

    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ff_hitl_enabled') return 'false';
      if (key === 'max_transaction_amount') return '10000';
      return null;
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', userToken())
      .send(TRANSFER_300);

    expect(res.status).toBe(201);
  });

  it('returns 201 when consentChallengeId is provided and verifyAndConsumeChallenge succeeds', async () => {
    evaluateTransactionPolicy.mockResolvedValue({
      ran: true,
      block: { status: 428, body: { error: 'hitl_required', hitl: { type: 'consent' } } },
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', userToken())
      .send({ ...TRANSFER_300, consentChallengeId: 'ch-1' });

    expect(res.status).toBe(201);
  });
});

// ── Snapshot persistence — saveTransactionSnapshot called after every write ───

describe('POST /api/transactions — snapshot persistence after successful write', () => {
  it('calls demoScenarioStore.save after a successful transfer', async () => {
    // Regression: saveTransactionSnapshot was never called after a successful POST,
    // so GET /my on a cold Lambda would restore the stale snapshot and miss the new tx.
    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', userToken())
      .send(TRANSFER_600);

    expect(res.status).toBe(201);
    expect(demoScenarioStore.save).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ transactionSnapshot: expect.any(Array) }),
    );
  });

  it('calls demoScenarioStore.save after a successful withdrawal', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', userToken())
      .send(WITHDRAWAL_100);

    expect(res.status).toBe(201);
    expect(demoScenarioStore.save).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ transactionSnapshot: expect.any(Array) }),
    );
  });

  it('does NOT call demoScenarioStore.save when authorization blocks the transaction', async () => {
    evaluateTransactionPolicy.mockResolvedValue({
      ran: true,
      block: { status: 428, body: { error: 'step_up_required', hitl: { type: 'step_up' } } },
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', userToken())
      .send(TRANSFER_600);

    expect(res.status).toBe(428);
    expect(demoScenarioStore.save).not.toHaveBeenCalled();
  });
});

// ── transaction_denied — 403 when policy denies ───────────────────────────────

describe('POST /api/transactions — transaction_denied', () => {
  it('returns 403 transaction_denied when authorization denies', async () => {
    evaluateTransactionPolicy.mockResolvedValue({
      ran: true,
      block: { status: 403, body: { error: 'transaction_denied' } },
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', userToken())
      .send({ fromAccountId: 'savings-1', amount: 2001, type: 'withdrawal', description: 'over limit' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('transaction_denied');
  });
});
