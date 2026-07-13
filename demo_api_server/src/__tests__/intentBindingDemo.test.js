'use strict';

// Established pattern for testing authenticateToken-gated routes booted via
// server.js + supertest (see src/__tests__/thresholds.route.test.js and 30+
// other route test files) — server.js mounts many routers that each pull in
// middleware/auth, so the mock must cover the full export surface, not just
// authenticateToken, or unrelated routes fail to load.
jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    if (!req.session) req.session = {};
    if (!req.session.user) {
      req.session.user = { id: 'test-user', role: 'admin', username: 'testadmin' };
    }
    req.user = req.session.user;
    next();
  },
  requireSession: (req, res, next) => {
    if (!req.session) req.session = {};
    if (!req.session.user) {
      req.session.user = { id: 'test-user', role: 'admin', username: 'testadmin' };
      req.user = req.session.user;
    }
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.session) req.session = {};
    if (!req.session.user) {
      req.session.user = { id: 'test-user', role: 'admin', username: 'testadmin' };
    }
    if (req.session.user?.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  },
  requireOwnershipOrAdmin: (req, res, next) => next(),
  requireEndUser: (req, res, next) => next(),
  requireAIAgent: (req, res, next) => next(),
  requireDelegation: (req, res, next) => next(),
  requireScopes: () => (req, res, next) => next(),
  requireNotAdmin: (_req, _res, next) => next(),
  verifyPassword: jest.fn(() => true),
  hashPassword: jest.fn((pwd) => pwd),
  determineClientType: jest.fn(() => 'enduser'),
  determineUserTypeFromToken: jest.fn(() => 'customer'),
  parseTokenScopes: jest.fn(() => []),
  hasRequiredScopes: jest.fn(() => true),
}));

const request = require('supertest');
const { runIntentBindingDemo } = require('../../services/attackSimulatorService');

describe('runIntentBindingDemo — structural (no creds needed)', () => {
  test('returns no_session_token when session is missing (permit action)', async () => {
    const result = await runIntentBindingDemo('permit', { session: { oauthTokens: {} } });
    expect(result.status).toBe(401);
    expect(result.errorCode).toBe('no_session_token');
  });

  test('returns unknown_action for an unrecognized action', async () => {
    const result = await runIntentBindingDemo('nonsense', { session: { oauthTokens: { accessToken: 'x' } } });
    expect(result.status).toBe(400);
    expect(result.errorCode).toBe('unknown_action');
  });

  test('drift action delegates to the existing rar-exceeded attack sim', async () => {
    const result = await runIntentBindingDemo('drift', { session: { oauthTokens: {} } });
    // Same session-missing guard as runAttackSim('rar-exceeded', ...) — proves delegation, not a parallel no-op.
    expect(result.sim).toBe('rar-exceeded');
    expect(result.status).toBe(401);
    expect(result.errorCode).toBe('no_session_token');
  });
});

describe('POST /api/demo/intent-binding/run — route guards', () => {
  let app;
  beforeAll(() => {
    // server.js boots the full app; reuse it the same way other route-guard
    // tests do (e.g. thresholds.route.test.js) — requires the middleware/auth
    // mock above so authenticateToken doesn't reject the request before the
    // action-validation guard under test ever runs.
    app = require('../../server');
  });

  test('rejects an unknown action with 400', async () => {
    const res = await request(app)
      .post('/api/demo/intent-binding/run')
      .send({ action: 'nonsense' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_action');
  });
});
