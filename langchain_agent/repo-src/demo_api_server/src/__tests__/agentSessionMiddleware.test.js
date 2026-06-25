/**
 * @file agentSessionMiddleware.test.js
 * @description Tests for the agent session middleware that gates all
 *   /api/demo-agent/* routes. Validates session checks, token refresh,
 *   and agentContext attachment.
 */

'use strict';

const { agentSessionMiddleware } = require('../../middleware/agentSessionMiddleware');

// ── Mock oauthUserService ────────────────────────────────────────────────────

const mockRefreshAccessToken = jest.fn();
jest.mock('../../services/oauthUserService', () => ({
  refreshAccessToken: (...args) => mockRefreshAccessToken(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  const session = {
    id: 'sess-123',
    user: { id: 'u1', oauthId: 'oauth-u1', email: 'user@example.com' },
    oauthTokens: {
      accessToken: 'valid-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: Date.now() + 60_000, // valid for 1 min
    },
    save: (cb) => cb(null),
    ...overrides.session,
  };
  return {
    session,
    sessionID: session.id,
    path: '/api/demo-agent/message',
    method: 'POST',
    ...overrides,
  };
}

function makeRes() {
  const res = {
    _status: null,
    _json: null,
    status(code) {
      res._status = code;
      return res;
    },
    json(data) {
      res._json = data;
      return res;
    },
  };
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('agentSessionMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls next() and attaches agentContext for a valid session', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await agentSessionMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.agentContext).toBeDefined();
    expect(req.agentContext.userId).toBe('oauth-u1');
    expect(req.agentContext.accessToken).toBe('valid-access-token');
    expect(req.agentContext.email).toBe('user@example.com');
    expect(req.agentContext.tokenEvents).toEqual([]);
    expect(typeof req.recordTokenEvent).toBe('function');
  });

  it('returns 401 when session.user is missing', async () => {
    const req = makeReq({ session: { user: null, oauthTokens: { accessToken: 'tok' } } });
    const res = makeRes();
    const next = jest.fn();

    await agentSessionMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._json.error).toBe('Unauthorized');
  });

  it('returns 401 when oauthTokens.accessToken is missing', async () => {
    const req = makeReq({
      session: {
        user: { id: 'u1' },
        oauthTokens: {},
      },
    });
    const res = makeRes();
    const next = jest.fn();

    await agentSessionMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._json.error).toBe('oauth_session_required');
  });

  it('returns 401 when accessToken is _cookie_session stub', async () => {
    const req = makeReq({
      session: {
        user: { id: 'u1' },
        oauthTokens: { accessToken: '_cookie_session' },
      },
    });
    const res = makeRes();
    const next = jest.fn();

    await agentSessionMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._json.error).toBe('session_restore_required');
  });

  it('refreshes an expired token and proceeds', async () => {
    const req = makeReq({
      session: {
        id: 'sess-123',
        user: { id: 'u1', oauthId: 'oauth-u1', email: 'user@example.com' },
        oauthTokens: {
          accessToken: 'old-token',
          refreshToken: 'refresh-tok',
          expiresAt: Date.now() - 10_000, // expired 10s ago
        },
        save: (cb) => cb(null),
      },
    });
    const res = makeRes();
    const next = jest.fn();

    mockRefreshAccessToken.mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    });

    await agentSessionMiddleware(req, res, next);

    expect(mockRefreshAccessToken).toHaveBeenCalledWith('refresh-tok');
    expect(next).toHaveBeenCalled();
    expect(req.session.oauthTokens.accessToken).toBe('new-access-token');
    expect(req.agentContext.accessToken).toBe('new-access-token');
  });

  it('returns 401 when token refresh fails', async () => {
    const req = makeReq({
      session: {
        id: 'sess-123',
        user: { id: 'u1', oauthId: 'oauth-u1', email: 'user@example.com' },
        oauthTokens: {
          accessToken: 'old-token',
          refreshToken: 'bad-refresh',
          expiresAt: Date.now() - 10_000,
        },
        save: (cb) => cb(null),
      },
    });
    const res = makeRes();
    const next = jest.fn();

    mockRefreshAccessToken.mockRejectedValue(new Error('invalid_grant'));

    await agentSessionMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._json.error).toBe('Session expired');
  });

  it('recordTokenEvent appends to tokenEvents array', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await agentSessionMiddleware(req, res, next);

    req.recordTokenEvent('exchange_start', { audience: 'https://mcp.example.com' });
    req.recordTokenEvent('exchange_complete', { scopes: ['read'] });

    expect(req.tokenEvents.length).toBe(2);
    expect(req.tokenEvents[0].type).toBe('exchange_start');
    expect(req.tokenEvents[0].audience).toBe('https://mcp.example.com');
    expect(req.tokenEvents[1].type).toBe('exchange_complete');
    expect(req.tokenEvents[0].timestamp).toBeDefined();
  });

  // T-6 (commit 71fbf0ac, REGRESSION_PLAN.md §"resolve user identity from
  // PingOne sub only"): identity resolves from oauthId||sub ONLY. When neither
  // is present the middleware fails closed with a 401 — it must NOT fall back
  // to the legacy numeric session.user.id. (This test previously asserted the
  // removed legacy-fallback behavior; updated to the hardened contract.)
  it('fails closed with 401 when PingOne sub (oauthId/sub) is absent — no legacy id fallback', async () => {
    const req = makeReq({
      session: {
        id: 'sess-123',
        user: { id: 'local-user-42', email: 'local@example.com' },
        oauthTokens: {
          accessToken: 'tok',
          expiresAt: Date.now() + 60_000,
        },
        save: (cb) => cb(null),
      },
    });
    const res = makeRes();
    const next = jest.fn();

    await agentSessionMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._json).toMatchObject({ need_auth: true, agentInitRequired: true });
    expect(req.agentContext).toBeUndefined();
  });
});
