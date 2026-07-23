'use strict';
/**
 * resourceServer.summaryInflow.regression.test.js
 * Regression for GET /api/resource-server/summary-inflow (Login vs In-flow dual view).
 *
 * Covers: session gate parity with /summary, no-mint GET, cached MCP claims, view metadata.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  requireNotBankDelegate: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'authentication_required' });
    }
    req.user = { sub: 'test-user-sub' };
    return next();
  },
  requireScopes: () => (req, res, next) => next(),
}));

jest.mock('../../services/bankingDb', () => ({
  getAccountsByUserId: jest.fn().mockReturnValue([]),
  getTransactionsByUserId: jest.fn().mockReturnValue([]),
  initBankingDb: jest.fn(),
}));

jest.mock('../../data/store', () => ({
  getAccountsByUserId: jest.fn().mockReturnValue([]),
  getTransactionsByUserId: jest.fn().mockReturnValue([]),
}));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn().mockReturnValue(''),
}));

jest.mock('../../config/resourceAudience', () => ({
  getBffResourceAudience: () => 'enduser.ping.demo',
  getInFlowResourceAudience: () => 'mcpgateway.ping.demo',
}));

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
  EVENT_CATEGORIES: { AUTHORIZE: 'authorize', HITL: 'hitl', THRESHOLD: 'threshold' },
}));

/** Build a minimal JWT shell for decodeJwtClaims. */
function makeJwt(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

/**
 * Build express app with controllable session for summary-inflow.
 * @param {object} [sessionData]
 */
function buildApp(sessionData = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = sessionData;
    next();
  });
  const { authenticateToken } = require('../../middleware/auth');
  const router = require('../../routes/resourceServer');
  app.use('/api/resource-server', authenticateToken, router);
  return app;
}

describe('resourceServer GET /summary-inflow', () => {
  test('no Authorization → 401 from authenticateToken', async () => {
    const app = buildApp({ oauthTokens: { accessToken: 'sess-at' } });
    const res = await request(app).get('/api/resource-server/summary-inflow');
    expect(res.status).toBe(401);
  });

  test('cookie-session stub → 401 (parity with /summary)', async () => {
    const app = buildApp({ oauthTokens: { accessToken: '_cookie_session' } });
    const res = await request(app)
      .get('/api/resource-server/summary-inflow')
      .set('Authorization', 'Bearer sess-at');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('authentication_required');
  });

  test('authenticated, no cached MCP → hasMcpToken false + inflow metadata', async () => {
    const app = buildApp({ oauthTokens: { accessToken: 'sess-at' } });
    const res = await request(app)
      .get('/api/resource-server/summary-inflow')
      .set('Authorization', 'Bearer sess-at');
    expect(res.status).toBe(200);
    expect(res.body.hasMcpToken).toBe(false);
    expect(res.body.accessTokenClaims).toBeNull();
    expect(res.body.resourceServerInfo.view).toBe('inflow');
    expect(res.body.resourceServerInfo.targetAudience).toBe('mcpgateway.ping.demo');
    expect(res.body.resourceServerInfo.probeHint).toBe('/api/resource-server/identity');
  });

  test('cached MCP token → claims + scopes without minting', async () => {
    const mcpTok = makeJwt({
      sub: 'user-1',
      aud: 'mcpgateway.ping.demo',
      scope: 'openid mcp:invoke',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      act: { sub: 'agent-client' },
    });
    const app = buildApp({
      oauthTokens: { accessToken: 'sess-at' },
      agentTokens: {
        'banking::mcp:invoke': {
          access_token: mcpTok,
          expires_at: Date.now() + 120_000,
        },
      },
    });
    const res = await request(app)
      .get('/api/resource-server/summary-inflow')
      .set('Authorization', 'Bearer sess-at');
    expect(res.status).toBe(200);
    expect(res.body.hasMcpToken).toBe(true);
    expect(res.body.accessTokenClaims.aud).toBe('mcpgateway.ping.demo');
    expect(res.body.tokenMetadata.scopes).toEqual(expect.arrayContaining(['mcp:invoke']));
    expect(res.body.tokenMetadata.actorClaim).toEqual({ sub: 'agent-client' });
  });
});
