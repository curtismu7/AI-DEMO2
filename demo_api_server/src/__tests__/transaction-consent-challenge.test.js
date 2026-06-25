/**
 * @file transaction-consent-challenge.test.js
 * Session-bound HITL consent challenges for amounts > $500.
 *
 * OTP flow (after Phase 2 email-OTP addition):
 *   1. POST /consent-challenge             → creates challenge
 *   2. POST /consent-challenge/:id/confirm → sends OTP (mocked), returns { otpSent, otpExpiresAt }
 *   3. POST /consent-challenge/:id/verify-otp { otpCode } → verifies code
 *   4. POST /transactions { consentChallengeId } → executes transaction
 *
 * emailService is mocked so no real PingOne calls are made.
 * The OTP code is extracted from the challenge via the __getLastOtp test helper.
 */
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    const userHeader = req.headers['x-test-user'];
    if (!userHeader) {
      return res.status(401).json({ error: 'authentication_required' });
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

jest.mock('../../data/store', () => ({
  getUserById: jest.fn((id) =>
    id === 'test-user-id'
      ? { id: 'test-user-id', firstName: 'Test', lastName: 'User', email: 'test@bank.com' }
      : null,
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
      : null,
  ),
  createTransaction: jest.fn((data) => ({
    ...data,
    id: 'tx-' + Date.now(),
    createdAt: new Date().toISOString(),
    status: 'completed',
  })),
  updateAccountBalance: jest.fn(),
  applyTransfer: jest.fn(async () => ({ ok: true })),
  getAccountsByUserId: jest.fn((userId) =>
    userId === 'test-user-id'
      ? [{ id: 'test-account-id', userId: 'test-user-id', accountType: 'Checking', balance: 10000 }]
      : [],
  ),
  getTransactionsByUserId: jest.fn(() => []),
  getAllTransactions: jest.fn(() => []),
  getTransactionById: jest.fn(() => null),
}));

jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn().mockResolvedValue({ decision: 'PERMIT', raw: {} }),
  evaluateMcpToolDelegation: jest.fn().mockResolvedValue({ decision: 'PERMIT', stepUpRequired: false, raw: {} }),
  isMcpDelegationDecisionReady: jest.fn(() => false),
}));

// Mock configStore so the local SQLite config (which may have ff_hitl_enabled=false)
// doesn't disable consent enforcement. HITL must be on for these tests to be meaningful.
jest.mock('../../services/configStore', () => ({
  get: jest.fn((key) => null),
  getEffective: jest.fn((key) => {
    if (key === 'ff_hitl_enabled') return 'true';
    if (key === 'max_transaction_amount') return '10000';
    // Use 'email' mode so confirmChallenge falls through to the BFF-generated
    // OTP path (emailService) instead of calling mfaService.getPingOneUserContact.
    if (key === 'hitl_consent_mfa_mode') return 'email';
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

// Mock transactionAuthorizationService to enforce HITL consent for amounts > $500.
// The real service is not configured in test (no simulated mode, no PingOne endpoint),
// so it returns { ran: false } and the consent gate never fires without this mock.
jest.mock('../../services/transactionAuthorizationService', () => ({
  evaluateTransactionPolicy: jest.fn(async ({ amount, type }) => {
    const CONSENT_THRESHOLD = 500;
    const CONSENT_TYPES = ['withdrawal', 'transfer'];
    if (CONSENT_TYPES.includes(type) && amount > CONSENT_THRESHOLD) {
      return {
        ran: true,
        block: {
          status: 428,
          body: {
            error: 'hitl_required',
            hitl: { type: 'consent' },
            error_description: 'This transaction requires explicit human approval.',
          },
        },
      };
    }
    return { ran: false, reason: 'below_threshold' };
  }),
}));

// Mock mfaService so confirmChallenge (onetime mode) can resolve user contact
// without hitting real PingOne APIs.
jest.mock('../../services/mfaService', () => ({
  getPingOneUserContact: jest.fn().mockResolvedValue({ email: 'test@bank.com', mobilePhone: null }),
  initiateDeviceAuth: jest.fn(),
  selectDevice: jest.fn(),
  submitOtp: jest.fn(),
  submitFido2Assertion: jest.fn(),
}));

// Mock recognizeService so face-auth path doesn't hit PingOne.
jest.mock('../../services/recognizeService', () => ({
  verifyFace: jest.fn().mockResolvedValue({ ok: true }),
}));

// Mock emailService so no real PingOne calls are made.
// The mock captures the otpCode so tests can read it back.
let _lastOtpCode = null;
jest.mock('../../services/emailService', () => ({
  sendTransactionConfirmation: jest.fn().mockResolvedValue(undefined),
  sendOtpEmail: jest.fn(async (_userId, opts) => {
    _lastOtpCode = opts.otpCode;
  }),
}));

const app = require('../../server');
const runtimeSettings = require('../../config/runtimeSettings');

const customerUser = () =>
  JSON.stringify({
    id: 'test-user-id',
    username: 'customer',
    email: 'customer@bank.com',
    role: 'user',
    scopes: ['write', 'read'],
    acr: 'Multi_factor',
  });

beforeAll(() => {
  runtimeSettings.update({ stepUpEnabled: false, authorizeEnabled: false });
});

afterAll(() => {
  runtimeSettings.update({ stepUpEnabled: true, authorizeEnabled: false });
});

beforeEach(() => {
  _lastOtpCode = null;
});

// ── Helper: run the full 4-step flow and return the transaction response ──────
async function fullConsentOtpFlow(agent, body) {
  // Step 1 — create challenge
  const cr = await agent
    .post('/api/transactions/consent-challenge')
    .set('x-test-user', customerUser())
    .send(body);
  if (cr.status !== 201) return { error: 'challenge_failed', res: cr };
  const { challengeId } = cr.body;

  // Step 2 — confirm (sends OTP email)
  const cf = await agent
    .post(`/api/transactions/consent-challenge/${challengeId}/confirm`)
    .set('x-test-user', customerUser());
  if (cf.status !== 200) return { error: 'confirm_failed', res: cf };

  // Step 3 — verify OTP (mock captured it in _lastOtpCode)
  const otp = _lastOtpCode;
  if (!otp) return { error: 'otp_not_captured' };
  const vr = await agent
    .post(`/api/transactions/consent-challenge/${challengeId}/verify-otp`)
    .set('x-test-user', customerUser())
    .send({ otpCode: otp });
  if (vr.status !== 200) return { error: 'verify_failed', res: vr };

  // Step 4 — submit transaction
  const tx = await agent
    .post('/api/transactions')
    .set('x-test-user', customerUser())
    .send({ ...body, consentChallengeId: challengeId });
  return { challengeId, tx };
}

describe('Transaction consent challenge', () => {
  it('rejects POST /transactions over $500 without consentChallengeId', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('x-test-user', customerUser())
      .send({
        fromAccountId: 'test-account-id',
        amount: 600,
        type: 'withdrawal',
        description: 'x',
      });
    expect(res.status).toBe(428);
    expect(res.body.error).toBe('hitl_required');
  });

  it('POST /confirm returns otpSent flag and OTP email is sent', async () => {
    const agent = request.agent(app);
    const body = { fromAccountId: 'test-account-id', amount: 600, type: 'withdrawal', description: 'otp test' };
    const cr = await agent.post('/api/transactions/consent-challenge').set('x-test-user', customerUser()).send(body);
    expect(cr.status).toBe(201);
    const cf = await agent
      .post(`/api/transactions/consent-challenge/${cr.body.challengeId}/confirm`)
      .set('x-test-user', customerUser());
    expect(cf.status).toBe(200);
    expect(cf.body).toHaveProperty('otpExpiresAt');
    expect(cf.body.otpSent).toBe(true);
    expect(_lastOtpCode).toMatch(/^\d{6}$/);
  });

  it('full flow: challenge → confirm → verify-otp → transaction returns 201', async () => {
    const agent = request.agent(app);
    const body = { fromAccountId: 'test-account-id', amount: 600, type: 'withdrawal', description: 'consent flow test' };
    const { tx, error } = await fullConsentOtpFlow(agent, body);
    expect(error).toBeUndefined();
    expect(tx.status).toBe(201);
  });

  it('rejects wrong OTP code with otp_incorrect and attemptsRemaining', async () => {
    const agent = request.agent(app);
    const body = { fromAccountId: 'test-account-id', amount: 610, type: 'withdrawal', description: 'wrong otp' };
    const cr = await agent.post('/api/transactions/consent-challenge').set('x-test-user', customerUser()).send(body);
    const { challengeId } = cr.body;
    await agent.post(`/api/transactions/consent-challenge/${challengeId}/confirm`).set('x-test-user', customerUser());

    const wr = await agent
      .post(`/api/transactions/consent-challenge/${challengeId}/verify-otp`)
      .set('x-test-user', customerUser())
      .send({ otpCode: '000000' });
    expect(wr.status).toBe(400);
    expect(wr.body.error).toBe('otp_incorrect');
    expect(wr.body).toHaveProperty('attemptsRemaining');
  });

  it('locks challenge after 3 wrong OTP attempts', async () => {
    const agent = request.agent(app);
    const body = { fromAccountId: 'test-account-id', amount: 620, type: 'withdrawal', description: 'lock test' };
    const cr = await agent.post('/api/transactions/consent-challenge').set('x-test-user', customerUser()).send(body);
    const { challengeId } = cr.body;
    await agent.post(`/api/transactions/consent-challenge/${challengeId}/confirm`).set('x-test-user', customerUser());

    for (let i = 0; i < 3; i++) {
      await agent
        .post(`/api/transactions/consent-challenge/${challengeId}/verify-otp`)
        .set('x-test-user', customerUser())
        .send({ otpCode: '111111' });
    }
    // 4th attempt — should be 429 (locked) or 404 (challenge deleted)
    const locked = await agent
      .post(`/api/transactions/consent-challenge/${challengeId}/verify-otp`)
      .set('x-test-user', customerUser())
      .send({ otpCode: '111111' });
    expect([404, 429]).toContain(locked.status);
  });

  it('rejects POST /transactions without going through verify-otp first', async () => {
    const agent = request.agent(app);
    const body = { fromAccountId: 'test-account-id', amount: 630, type: 'withdrawal', description: 'skip otp' };
    const cr = await agent.post('/api/transactions/consent-challenge').set('x-test-user', customerUser()).send(body);
    const { challengeId } = cr.body;
    // Skip confirm & verify-otp entirely — challenge is still 'pending'
    const tx = await agent
      .post('/api/transactions')
      .set('x-test-user', customerUser())
      .send({ ...body, consentChallengeId: challengeId });
    expect(tx.status).toBe(400);
    expect(['consent_not_confirmed', 'consent_challenge_invalid']).toContain(tx.body.error);
  });

  it('rejects second POST with same consentChallengeId (one-time consume)', async () => {
    const agent = request.agent(app);
    const body = { fromAccountId: 'test-account-id', amount: 640, type: 'withdrawal', description: 'one-time' };
    const { tx: first, challengeId, error } = await fullConsentOtpFlow(agent, body);
    expect(error).toBeUndefined();
    expect(first.status).toBe(201);

    const second = await agent
      .post('/api/transactions')
      .set('x-test-user', customerUser())
      .send({ ...body, consentChallengeId: challengeId });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('consent_challenge_invalid');
  });
});
