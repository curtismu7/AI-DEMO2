/**
 * @file authorize-gate.test.js
 * @description Regression tests for the PingOne Authorize gate in POST /api/transactions.
 *
 * The gate fires when:
 *   - authorizeEnabled is true  (runtime setting)
 *   - authorizePolicyId is a non-empty string  (runtime setting)
 *   - The user is NOT an admin
 *
 * The gate calls pingOneAuthorizeService.evaluateTransaction() and:
 *   - DENY  → 403 transaction_denied
 *   - PERMIT | INDETERMINATE → allowed through
 *   - Service error → fail-open (allowed through, warning logged)
 *
 * step-up MFA is disabled for all tests in this file to keep them focused.
 */

const request = require('supertest');

// ─── Mock auth before server load ─────────────────────────────────────────────
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
  requireNotAdmin: (_req, _res, next) => next(),
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
    requireSession: (req, res, next) => next(),
  hashPassword: (p) => p,
}));

// ─── Mock data store ──────────────────────────────────────────────────────────
jest.mock('../../data/store', () => ({
  getUserById: jest.fn((id) =>
    id === 'test-user-id'
      ? { id: 'test-user-id', firstName: 'Test', lastName: 'User', email: 'test@bank.com' }
      : null
  ),
  getAccountById: jest.fn((id) =>
    id === 'test-account-id'
      ? {
          id: 'test-account-id',
          userId: 'test-user-id',
          accountType: 'Checking',
          accountNumber: '****1234',
          balance: 10000,
        }
      : null
  ),
  createTransaction: jest.fn((data) => ({
    ...data,
    id: 'tx-' + Date.now(),
    createdAt: new Date().toISOString(),
    status: 'completed',
  })),
  updateAccountBalance: jest.fn(),
  applyTransfer: jest.fn(async () => ({ ok: true })),
  getAccountsByUserId: jest.fn(() => []),
  getTransactionsByUserId: jest.fn(() => []),
  getAllTransactions: jest.fn(() => []),
  getTransactionById: jest.fn(() => null),
}));

// ─── Mock configStore to prevent simulated mode from interfering ──────────────
jest.mock('../../services/configStore', () => {
  const lookup = (key) => {
    if (key === 'ff_authorize_simulated') return 'false';
    if (key === 'authorize_enabled') return null;
    if (key === 'authorize_policy_id') return null;
    if (key === 'authorize_decision_endpoint_id') return null;
    if (key === 'ff_authorize_deposits') return 'false';
    if (key === 'ff_authorize_fail_open') return 'true';
    return null;
  };
  return {
    get: jest.fn(lookup),
    getEffective: jest.fn(lookup),
    ensureInitialized: jest.fn().mockResolvedValue(undefined),
  };
});

// ─── Mock PingOne Authorize service ───────────────────────────────────────────
// Default decision is PERMIT. Tests can set global.__authorizeGateMockDecision
// to control the fallback when no mockResolvedValueOnce has been queued.
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn(() =>
    Promise.resolve({ decision: global.__authorizeGateMockDecision || 'PERMIT', raw: {} })
  ),
  evaluateMcpToolDelegation: jest.fn().mockResolvedValue({
    decision: 'PERMIT',
    stepUpRequired: false,
    raw: {},
    decisionId: null,
    path: 'decision-endpoint',
  }),
  isMcpDelegationDecisionReady: jest.fn(() => false),
}));

// ─── Mock consent challenge service ───────────────────────────────────────────
// Default: verifyAndConsumeChallenge succeeds. Tests override per-case.
jest.mock('../../services/transactionConsentChallenge', () => ({
  HIGH_VALUE_CONSENT_USD: 500,
  verifyAndConsumeChallenge: jest.fn(() => ({ ok: true })),
}));

const app = require('../../server');
const runtimeSettings = require('../../config/runtimeSettings');
const { evaluateTransaction } = require('../../services/pingOneAuthorizeService');
const { verifyAndConsumeChallenge } = require('../../services/transactionConsentChallenge');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const customerUser = (overrides = {}) =>
  JSON.stringify({
    id: 'test-user-id',
    username: 'customer',
    email: 'customer@bank.com',
    role: 'user',
    scopes: ['write', 'read'],
    acr: 'Multi_factor', // satisfy step-up gate so it doesn't interfere
    ...overrides,
  });

const adminUser = () =>
  JSON.stringify({
    id: 'admin-user-id',
    username: 'admin',
    email: 'admin@bank.com',
    role: 'admin',
    scopes: ['admin:read', 'write'],
    acr: 'Multi_factor',
  });

const withdrawalBody = {
  fromAccountId: 'test-account-id',
  amount: 500,
  type: 'withdrawal',
  description: 'Test withdrawal',
};

// ─── Settings management ──────────────────────────────────────────────────────
let originalSettings;

beforeAll(() => {
  originalSettings = runtimeSettings.getAll();
  // afterEach resets to this state before every test; no initial update needed
});

afterEach(() => {
  runtimeSettings.update({
    stepUpEnabled: false,
    authorizeEnabled: false,
    authorizePolicyId: '',
  }, 'test-cleanup');
  jest.clearAllMocks();
});

afterAll(() => {
  runtimeSettings.update({
    stepUpEnabled: originalSettings.stepUpEnabled,
    authorizeEnabled: originalSettings.authorizeEnabled,
    authorizePolicyId: originalSettings.authorizePolicyId,
  }, 'test-teardown');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PingOne Authorize Gate — POST /api/transactions', () => {
  // ── Gate disabled ─────────────────────────────────────────────────────────────
  // transactionAuthorizationService hardcodes AUTHORIZE_ENABLED=true; the gate is skipped
  // only when neither a policyId nor a decisionEndpointId is configured (PINGONE_READY=false)
  // and simulated mode is also off.
  describe('when authorizeEnabled is false', () => {
    it('should skip the gate and allow the transaction', async () => {
      // Leave authorizePolicyId empty so PINGONE_READY=false → gate skips (not_configured).
      runtimeSettings.update({ authorizeEnabled: false, authorizePolicyId: '' }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(res.status).not.toBe(403);
      expect(evaluateTransaction).not.toHaveBeenCalled();
    });
  });

  // ── Gate enabled but no policy ID ────────────────────────────────────────────
  describe('when authorizeEnabled but authorizePolicyId is empty', () => {
    it('should skip the gate and allow the transaction', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: '' }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(res.status).not.toBe(403);
      expect(evaluateTransaction).not.toHaveBeenCalled();
    });
  });

  // ── Policy returns PERMIT ─────────────────────────────────────────────────────
  describe('when policy decision is PERMIT', () => {
    it('should allow the transaction', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'PERMIT', raw: {} });

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(evaluateTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'test-policy-id',
          userId: 'test-user-id',
          amount: 500,
          type: 'withdrawal',
        })
      );
      expect(res.status).not.toBe(403);
    });
  });

  // ── Policy returns INDETERMINATE ──────────────────────────────────────────────
  describe('when policy decision is INDETERMINATE', () => {
    it('should allow the transaction (fail-open on ambiguity)', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'INDETERMINATE', raw: {} });

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(res.status).not.toBe(403);
    });
  });

  // ── Policy returns DENY ───────────────────────────────────────────────────────
  describe('when policy decision is DENY', () => {
    it('should return 403 transaction_denied', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'DENY', raw: { reason: 'high risk' } });

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('transaction_denied');
      expect(res.body.authorize_policy_id).toBe('test-policy-id');
    });

    it('should not create the transaction', async () => {
      const { createTransaction } = require('../../data/store');
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'DENY', raw: {} });

      await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(createTransaction).not.toHaveBeenCalled();
    });
  });

  // ── Service error → fail open ─────────────────────────────────────────────────
  describe('when the Authorize service throws an error', () => {
    it('should fail open and allow the transaction', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockRejectedValueOnce(new Error('PingOne Authorize unreachable'));

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      // Fail-open: error should NOT block the transaction
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(500);
    });
  });

  // ── Admin bypass ──────────────────────────────────────────────────────────────
  // The route blocks admin users with 403 'forbidden' before reaching the Authorize gate
  // (transactions must be initiated with a customer account). The Authorize gate is still
  // never called for admins — the intent of this test holds, but the HTTP status is 403.
  describe('when the user is an admin', () => {
    it('should never call the Authorize gate (admins are blocked before it)', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', adminUser())
        .send(withdrawalBody);

      expect(evaluateTransaction).not.toHaveBeenCalled();
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    });
  });

  // ── ACR passed through to Authorize ──────────────────────────────────────────
  describe('user ACR is forwarded to the Authorize policy', () => {
    it('should include acr in the evaluation context', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'PERMIT', raw: {} });

      await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: 'Multi_factor' }))
        .send(withdrawalBody);

      expect(evaluateTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ acr: 'Multi_factor' })
      );
    });
  });

  // ── Runtime toggle ────────────────────────────────────────────────────────────
  describe('runtime toggle takes effect immediately', () => {
    it('should deny when gate is enabled and policy returns DENY (toggledOn)', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'toggle-test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'DENY', raw: {} });

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(evaluateTransaction).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(403);
    });

    it('should allow when gate is disabled (toggledOff)', async () => {
      runtimeSettings.update({ authorizeEnabled: false, authorizePolicyId: '' }, 'toggle-test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(evaluateTransaction).not.toHaveBeenCalled();
      expect(res.status).toBe(201);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HITL / consent path via PingOne Authorize
// When PingOne returns consentRequired=true the gate must 428 and the route
// must verify+consume a consentChallengeId before proceeding.
// ─────────────────────────────────────────────────────────────────────────────
describe('PingOne Authorize Gate — HITL consent path', () => {
  beforeEach(() => {
    runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id', stepUpEnabled: false }, 'hitl-test-setup');
    jest.clearAllMocks();
  });

  it('returns 428 hitl_required when PingOne signals consentRequired', async () => {
    evaluateTransaction.mockResolvedValueOnce({ decision: 'PERMIT', consentRequired: true, raw: {} });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', customerUser())
      .send(withdrawalBody);

    expect(res.status).toBe(428);
    expect(res.body.error).toBe('hitl_required');
    expect(res.body.hitl.type).toBe('consent');
  });

  it('proceeds when consentRequired + valid consentChallengeId provided', async () => {
    evaluateTransaction.mockResolvedValueOnce({ decision: 'PERMIT', consentRequired: true, raw: {} });
    verifyAndConsumeChallenge.mockReturnValueOnce({ ok: true });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', customerUser())
      .send({ ...withdrawalBody, consentChallengeId: 'challenge-abc' });

    expect(res.status).not.toBe(428);
    expect(verifyAndConsumeChallenge).toHaveBeenCalledWith(
      expect.anything(),
      'challenge-abc',
      expect.objectContaining({ consentChallengeId: 'challenge-abc' })
    );
  });

  it('returns 403 when consentChallengeId is rejected by challenge service', async () => {
    evaluateTransaction.mockResolvedValueOnce({ decision: 'PERMIT', consentRequired: true, raw: {} });
    verifyAndConsumeChallenge.mockReturnValueOnce({
      ok: false,
      status: 403,
      json: { error: 'consent_already_used', error_description: 'Challenge already consumed.' },
    });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', customerUser())
      .send({ ...withdrawalBody, consentChallengeId: 'stale-challenge' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('consent_already_used');
  });

  it('returns 401 step_up_required (RFC 9470 challenge) when PingOne signals stepUpRequired', async () => {
    // ff_rfc9470_challenge defaults ON (see transactionAuthorizationService.js
    // buildStepUpBlock / commit cae8f0c55 "ship ff_rfc9470_challenge default ON").
    // The step-up block is now transported as 401 + WWW-Authenticate rather than
    // the legacy 428 JSON-only response; the JSON body shape is unchanged.
    evaluateTransaction.mockResolvedValueOnce({ decision: 'PERMIT', stepUpRequired: true, raw: {} });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', customerUser())
      .send(withdrawalBody);

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('insufficient_user_authentication');
    expect(res.body.error).toBe('step_up_required');
    expect(res.body.hitl.type).toBe('step_up');
  });

  it('step_up takes priority over consent when both are required (step-up-bypass fix, #605)', async () => {
    // Both engines check stepUpRequired before consentRequired: step-up is the
    // stronger gate and must not be bypassable by satisfying the weaker consent
    // flow when a transaction trips both thresholds. See PR #605 (step-up bypass)
    // and transactionAuthorizationService.js — the PingOne path was aligned with
    // the simulated path so step-up always wins.
    evaluateTransaction.mockResolvedValueOnce({ decision: 'PERMIT', stepUpRequired: true, consentRequired: true, raw: {} });

    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', customerUser())
      .send(withdrawalBody);

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('insufficient_user_authentication');
    expect(res.body.error).toBe('step_up_required');
    expect(res.body.hitl.type).toBe('step_up');
  });
});
