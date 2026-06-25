/**
 * @file sensitiveBanking.route.test.js
 * HTTP-level tests for routes/sensitiveBanking.js
 *
 * Covers:
 *   POST /api/accounts/sensitive-consent
 *     - grants consent token for authenticated user
 *     - 500 when service throws
 *
 *   GET  /api/accounts/sensitive-details
 *     - 428 step_up_required when user ACR is not elevated
 *     - 403 consent_required when consent has not been granted
 *     - 403 denied when PAZ denies
 *     - 200 with sensitive account data when all gates pass
 */

'use strict';

const express = require('express');
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
}));

// ── Mock sensitiveDataService ─────────────────────────────────────────────────
const mockGrantConsent = jest.fn();
const mockCheckAccess  = jest.fn();

jest.mock('../../services/sensitiveDataService', () => ({
  grantSensitiveConsent: (...a) => mockGrantConsent(...a),
  checkSensitiveAccess:  (...a) => mockCheckAccess(...a),
}));

// ── Mock dataStore ────────────────────────────────────────────────────────────
jest.mock('../../data/store', () => ({
  getAccountsByUserId: jest.fn(() => [
    {
      id: 'acct-1',
      accountType: 'checking',
      name: 'Checking',
      accountNumber: '****1234',
      accountNumberFull: '011234567890',
      routingNumber: '026073150',
      swiftCode: 'CHASUS33',
      iban: 'US12CHAS00000000',
    },
  ]),
}));

const sensitiveBankingRouter = require('../../routes/sensitiveBanking');

function buildApp({ acr = 'Multi_Factor' } = {}) {
  const app = express();
  app.use(express.json());

  // Inject a session with save() so the route can call req.session.save()
  app.use((req, _res, next) => {
    req.session = { save: (cb) => (cb ? cb(null) : null) };
    next();
  });

  // authenticateToken sets req.user; we inject acr via x-test-user header
  const { authenticateToken } = require('../../middleware/auth');
  app.use('/api/accounts', authenticateToken, sensitiveBankingRouter);
  return app;
}

// Helpers
const userWithAcr = (acr) =>
  JSON.stringify({ id: 'user-1', sub: 'user-1', role: 'user', scopes: ['read'], acr });

beforeEach(() => {
  mockGrantConsent.mockReset();
  mockCheckAccess.mockReset();
});

// ── POST /sensitive-consent ───────────────────────────────────────────────────

describe('POST /api/accounts/sensitive-consent', () => {
  it('returns the result of grantSensitiveConsent on success', async () => {
    mockGrantConsent.mockResolvedValue({ granted: true, expiresAt: 'some-ts' });
    const app = buildApp();
    const res = await request(app)
      .post('/api/accounts/sensitive-consent')
      .set('x-test-user', userWithAcr('Multi_Factor'));
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(true);
  });

  it('returns 500 when grantSensitiveConsent throws', async () => {
    mockGrantConsent.mockRejectedValue(new Error('session error'));
    const app = buildApp();
    const res = await request(app)
      .post('/api/accounts/sensitive-consent')
      .set('x-test-user', userWithAcr('Multi_Factor'));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to grant consent');
  });
});

// ── GET /sensitive-details ────────────────────────────────────────────────────

describe('GET /api/accounts/sensitive-details', () => {
  it('returns 428 step_up_required when user ACR is not elevated', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/accounts/sensitive-details')
      .set('x-test-user', userWithAcr('MFA'));   // wrong ACR value
    expect(res.status).toBe(428);
    expect(res.body.error).toBe('step_up_required');
    expect(res.body.step_up_required).toBe(true);
    expect(mockCheckAccess).not.toHaveBeenCalled();
  });

  it('returns 428 when acr is empty string (no step-up done)', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/accounts/sensitive-details')
      .set('x-test-user', userWithAcr(''));
    expect(res.status).toBe(428);
  });

  it('returns 403 consent_required when PAZ says consent needed', async () => {
    mockCheckAccess.mockResolvedValue({ allowed: false, consent_required: true, reason: 'sensitive_data_access' });
    const app = buildApp();
    const res = await request(app)
      .get('/api/accounts/sensitive-details')
      .set('x-test-user', userWithAcr('Multi_Factor'));
    expect(res.status).toBe(403);
    expect(res.body.consent_required).toBe(true);
    expect(res.body.reason).toBe('sensitive_data_access');
  });

  it('returns 403 denied when PAZ denies without consent requirement', async () => {
    mockCheckAccess.mockResolvedValue({ allowed: false, consent_required: false, reason: 'paz_denied' });
    const app = buildApp();
    const res = await request(app)
      .get('/api/accounts/sensitive-details')
      .set('x-test-user', userWithAcr('Multi_Factor'));
    expect(res.status).toBe(403);
    expect(res.body.denied).toBe(true);
    expect(res.body.reason).toBe('paz_denied');
  });

  it('returns 200 with sensitive account data when all gates pass', async () => {
    mockCheckAccess.mockResolvedValue({ allowed: true });
    const app = buildApp();
    const res = await request(app)
      .get('/api/accounts/sensitive-details')
      .set('x-test-user', userWithAcr('Multi_Factor'));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts[0]).toHaveProperty('accountNumberFull', '011234567890');
    expect(res.body.accounts[0]).toHaveProperty('routingNumber', '026073150');
  });

  it('returns 500 when checkSensitiveAccess throws', async () => {
    mockCheckAccess.mockRejectedValue(new Error('upstream error'));
    const app = buildApp();
    const res = await request(app)
      .get('/api/accounts/sensitive-details')
      .set('x-test-user', userWithAcr('Multi_Factor'));
    expect(res.status).toBe(500);
  });
});
