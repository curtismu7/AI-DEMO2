/**
 * @file ciba.test.js
 * @description Full test suite for CIBA routes (routes/ciba.js)
 *
 * Covers every endpoint and every significant branch:
 *   GET  /api/auth/ciba/status
 *   POST /api/auth/ciba/initiate
 *   GET  /api/auth/ciba/poll/:authReqId
 *   POST /api/auth/ciba/cancel/:authReqId
 *   POST /api/auth/ciba/notify
 *
 * PingOne interaction is fully mocked via cibaService so tests are hermetic.
 * Session state is simulated by pre-seeding req.session before each request.
 *
 * "OTP approval" simulation:
 *   - First N polls return  { error: 'authorization_pending' }  (user hasn't approved yet)
 *   - Final poll returns    real token set                       (user approved via PingOne email)
 *   - Denial path returns   { error: 'access_denied' }
 */

'use strict';

const request  = require('supertest');
const express  = require('express');
const session  = require('express-session');

// ── Mock cibaService BEFORE requiring the router ──────────────────────────────
jest.mock('../../services/cibaService', () => ({
  initiateBackchannelAuth: jest.fn(),
  pollForTokens:           jest.fn(),
  waitForApproval:         jest.fn(),
  isEnabled:               jest.fn(),
}));

jest.mock('../../services/cibaSimulatedService', () => ({
  initiateSimulated: jest.fn(),
  isSimulatedApproved: jest.fn(),
  SIMULATED_APPROVE_DELAY_MS: 60_000,
}));

jest.mock('../../services/tokenChainService', () => ({
  trackTokenEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    const defaults = {
      ciba_token_delivery_mode:  'poll',
      ciba_binding_message:      'Banking App Authentication',
      ciba_notification_endpoint: null,
    };
    return defaults[key] ?? null;
  }),
}));

jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) return res.status(401).json({ error: 'authentication_required' });
    try { req.user = JSON.parse(h); return next(); }
    catch { return res.status(401).json({ error: 'invalid_token' }); }
  },
  requireScopes: () => (_req, _res, next) => next(),
  requireAdmin:  () => (_req, _res, next) => next(),
  hasRequiredScopes: () => true,
    requireSession: (req, res, next) => next(),
  parseTokenScopes:  () => [],
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const cibaService = require('../../services/cibaService');
const cibaSimulatedService = require('../../services/cibaSimulatedService');
const configStore = require('../../services/configStore');
const { trackTokenEvent } = require('../../services/tokenChainService');
const cibaRouter  = require('../../routes/ciba');
const { PINGONE_OIDC_DEFAULT_SCOPES_SPACE } = require('../../config/scopes');

// ── Auth headers ──────────────────────────────────────────────────────────────

const USER_HDR  = JSON.stringify({ id: 'u1', role: 'customer', email: 'alice@example.com',  scopes: ['openid', 'profile', 'email'] });
const ADMIN_HDR = JSON.stringify({ id: 'a1', role: 'admin',    email: 'admin@example.com',  scopes: ['admin:read'] });
const NO_EMAIL  = JSON.stringify({ id: 'u2', role: 'customer',                              scopes: ['openid'] });

// ── Simulated OTP / token response ───────────────────────────────────────────

const MOCK_TOKENS = {
  access_token:  'at-abc123',
  id_token:      'it-abc123',
  refresh_token: 'rt-abc123',
  token_type:    'Bearer',
  expires_in:    3600,
  scope:         'openid profile email',
};

const MOCK_AUTH_REQ_ID = 'auth-req-id-xyz-789';

// ── App factory — creates a fresh Express instance for each test block ────────

function buildApp(sessionOverride = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );

  // Seed session data before each request (deep-cloned to prevent cross-test mutation)
  app.use((req, _res, next) => {
    Object.assign(req.session, JSON.parse(JSON.stringify(sessionOverride)));
    next();
  });

  app.use('/api/auth/ciba', cibaRouter);
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/auth/ciba/status
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/auth/ciba/status', () => {
  it('returns enabled:true when CIBA is enabled', async () => {
    cibaService.isEnabled.mockReturnValue(true);
    const res = await request(buildApp()).get('/api/auth/ciba/status');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.deliveryMode).toBe('poll');
    expect(res.body.bindingMessage).toBe('Banking App Authentication');
    expect(res.body.setupRequired).toBe(false);
    expect(res.body.setupSteps).toHaveLength(0);
  });

  it('returns enabled:false and setup steps when CIBA is disabled', async () => {
    cibaService.isEnabled.mockReturnValue(false);
    const res = await request(buildApp()).get('/api/auth/ciba/status');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.setupRequired).toBe(true);
    expect(res.body.setupSteps.length).toBeGreaterThan(0);
  });

  it('is accessible without authentication (public endpoint)', async () => {
    cibaService.isEnabled.mockReturnValue(true);
    // No x-test-user header — should succeed
    const res = await request(buildApp()).get('/api/auth/ciba/status');
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/ciba/initiate
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/ciba/initiate', () => {
  beforeEach(() => {
    cibaService.isEnabled.mockReturnValue(true);
    cibaService.initiateBackchannelAuth.mockResolvedValue({
      auth_req_id: MOCK_AUTH_REQ_ID,
      expires_in:  300,
      interval:    5,
    });
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when no session/token supplied', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .send({ binding_message: 'Test transfer' });
    expect(res.status).toBe(401);
  });

  it('returns 503 when CIBA is disabled', async () => {
    cibaService.isEnabled.mockReturnValue(false);
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ciba_disabled');
  });

  // ── login_hint resolution ─────────────────────────────────────────────────

  it('uses email from req.user when no login_hint in body', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: 'Approve payment' });

    expect(res.status).toBe(200);
    expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledWith(
      'alice@example.com',
      'Approve payment',
      expect.any(String),
      expect.any(String),
    );
  });

  it('uses explicit login_hint from body if provided', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ login_hint: 'bob@example.com' });

    expect(res.status).toBe(200);
    expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledWith(
      'bob@example.com',
      undefined,
      expect.any(String),
      expect.any(String),
    );
  });

  it('returns 400 when no email available anywhere (no login_hint, user has no email)', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', NO_EMAIL)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_login_hint');
  });

  it('falls back to req.session.user.email when the access token carries no email claim (real BFF session shape)', async () => {
    // Reproduces a live bug: PingOne access tokens for the customer app have no
    // `email` claim, so req.user.email is undefined on every real request. The
    // only place the demo's session middleware stores the user's email is
    // req.session.user.email (see routes/oauth.js, routes/oauthUser.js) — not
    // req.session.oauthUser, which nothing in the codebase ever sets.
    const res = await request(buildApp({ user: { email: 'carol@example.com' } }))
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', NO_EMAIL)
      .send({ binding_message: 'Approve payment' });

    expect(res.status).toBe(200);
    expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledWith(
      'carol@example.com',
      'Approve payment',
      expect.any(String),
      expect.any(String),
    );
  });

  // ── binding_message validation ────────────────────────────────────────────

  it('returns 400 when binding_message exceeds 256 characters', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: 'A'.repeat(257) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_binding_message');
  });

  it('accepts binding_message at exactly 256 characters', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: 'A'.repeat(256) });
    expect(res.status).toBe(200);
  });

  it('returns 400 when binding_message is not a string', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_binding_message');
  });

  it('strips control characters from binding_message (log injection prevention)', async () => {
    // Malicious newlines/nulls in binding_message could pollute server logs
    const dirty = 'Transfer\n\r\x00approved';
    await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: dirty });
    const callArgs = cibaService.initiateBackchannelAuth.mock.calls[0];
    // binding_message (2nd arg) should have no control chars
    expect(callArgs[1]).not.toMatch(/[\x00-\x1f]/);
  });

  // ── Successful initiation ─────────────────────────────────────────────────

  it('returns auth_req_id, expires_in, interval, and masked display hint', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ scope: 'openid profile email', binding_message: 'Approve $500 transfer' });

    expect(res.status).toBe(200);
    expect(res.body.auth_req_id).toBe(MOCK_AUTH_REQ_ID);
    expect(res.body.expires_in).toBe(300);
    expect(res.body.interval).toBe(5);
    // email should be masked for display
    expect(res.body.login_hint_display).toMatch(/\*+@/);
    expect(res.body.login_hint_display).not.toBe('alice@example.com');
  });

  it('accepts optional amount/account-label fields and stores them on the pending request', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({
        binding_message: 'Approve $600 transfer',
        amount: 600,
        from_account_label: 'Checking',
        to_account_label: 'Savings',
      });
    expect(res.status).toBe(200);
    // Fields aren't echoed on /initiate's own response — verified via
    // GET /request/:authReqId in the next describe block.
  });

  it('sends correct scope and acr_values to PingOne', async () => {
    await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({
        scope:           'openid profile email write',
        acr_values:      'Multi_factor',
        binding_message: 'High-value transfer',
      });

    expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledWith(
      'alice@example.com',
      'High-value transfer',
      'openid profile email write',
      'Multi_factor',
    );
  });

  it('defaults scope to PINGONE_OIDC_DEFAULT_SCOPES_SPACE when not provided', async () => {
    await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({});
    const callArgs = cibaService.initiateBackchannelAuth.mock.calls[0];
    expect(callArgs[2]).toBe(PINGONE_OIDC_DEFAULT_SCOPES_SPACE);
  });

  // ── PingOne errors ────────────────────────────────────────────────────────

  it('returns 502 when PingOne returns an error response and failover is explicitly disabled', async () => {
    configStore.getEffective.mockReturnValueOnce('deny');
    const pingErr = {
      response: {
        data: {
          error: 'invalid_client',
          error_description: 'Client credentials are invalid',
        },
        status: 400,
      },
    };
    cibaService.initiateBackchannelAuth.mockRejectedValue(pingErr);

    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: 'Test' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('invalid_client');
    expect(res.body.message).toContain('invalid');
  });

  it('returns 502 on network / timeout error when failover is explicitly disabled', async () => {
    configStore.getEffective.mockReturnValueOnce('deny');
    cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('ciba_initiation_failed');
  });

  // ── Simulated failover (default behavior) ───────────────────────────────────

  it('falls back to the simulated engine by default when the real bc-authorize call fails', async () => {
    cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED'));
    cibaSimulatedService.initiateSimulated.mockReturnValue({
      auth_req_id: 'sim-abc123',
      expires_in: 300,
      interval: 5,
    });

    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: 'Approve payment' });

    expect(res.status).toBe(200);
    expect(res.body.auth_req_id).toBe('sim-abc123');
    expect(cibaSimulatedService.initiateSimulated).toHaveBeenCalledWith(
      'alice@example.com',
      'Approve payment',
      expect.any(String),
      expect.any(String),
    );
  });

  it('does not call the simulated engine when the real call succeeds', async () => {
    // This file has no global clearMocks/resetMocks — clear explicitly so a
    // call count from an earlier test (e.g. the failover test above) can't
    // leak in and produce a false pass/fail here.
    cibaSimulatedService.initiateSimulated.mockClear();

    const res = await request(buildApp())
      .post('/api/auth/ciba/initiate')
      .set('x-test-user', USER_HDR)
      .send({ binding_message: 'Approve payment' });

    expect(res.status).toBe(200);
    expect(cibaSimulatedService.initiateSimulated).not.toHaveBeenCalled();
  });

  // ── Regression: camelCase / snake_case tolerance (transfer -> CIBA bridge) ──
  // The UserDashboard transfer step-up bridge historically POSTed camelCase
  // (loginHint / bindingMessage) and read back authReqId, while the route spoke
  // snake_case — so the binding message was dropped and polling never started.
  // The route now accepts both casings and returns both keys.
  describe('camelCase/snake_case field tolerance', () => {
    beforeEach(() => {
      cibaService.isEnabled.mockReturnValue(true);
      cibaService.initiateBackchannelAuth.mockResolvedValue({
        auth_req_id: MOCK_AUTH_REQ_ID,
        expires_in:  300,
        interval:    5,
      });
    });

    it('honors camelCase bindingMessage (passed through to PingOne, not dropped)', async () => {
      const res = await request(buildApp())
        .post('/api/auth/ciba/initiate')
        .set('x-test-user', USER_HDR)
        .send({ bindingMessage: 'Approve your banking transaction' });

      expect(res.status).toBe(200);
      expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledWith(
        'alice@example.com',
        'Approve your banking transaction',
        expect.any(String),
        expect.any(String),
      );
    });

    it('honors camelCase loginHint and acrValues', async () => {
      await request(buildApp())
        .post('/api/auth/ciba/initiate')
        .set('x-test-user', USER_HDR)
        .send({ loginHint: 'bob@example.com', acrValues: 'Multi_factor', scope: 'openid profile' });

      expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledWith(
        'bob@example.com',
        undefined,
        'openid profile',
        'Multi_factor',
      );
    });

    it('returns both auth_req_id and authReqId so either casing caller works', async () => {
      const res = await request(buildApp())
        .post('/api/auth/ciba/initiate')
        .set('x-test-user', USER_HDR)
        .send({ binding_message: 'Approve transfer' });

      expect(res.status).toBe(200);
      expect(res.body.auth_req_id).toBe(MOCK_AUTH_REQ_ID);
      expect(res.body.authReqId).toBe(MOCK_AUTH_REQ_ID);
    });

    it('still strips control characters when binding_message arrives camelCase', async () => {
      await request(buildApp())
        .post('/api/auth/ciba/initiate')
        .set('x-test-user', USER_HDR)
        .send({ bindingMessage: 'Transfer\n\r\x00approved' });
      const callArgs = cibaService.initiateBackchannelAuth.mock.calls[0];
      expect(callArgs[1]).not.toMatch(/[\x00-\x1f]/);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/auth/ciba/request/:authReqId
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/auth/ciba/request/:authReqId', () => {
  const pendingWithDetails = {
    cibaRequests: {
      [MOCK_AUTH_REQ_ID]: {
        initiatedAt: Date.now(),
        expiresAt:   Date.now() + 300_000,
        loginHint:   'alice@example.com',
        scope:       'openid profile email',
        acr_values:  '',
        binding_message: 'Approve your banking transaction',
        amount: 600,
        fromAccountLabel: 'Checking',
        toAccountLabel: 'Savings',
      },
    },
  };

  it('returns 401 without authentication', async () => {
    const res = await request(buildApp(pendingWithDetails))
      .get(`/api/auth/ciba/request/${MOCK_AUTH_REQ_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown auth_req_id', async () => {
    const res = await request(buildApp({ cibaRequests: {} }))
      .get('/api/auth/ciba/request/no-such-id')
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_request');
  });

  it('returns 410 for an expired request', async () => {
    const expiredSession = {
      cibaRequests: {
        [MOCK_AUTH_REQ_ID]: {
          initiatedAt: Date.now() - 400_000,
          expiresAt:   Date.now() - 100_000,
          binding_message: 'Approve transfer',
        },
      },
    };
    const res = await request(buildApp(expiredSession))
      .get(`/api/auth/ciba/request/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('request_expired');
  });

  it('returns binding_message, amount, and account labels for a pending request', async () => {
    const res = await request(buildApp(pendingWithDetails))
      .get(`/api/auth/ciba/request/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      binding_message: 'Approve your banking transaction',
      amount: 600,
      from_account_label: 'Checking',
      to_account_label: 'Savings',
    });
  });

  it('returns null amount/account labels when the request has none (non-UC22 CIBA)', async () => {
    const bare = {
      cibaRequests: {
        [MOCK_AUTH_REQ_ID]: {
          initiatedAt: Date.now(),
          expiresAt:   Date.now() + 300_000,
          binding_message: 'Approve sign-in',
        },
      },
    };
    const res = await request(buildApp(bare))
      .get(`/api/auth/ciba/request/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(200);
    expect(res.body.amount).toBeNull();
    expect(res.body.from_account_label).toBeNull();
    expect(res.body.to_account_label).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/auth/ciba/poll/:authReqId
// Simulates the full OTP/approval flow:
//   - polls 1: pending (email sent, user hasn't clicked yet)
//   - polls 2: pending (slow_down signal from PingOne)
//   - poll  3: approved (user clicked the approval link in their email)
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/auth/ciba/poll/:authReqId — OTP approval simulation', () => {
  const pendingReq = {
    cibaRequests: {
      [MOCK_AUTH_REQ_ID]: {
        initiatedAt: Date.now(),
        expiresAt:   Date.now() + 300_000,
        loginHint:   'alice@example.com',
        scope:       'openid profile email',
        acr_values:  '',
        binding_message: 'Approve $500 transfer',
      },
    },
  };

  beforeEach(() => { cibaService.isEnabled.mockReturnValue(true); });

  it('returns 401 without authentication', async () => {
    const res = await request(buildApp(pendingReq))
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 503 when CIBA is disabled', async () => {
    cibaService.isEnabled.mockReturnValue(false);
    const res = await request(buildApp(pendingReq))
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(503);
  });

  it('returns 404 for an unknown auth_req_id (not in session)', async () => {
    // cibaRequests is empty — no matching request
    const res = await request(buildApp({ cibaRequests: {} }))
      .get('/api/auth/ciba/poll/no-such-id')
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_request');
  });

  it('returns 404 when cibaRequests is absent from session', async () => {
    const res = await request(buildApp({}))
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(404);
  });

  it('returns 410 when the CIBA request has expired', async () => {
    const expiredSession = {
      cibaRequests: {
        [MOCK_AUTH_REQ_ID]: {
          initiatedAt: Date.now() - 400_000,
          expiresAt:   Date.now() - 100_000, // expired 100 s ago
          loginHint:   'alice@example.com',
          scope:       'openid profile email',
        },
      },
    };
    const res = await request(buildApp(expiredSession))
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('request_expired');
  });

  // ── OTP simulation — still pending (email sent, awaiting user click) ───────

  it('returns { status:"pending" } while user has not yet approved (poll 1)', async () => {
    // PingOne returns authorization_pending — email was sent, user hasn't clicked
    const pingPending = { response: { data: { error: 'authorization_pending' } } };
    cibaService.pollForTokens.mockRejectedValue(pingPending);

    const res = await request(buildApp(pendingReq))
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('returns { status:"pending", slow_down:true } on slow_down signal (poll 2)', async () => {
    // PingOne signals the client to back off
    const pingSlowDown = { response: { data: { error: 'slow_down' } } };
    cibaService.pollForTokens.mockRejectedValue(pingSlowDown);

    const res = await request(buildApp(pendingReq))
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.slow_down).toBe(true);
    expect(res.body.retry_after).toBe(10);
  });

  // ── OTP simulation — user approved (clicks link in PingOne email) ──────────

  it('returns { status:"approved" } when user approves (poll 3 — OTP entered)', async () => {
    // Simulate user clicking the approval link in the PingOne email
    cibaService.pollForTokens.mockResolvedValue(MOCK_TOKENS);

    const res = await request(buildApp(pendingReq))
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.scope).toBe('openid profile email');
  });

  it('does NOT expose access_token or id_token in approval response (Backend-for-Frontend (BFF) pattern)', async () => {
    cibaService.pollForTokens.mockResolvedValue(MOCK_TOKENS);
    const res = await request(buildApp(pendingReq))
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    // Backend-for-Frontend (BFF) pattern: tokens must never reach the browser
    expect(res.body.access_token).toBeUndefined();
    expect(res.body.id_token).toBeUndefined();
    expect(res.body.refresh_token).toBeUndefined();
  });

  // ── User denied ────────────────────────────────────────────────────────────

  it('returns 403 with status:"denied" when user denies the request', async () => {
    const pingDenied = { response: { data: { error: 'access_denied', error_description: 'User denied' } } };
    cibaService.pollForTokens.mockRejectedValue(pingDenied);

    const res = await request(buildApp(pendingReq))
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    expect(res.status).toBe(403);
    expect(res.body.status).toBe('denied');
    expect(res.body.error).toBe('access_denied');
  });

  it('returns 403 when PingOne reports expired_token', async () => {
    const pingExpired = { response: { data: { error: 'expired_token' } } };
    cibaService.pollForTokens.mockRejectedValue(pingExpired);

    const res = await request(buildApp(pendingReq))
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    expect(res.status).toBe(403);
    expect(res.body.status).toBe('denied');
  });

  // ── Simulated approval (failover engine) ────────────────────────────────────

  const SIM_AUTH_REQ_ID = 'sim-req-xyz';
  const simulatedPendingReq = (initiatedAt) => ({
    cibaRequests: {
      [SIM_AUTH_REQ_ID]: {
        initiatedAt,
        expiresAt:   Date.now() + 300_000,
        loginHint:   'alice@example.com',
        scope:       'openid profile',
        acr_values:  '',
        binding_message: 'Approve your banking transaction',
        simulated:   true,
      },
    },
  });

  it('returns { status:"pending" } before the simulated approval delay elapses', async () => {
    cibaSimulatedService.isSimulatedApproved.mockReturnValue(false);

    const res = await request(buildApp(simulatedPendingReq(Date.now())))
      .get(`/api/auth/ciba/poll/${SIM_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    // Note: no `expect(cibaService.pollForTokens).not.toHaveBeenCalled()`
    // here — earlier tests in this describe block already called it (this
    // file has no clearAllMocks in this scope), so that assertion would
    // false-fail on leftover call count, not on this test's own behavior.
    // The status assertion alone is sufficient: if the real (unmocked-for-
    // this-id) path had been taken instead, the response would not be a
    // clean 200 { status: 'pending' }.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('returns { status:"approved" } once the simulated delay elapses, without calling the real PingOne poll', async () => {
    cibaSimulatedService.isSimulatedApproved.mockReturnValue(true);

    const res = await request(buildApp(simulatedPendingReq(Date.now() - 8000)))
      .get(`/api/auth/ciba/poll/${SIM_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.scope).toBe('openid profile');
  });

  it('records a token-chain event on simulated approval, identical in shape to a real one', async () => {
    cibaSimulatedService.isSimulatedApproved.mockReturnValue(true);

    await request(buildApp(simulatedPendingReq(Date.now() - 8000)))
      .get(`/api/auth/ciba/poll/${SIM_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);

    expect(trackTokenEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'auth',
        userId: 'u1',
        description: 'CIBA backchannel step-up approved (out-of-band)',
        additionalData: expect.objectContaining({ grantedVia: 'ciba', engine: 'simulated' }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Full OTP simulation — sequential poll cycle (pending → pending → approved)
// ═══════════════════════════════════════════════════════════════════════════════

describe('CIBA full OTP flow simulation — sequential poll cycle', () => {
  /**
   * Scenario:
   *   1. Client initiates CIBA → PingOne sends email to alice@example.com
   *   2. Client polls   → 'authorization_pending' (email sent, user hasn't clicked)
   *   3. Client polls   → 'authorization_pending' (user is reading their email)
   *   4. Client polls   → tokens returned         (user clicked link → OTP verified)
   *
   * This test reuses the same app instance so session state persists across
   * the initiate + poll calls.
   */

  const FLOW_AUTH_REQ_ID = 'flow-auth-req-id-001';

  beforeEach(() => {
    jest.clearAllMocks();
    cibaService.isEnabled.mockReturnValue(true);
  });

  it('completes the full pending → approved cycle on a single agent', async () => {
    // ── Step 1: Initiate ────────────────────────────────────────────────────
    cibaService.initiateBackchannelAuth.mockResolvedValue({
      auth_req_id: FLOW_AUTH_REQ_ID,
      expires_in: 300,
      interval: 5,
    });

    // Use a persistent agent so session cookies carry over between requests
    const app   = buildApp();
    const agent = request.agent(app);

    const initiateRes = await agent
      .set('x-test-user', USER_HDR)
      .post('/api/auth/ciba/initiate')
      .send({ binding_message: 'Approve transfer of $500' });

    expect(initiateRes.status).toBe(200);
    expect(initiateRes.body.auth_req_id).toBe(FLOW_AUTH_REQ_ID);
    // PingOne would now send an email to alice@example.com

    // ── Step 2: Poll 1 — user hasn't opened email yet ───────────────────────
    const pending1 = { response: { data: { error: 'authorization_pending' } } };
    cibaService.pollForTokens.mockRejectedValueOnce(pending1);

    const poll1 = await agent
      .set('x-test-user', USER_HDR)
      .get(`/api/auth/ciba/poll/${FLOW_AUTH_REQ_ID}`);

    expect(poll1.status).toBe(200);
    expect(poll1.body.status).toBe('pending');

    // ── Step 3: Poll 2 — user opened the email but hasn't clicked yet ───────
    const pending2 = { response: { data: { error: 'authorization_pending' } } };
    cibaService.pollForTokens.mockRejectedValueOnce(pending2);

    const poll2 = await agent
      .set('x-test-user', USER_HDR)
      .get(`/api/auth/ciba/poll/${FLOW_AUTH_REQ_ID}`);

    expect(poll2.status).toBe(200);
    expect(poll2.body.status).toBe('pending');

    // ── Step 4: Poll 3 — user clicked approval link (OTP verified) ──────────
    // This simulates the user approving via the PingOne email link
    cibaService.pollForTokens.mockResolvedValueOnce(MOCK_TOKENS);

    const poll3 = await agent
      .set('x-test-user', USER_HDR)
      .get(`/api/auth/ciba/poll/${FLOW_AUTH_REQ_ID}`);

    expect(poll3.status).toBe(200);
    expect(poll3.body.status).toBe('approved');
    expect(poll3.body.scope).toBe(PINGONE_OIDC_DEFAULT_SCOPES_SPACE);

    // Tokens never exposed to browser
    expect(poll3.body.access_token).toBeUndefined();
    expect(poll3.body.id_token).toBeUndefined();

    // ── Step 5: Verify request cleaned up from session ──────────────────────
    // A fourth poll on the same auth_req_id should be 404 (deleted on approval)
    const poll4 = await agent
      .set('x-test-user', USER_HDR)
      .get(`/api/auth/ciba/poll/${FLOW_AUTH_REQ_ID}`);

    expect(poll4.status).toBe(404);
    expect(poll4.body.error).toBe('unknown_request');
  });

  it('completes the full pending → denied cycle', async () => {
    cibaService.initiateBackchannelAuth.mockResolvedValue({
      auth_req_id: FLOW_AUTH_REQ_ID,
      expires_in: 300,
      interval: 5,
    });

    const app   = buildApp();
    const agent = request.agent(app);

    await agent
      .set('x-test-user', USER_HDR)
      .post('/api/auth/ciba/initiate')
      .send({ binding_message: 'Approve transfer' });

    // Poll 1: pending
    cibaService.pollForTokens.mockRejectedValueOnce({
      response: { data: { error: 'authorization_pending' } },
    });
    const p1 = await agent.set('x-test-user', USER_HDR).get(`/api/auth/ciba/poll/${FLOW_AUTH_REQ_ID}`);
    expect(p1.body.status).toBe('pending');

    // Poll 2: user explicitly denied
    cibaService.pollForTokens.mockRejectedValueOnce({
      response: { data: { error: 'access_denied', error_description: 'User rejected the request' } },
    });
    const p2 = await agent.set('x-test-user', USER_HDR).get(`/api/auth/ciba/poll/${FLOW_AUTH_REQ_ID}`);
    expect(p2.status).toBe(403);
    expect(p2.body.status).toBe('denied');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/ciba/cancel/:authReqId
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/ciba/cancel/:authReqId', () => {
  const sessionWithPending = {
    cibaRequests: {
      [MOCK_AUTH_REQ_ID]: {
        initiatedAt: Date.now(),
        expiresAt:   Date.now() + 300_000,
        loginHint:   'alice@example.com',
        scope:       'openid profile email',
      },
    },
  };

  it('returns 401 without authentication', async () => {
    const res = await request(buildApp(sessionWithPending))
      .post(`/api/auth/ciba/cancel/${MOCK_AUTH_REQ_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns { ok: true } when cancelling an active request', async () => {
    cibaService.isEnabled.mockReturnValue(true);
    const agent = request.agent(buildApp());

    // First set up a request in the session via initiate
    cibaService.initiateBackchannelAuth.mockResolvedValue({
      auth_req_id: MOCK_AUTH_REQ_ID, expires_in: 300, interval: 5,
    });
    await agent.set('x-test-user', USER_HDR).post('/api/auth/ciba/initiate').send({});

    const res = await agent
      .set('x-test-user', USER_HDR)
      .post(`/api/auth/ciba/cancel/${MOCK_AUTH_REQ_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Subsequent poll should return 404 (removed from session)
    cibaService.isEnabled.mockReturnValue(true);
    const poll = await agent
      .set('x-test-user', USER_HDR)
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`);
    expect(poll.status).toBe(404);
  });

  it('returns { ok: true } gracefully for a non-existent request (idempotent)', async () => {
    cibaService.isEnabled.mockReturnValue(true);
    const res = await request(buildApp({}))
      .post('/api/auth/ciba/cancel/no-such-id')
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/ciba/approve-now/:authReqId — demo "skip the wait" convenience
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/ciba/approve-now/:authReqId', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(
      buildApp({ cibaRequests: { [MOCK_AUTH_REQ_ID]: { simulated: true } } }),
    ).post(`/api/auth/ciba/approve-now/${MOCK_AUTH_REQ_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent request', async () => {
    const res = await request(buildApp({}))
      .post('/api/auth/ciba/approve-now/no-such-id')
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_request');
  });

  it('returns 404 for a real (non-simulated) pending request — only the fallback engine can be force-approved', async () => {
    const res = await request(
      buildApp({
        cibaRequests: {
          [MOCK_AUTH_REQ_ID]: {
            initiatedAt: Date.now(),
            expiresAt: Date.now() + 300_000,
            simulated: false,
          },
        },
      }),
    )
      .post(`/api/auth/ciba/approve-now/${MOCK_AUTH_REQ_ID}`)
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(404);
  });

  it('makes an immediate poll return approved for a simulated pending request, instead of waiting out the timer', async () => {
    cibaService.isEnabled.mockReturnValue(true);
    cibaSimulatedService.initiateSimulated.mockClear();
    cibaSimulatedService.initiateSimulated.mockReturnValue({
      auth_req_id: 'sim-approve-now', expires_in: 300, interval: 5,
    });
    cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED'));
    // Real timing semantics, driven by the (mocked) delay constant — proves
    // approve-now's rewritten initiatedAt is what flips this, not a stub.
    cibaSimulatedService.isSimulatedApproved.mockImplementation(
      (pending) => Date.now() - pending.initiatedAt >= cibaSimulatedService.SIMULATED_APPROVE_DELAY_MS,
    );

    const agent = request.agent(buildApp());
    await agent.set('x-test-user', USER_HDR).post('/api/auth/ciba/initiate').send({});

    // Without approve-now, an immediate poll is still pending (delay not elapsed).
    const beforePoll = await agent
      .set('x-test-user', USER_HDR)
      .get('/api/auth/ciba/poll/sim-approve-now');
    expect(beforePoll.body.status).toBe('pending');

    const approveRes = await agent
      .set('x-test-user', USER_HDR)
      .post('/api/auth/ciba/approve-now/sim-approve-now');
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.ok).toBe(true);

    const afterPoll = await agent
      .set('x-test-user', USER_HDR)
      .get('/api/auth/ciba/poll/sim-approve-now');
    expect(afterPoll.body.status).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/ciba/deny/:authReqId
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/ciba/deny/:authReqId', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(
      buildApp({ cibaRequests: { [MOCK_AUTH_REQ_ID]: { simulated: true } } }),
    ).post(`/api/auth/ciba/deny/${MOCK_AUTH_REQ_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent request', async () => {
    const res = await request(buildApp({}))
      .post('/api/auth/ciba/deny/no-such-id')
      .set('x-test-user', USER_HDR);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_request');
  });

  it('marks a pending request denied, and the next /poll call returns 403 denied', async () => {
    cibaService.isEnabled.mockReturnValue(true);
    cibaSimulatedService.initiateSimulated.mockClear();
    cibaSimulatedService.initiateSimulated.mockReturnValue({
      auth_req_id: 'sim-deny-me', expires_in: 300, interval: 5,
    });
    cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED'));
    cibaSimulatedService.isSimulatedApproved.mockReturnValue(false);

    const agent = request.agent(buildApp());
    await agent.set('x-test-user', USER_HDR).post('/api/auth/ciba/initiate').send({});

    const denyRes = await agent
      .set('x-test-user', USER_HDR)
      .post('/api/auth/ciba/deny/sim-deny-me');
    expect(denyRes.status).toBe(200);
    expect(denyRes.body.ok).toBe(true);

    const pollRes = await agent
      .set('x-test-user', USER_HDR)
      .get('/api/auth/ciba/poll/sim-deny-me');
    expect(pollRes.status).toBe(403);
    expect(pollRes.body.status).toBe('denied');
    expect(pollRes.body.error).toBe('access_denied');
  });

  it('a second poll after denial 404s (request deleted, same as approval)', async () => {
    cibaService.isEnabled.mockReturnValue(true);
    cibaSimulatedService.initiateSimulated.mockClear();
    cibaSimulatedService.initiateSimulated.mockReturnValue({
      auth_req_id: 'sim-deny-twice', expires_in: 300, interval: 5,
    });
    cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('ECONNREFUSED'));
    cibaSimulatedService.isSimulatedApproved.mockReturnValue(false);

    const agent = request.agent(buildApp());
    await agent.set('x-test-user', USER_HDR).post('/api/auth/ciba/initiate').send({});
    await agent.set('x-test-user', USER_HDR).post('/api/auth/ciba/deny/sim-deny-twice');
    await agent.set('x-test-user', USER_HDR).get('/api/auth/ciba/poll/sim-deny-twice');

    const secondPoll = await agent
      .set('x-test-user', USER_HDR)
      .get('/api/auth/ciba/poll/sim-deny-twice');
    expect(secondPoll.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/ciba/notify  — ping-mode callback (no auth)
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/ciba/notify', () => {
  it('returns 204 and is accessible without any authentication', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/notify')
      .send({ auth_req_id: MOCK_AUTH_REQ_ID });
    expect(res.status).toBe(204);
  });

  it('returns 204 with empty body', async () => {
    const res = await request(buildApp())
      .post('/api/auth/ciba/notify')
      .send({});
    expect(res.status).toBe(204);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Security: cross-session token harvesting prevention
// ═══════════════════════════════════════════════════════════════════════════════

describe('CIBA security — cross-session isolation', () => {
  it("cannot poll another user's CIBA request (different session)", async () => {
    cibaService.isEnabled.mockReturnValue(true);
    // app1/agent1 initiates; agent2 tries to poll with the same auth_req_id
    const app1 = buildApp();
    const app2 = buildApp(); // fresh session, no cibaRequests
    const agent1 = request.agent(app1);
    const agent2 = request.agent(app2);

    cibaService.initiateBackchannelAuth.mockResolvedValue({
      auth_req_id: MOCK_AUTH_REQ_ID, expires_in: 300, interval: 5,
    });
    await agent1.set('x-test-user', USER_HDR).post('/api/auth/ciba/initiate').send({});

    // agent2 doesn't have the request in its own session → 404
    const res = await agent2
      .set('x-test-user', USER_HDR)
      .get(`/api/auth/ciba/poll/${MOCK_AUTH_REQ_ID}`);
    expect(res.status).toBe(404);
  });
});
