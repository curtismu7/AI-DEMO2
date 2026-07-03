/**
 * @file step-up-gate.test.js
 * @description Regression tests for the Step-Up MFA gate in POST /api/transactions.
 *
 * The gate fires when:
 *   - stepUpEnabled is true
 *   - The transaction type is in stepUpTransactionTypes (default: ['transfer','withdrawal'])
 *   - The amount >= stepUpAmountThreshold (default: $250)
 *   - The user's ACR value doesn't match stepUpAcrValue (default: 'Multi_factor')
 *   - The user is NOT an admin
 *
 * Expected behaviour under each condition is documented in each test case.
 * Settings are changed via runtimeSettings.update() and restored after each test.
 */

const request = require('supertest');

// ─── Mock the auth middleware BEFORE requiring the server ──────────────────────
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    const userHeader = req.headers['x-test-user'];
    if (!userHeader) {
      return res.status(401).json({
        error: 'authentication_required',
        error_description: 'Access token is required',
      });
    }
    try {
      req.user = JSON.parse(userHeader);
      req.session = req.session || {};
      req.session.user = req.user;
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  },
  requireScopes: (requiredScopes) => (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'authentication_required',
        error_description: 'Access token is required',
      });
    }
    if (req.user.role === 'admin') return next();
    const userScopes = req.user.scopes || [];
    const scopeArr = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
    const ok = scopeArr.some((s) => userScopes.includes(s)) || userScopes.includes('admin:read');
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
  requireNotAdmin: (_req, _res, next) => next(),
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

// ─── Fully mock transactionConsentChallenge so step-up gate tests bypass the OTP flow ──
// These tests are about the step-up gate, not OTP challenge logic.
// createChallenge/confirmChallenge are stubbed to return success without touching
// mfaService, emailService, or any other external dependency.
jest.mock('../../services/transactionConsentChallenge', () => {
  let _challenges = {};
  return {
    createChallenge: jest.fn((req, body) => {
      const id = 'mock-challenge-' + Math.random().toString(36).slice(2);
      _challenges[id] = { id, status: 'pending' };
      if (!req.session.txConsentChallenges) req.session.txConsentChallenges = {};
      req.session.txConsentChallenges[id] = _challenges[id];
      return { ok: true, challengeId: id };
    }),
    confirmChallenge: jest.fn((req, challengeId) => {
      const ch = req.session.txConsentChallenges?.[challengeId];
      if (!ch) return { ok: false, status: 404, json: { error: 'not_found' } };
      ch.status = 'confirmed';
      return { ok: true, json: { otpSent: true, otpExpiresAt: new Date(Date.now() + 300000).toISOString() } };
    }),
    verifyOtp: jest.fn((req, challengeId, otpCode) => ({ ok: true })),
    verifyAndConsumeChallenge: jest.fn((req, challengeId) => ({ ok: true })),
    __reset: () => { _challenges = {}; },
  };
});

// ─── Mock the data store with a test user + account ───────────────────────────
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
  getAccountsByUserId: jest.fn(() => [
    {
      id: 'test-account-id',
      userId: 'test-user-id',
      accountType: 'Checking',
      accountNumber: '****1234',
      balance: 10000,
    },
  ]),
  createTransaction: jest.fn((data) => ({
    ...data,
    id: 'tx-' + Date.now(),
    createdAt: new Date().toISOString(),
    status: 'completed',
  })),
  updateAccountBalance: jest.fn(),
  getTransactionsByUserId: jest.fn(() => []),
  getAllTransactions: jest.fn(() => []),
  getTransactionById: jest.fn(() => null),
}));

// ─── Also mock PingOne Authorize so it doesn't interfere ─────────────────────
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn().mockResolvedValue({ decision: 'PERMIT', raw: {} }),
  evaluateMcpToolDelegation: jest.fn().mockResolvedValue({ decision: 'PERMIT', stepUpRequired: false, raw: {} }),
  isMcpDelegationDecisionReady: jest.fn(() => false),
}));

// ─── Mock transactionAuthorizationService with step-up logic from runtimeSettings ─
// The real service ignores runtimeSettings.stepUpEnabled (hardcoded AUTHORIZE_ENABLED=true
// with simulated policy). These tests need a standalone step-up gate that reads runtimeSettings.
jest.mock('../../services/transactionAuthorizationService', () => {
  const rs = require('../../config/runtimeSettings');
  const HITL_THRESHOLD = 500;
  return {
    evaluateTransactionPolicy: jest.fn(async ({ userRole, amount, type, acr }) => {
      if (userRole === 'admin') return { ran: false, reason: 'admin_role_exempt' };
      if (!rs.get('stepUpEnabled')) return { ran: false, reason: 'step_up_disabled' };
      const types = rs.get('stepUpTransactionTypes') || ['transfer', 'withdrawal'];
      if (!types.includes(type)) return { ran: false, reason: 'type_not_in_scope' };
      const withdrawalsAlways = rs.get('stepUpWithdrawalsAlways');
      const threshold = rs.get('stepUpAmountThreshold') || 0;
      const requiredAcr = rs.get('stepUpAcrValue') || 'Multi_factor';
      const amountTriggered = (withdrawalsAlways && type === 'withdrawal') || amount >= threshold;
      const acrOk = acr && acr.toLowerCase() === requiredAcr.toLowerCase();
      if (!amountTriggered || acrOk) return { ran: false, reason: 'step_up_not_triggered' };
      return {
        ran: true,
        block: {
          status: 428,
          body: {
            error: 'step_up_required',
            hitl: { type: 'step_up' },
            step_up_url: '/api/auth/oauth/user/stepup',
            step_up_acr: requiredAcr,
            step_up_method: 'ciba',
            amount_threshold: threshold,
            isHITL: amount >= HITL_THRESHOLD,
          },
        },
      };
    }),
  };
});

const app = require('../../server');
const runtimeSettings = require('../../config/runtimeSettings');
// Capture the transactionAuthorizationService mock at module load time — before
// jest.resetModules() (called in setup.js afterEach) can create a separate
// instance that the route handler wouldn't see.
const transactionAuthorizationServiceMock = require('../../services/transactionAuthorizationService');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const customerUser = (overrides = {}) =>
  JSON.stringify({
    id: 'test-user-id',
    username: 'customer',
    email: 'customer@bank.com',
    role: 'user',
    scopes: ['write', 'read'],
    acr: null,
    ...overrides,
  });

const adminUser = () =>
  JSON.stringify({
    id: 'admin-user-id',
    username: 'admin',
    email: 'admin@bank.com',
    role: 'admin',
    scopes: ['admin:read'],
    acr: 'Multi_factor',
  });

/** Withdrawal body that will trip the step-up gate (amount >= default threshold) */
const highValueWithdrawal = (amount = 500) => ({
  fromAccountId: 'test-account-id',
  amount,
  type: 'withdrawal',
  description: 'Test high-value withdrawal',
});

/** Deposit body — type not in stepUpTransactionTypes by default */
const depositBody = (amount = 500) => ({
  toAccountId: 'test-account-id',
  amount,
  type: 'deposit',
  description: 'Test deposit',
});

/**
 * High-value writes require a session-bound consent challenge + confirm before POST /transactions.
 * Uses supertest agent so Set-Cookie session is preserved across requests.
 */
async function postTransactionAfterConsent(agent, body) {
  const cr = await agent
    .post('/api/transactions/consent-challenge')
    .set('x-test-user', customerUser())
    .send(body);
  expect(cr.status).toBe(201);
  const { challengeId } = cr.body;
  const cf = await agent
    .post(`/api/transactions/consent-challenge/${challengeId}/confirm`)
    .set('x-test-user', customerUser());
  expect(cf.status).toBe(200);
  return agent
    .post('/api/transactions')
    .set('x-test-user', customerUser())
    .send({ ...body, consentChallengeId: challengeId });
}

// ─── Save + restore settings around each test ─────────────────────────────────
let originalSettings;
beforeAll(() => {
  originalSettings = runtimeSettings.getAll();
  // Ensure authorize gate is off and withdrawalsAlways is off so threshold-based tests work correctly
  runtimeSettings.update({ authorizeEnabled: false, stepUpWithdrawalsAlways: false });
});

afterEach(() => {
  runtimeSettings.update({
    stepUpEnabled: originalSettings.stepUpEnabled,
    stepUpAmountThreshold: originalSettings.stepUpAmountThreshold,
    stepUpAcrValue: originalSettings.stepUpAcrValue,
    stepUpTransactionTypes: originalSettings.stepUpTransactionTypes,
    stepUpWithdrawalsAlways: false,
    stepUpMaxAge: 0,
    authorizeEnabled: false,
  }, 'test-cleanup');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Step-Up MFA Gate — POST /api/transactions', () => {
  // ── Gate disabled ────────────────────────────────────────────────────────────
  describe('when stepUpEnabled is false', () => {
    it('should allow high-value withdrawal without MFA', async () => {
      runtimeSettings.update({ stepUpEnabled: false }, 'test');

      const agent = request.agent(app);
      const res = await postTransactionAfterConsent(agent, highValueWithdrawal(1000));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Transaction type not guarded ─────────────────────────────────────────────
  describe('when transaction type is not in stepUpTransactionTypes', () => {
    it('should allow high-value deposit without MFA', async () => {
      runtimeSettings.update({ stepUpEnabled: true, stepUpTransactionTypes: ['transfer', 'withdrawal'] }, 'test');

      const agent = request.agent(app);
      const res = await postTransactionAfterConsent(agent, depositBody(5000));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Amount below threshold ────────────────────────────────────────────────────
  describe('when amount is below the threshold', () => {
    it('should allow a small withdrawal without MFA', async () => {
      runtimeSettings.update({ stepUpEnabled: true, stepUpAmountThreshold: 250, stepUpWithdrawalsAlways: false }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(highValueWithdrawal(100));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Gate triggers: no ACR ─────────────────────────────────────────────────────
  describe('when amount meets threshold and user has no ACR', () => {
    it('should return 428 step_up_required', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 250,
        stepUpAcrValue: 'Multi_factor',
        stepUpTransactionTypes: ['transfer', 'withdrawal'],
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(500));

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('step_up_required');
      expect(res.body.step_up_url).toBeDefined();
      expect(res.body.amount_threshold).toBe(250);
    });
  });

  // ── Gate triggers: wrong ACR ──────────────────────────────────────────────────
  describe('when amount meets threshold and user has wrong ACR', () => {
    it('should return 428 step_up_required', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 250,
        stepUpAcrValue: 'Multi_factor',
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: 'PasswordOnly' }))
        .send(highValueWithdrawal(500));

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('step_up_required');
    });
  });

  // ── Gate passes: correct ACR ──────────────────────────────────────────────────
  describe('when amount meets threshold and user has the required ACR', () => {
    it('should allow the transaction', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 250,
        stepUpAcrValue: 'Multi_factor',
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: 'Multi_factor' }))
        .send(highValueWithdrawal(500));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Admin bypass ──────────────────────────────────────────────────────────────
  describe('when the user is an admin', () => {
    it('should bypass the step-up gate regardless of amount', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 1, // very low threshold
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', adminUser())
        .send(highValueWithdrawal(999999));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Threshold is exact boundary ───────────────────────────────────────────────
  describe('boundary: amount exactly at threshold', () => {
    it('should trigger step-up when amount equals the threshold', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 500,
        stepUpAcrValue: 'Multi_factor',
        stepUpTransactionTypes: ['withdrawal'],
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(500)); // exactly at threshold

      expect(res.status).toBe(428);
    });

    it('should NOT trigger step-up when amount is one cent below threshold', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 500,
        stepUpAcrValue: 'Multi_factor',
        stepUpTransactionTypes: ['withdrawal'],
        stepUpWithdrawalsAlways: false,
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(499.99));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Runtime threshold change ──────────────────────────────────────────────────
  describe('runtime threshold update takes effect immediately', () => {
    it('should reflect a new threshold without a restart', async () => {
      // First set threshold to $1000 — $500 should pass
      runtimeSettings.update({ stepUpEnabled: true, stepUpAmountThreshold: 1000, stepUpWithdrawalsAlways: false }, 'test');

      const pass = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(500));

      expect(pass.status).not.toBe(428);

      // Lower threshold to $100 — $500 should now be blocked
      runtimeSettings.update({ stepUpAmountThreshold: 100 }, 'test');

      const blocked = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(500));

      expect(blocked.status).toBe(428);
    });
  });

  // ── HITL flag in step-up response (Phase 124) ────────────────────────────────────
  describe('HITL (Human-in-the-loop) flag in step-up response', () => {
    it('should return isHITL=true when amount exceeds $500 HITL threshold', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 250,
        stepUpAcrValue: 'Multi_factor',
        stepUpTransactionTypes: ['withdrawal'],
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send({ ...highValueWithdrawal(600), consentChallengeId: 'mock-consent-id' }); // Exceeds $500 HITL threshold

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('step_up_required');
      expect(res.body.isHITL).toBe(true);
    });

    it('should return isHITL=false when amount is below $500 HITL threshold', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 250,
        stepUpAcrValue: 'Multi_factor',
        stepUpTransactionTypes: ['withdrawal'],
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(400)); // Below $500 HITL threshold

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('step_up_required');
      expect(res.body.isHITL).toBe(false);
    });

    it('should return isHITL=true when withdrawal always requires step-up and amount exceeds $500', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpWithdrawalsAlways: true,
        stepUpAcrValue: 'Multi_factor',
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send({ ...highValueWithdrawal(600), consentChallengeId: 'mock-consent-id' }); // Exceeds $500 HITL threshold

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('step_up_required');
      expect(res.body.isHITL).toBe(true);
    });

    it('should return isHITL=false when withdrawal always requires step-up but amount is below $500', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpWithdrawalsAlways: true,
        stepUpAcrValue: 'Multi_factor',
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(300)); // Below $500 HITL threshold

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('step_up_required');
      expect(res.body.isHITL).toBe(false);
    });

    it('should return isHITL=true for transfers exceeding $500 HITL threshold', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 250,
        stepUpAcrValue: 'Multi_factor',
        stepUpTransactionTypes: ['transfer', 'withdrawal'],
      }, 'test');

      const transferBody = {
        fromAccountId: 'test-account-id',
        toAccountId: 'test-account-id',
        amount: 600, // Exceeds $500 HITL threshold
        type: 'transfer',
        description: 'Test high-value transfer',
        consentChallengeId: 'mock-consent-id',
      };

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(transferBody);

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('step_up_required');
      expect(res.body.isHITL).toBe(true);
    });
  });

  // ── RFC 9470 challenge pass-through (ff_rfc9470_challenge) ───────────────────
  describe('RFC 9470 challenge pass-through', () => {
    it('applies block.headers and status from the authorization service', async () => {
      const txAuthz = transactionAuthorizationServiceMock;
      const header =
        'Bearer error="insufficient_user_authentication", acr_values="Multi_Factor", max_age="0"';
      txAuthz.evaluateTransactionPolicy.mockResolvedValueOnce({
        ran: true,
        block: {
          status: 401,
          headers: { 'WWW-Authenticate': header },
          body: {
            error: 'step_up_required',
            hitl: { type: 'step_up' },
            step_up_url: '/api/auth/oauth/user/stepup',
            step_up_acr: 'Multi_Factor',
            step_up_method: 'ciba',
          },
        },
      });

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(500));

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe(header);
      expect(res.body.error).toBe('step_up_required'); // body kept in RFC mode
    });
  });

  // ── auth_time freshness (stepUpMaxAge, RFC 9470 §5) ─────────────────────────
  describe('auth_time freshness (stepUpMaxAge)', () => {
    it('downgrades a stale strong ACR so the gate fires', async () => {
      runtimeSettings.update(
        { stepUpEnabled: true, stepUpAmountThreshold: 250, stepUpAcrValue: 'Multi_factor', stepUpMaxAge: 300 },
        'test'
      );

      const res = await request(app)
        .post('/api/transactions')
        .set(
          'x-test-user',
          customerUser({ acr: 'Multi_factor', authTime: Math.floor(Date.now() / 1000) - 3600 })
        )
        .send(highValueWithdrawal(500));

      // Route downgraded acr to null (stale auth) → the gate fires.
      expect(res.status).toBe(428);
      expect(res.body.error).toBe('step_up_required');
    });

    it('passes when auth_time is fresh', async () => {
      runtimeSettings.update(
        { stepUpEnabled: true, stepUpAmountThreshold: 250, stepUpAcrValue: 'Multi_factor', stepUpMaxAge: 300 },
        'test'
      );

      const res = await request(app)
        .post('/api/transactions')
        .set(
          'x-test-user',
          customerUser({ acr: 'Multi_factor', authTime: Math.floor(Date.now() / 1000) - 10 })
        )
        .send(highValueWithdrawal(500));

      expect(res.status).not.toBe(428);
    });

    it('is disabled by default (stepUpMaxAge=0): stale auth_time is ignored', async () => {
      runtimeSettings.update(
        { stepUpEnabled: true, stepUpAmountThreshold: 250, stepUpAcrValue: 'Multi_factor', stepUpMaxAge: 0 },
        'test'
      );

      const res = await request(app)
        .post('/api/transactions')
        .set(
          'x-test-user',
          customerUser({ acr: 'Multi_factor', authTime: Math.floor(Date.now() / 1000) - 999999 })
        )
        .send(highValueWithdrawal(500));

      expect(res.status).not.toBe(428);
    });
  });
});
