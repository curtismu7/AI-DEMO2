const request = require('supertest');
const express = require('express');
const session = require('express-session');

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => undefined),
  isUserOAuthConfigured: jest.fn(() => true),
}));
jest.mock('../services/pkceStateCookie');
jest.mock('../services/authStateCookie');
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../data/store', () => ({ updateUser: jest.fn() }));
jest.mock('../services/oauthUserService', () => ({ revokeToken: jest.fn() }));
jest.mock('../services/tokenIntrospectionService', () => ({
  validateToken: jest.fn(),
  clearCache: jest.fn(),
}));

// The shared jest setup calls jest.resetModules() after every test, so the
// router and the mocks it closes over are re-required together per test.
let router;
let oauthService;
let introspection;
beforeEach(() => {
  jest.resetModules();
  oauthService = require('../services/oauthUserService');
  introspection = require('../services/tokenIntrospectionService');
  router = require('../routes/oauthUser');
  oauthService.revokeToken.mockResolvedValue(undefined);
});

function buildApp({ withSession = true } = {}) {
  const app = express();
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use((req, _res, next) => {
    if (withSession) {
      req.session.user = { id: 'u1' };
      req.session.oauthTokens = { accessToken: 'at-123', refreshToken: 'rt-456' };
    }
    next();
  });
  app.use('/api/auth/oauth/user', router);
  return app;
}

describe('POST /api/auth/oauth/user/revoke', () => {
  test('revokes, clears the introspection cache, and reports PingOne now says inactive', async () => {
    introspection.validateToken.mockResolvedValue({ valid: false });
    const res = await request(buildApp()).post('/api/auth/oauth/user/revoke').expect(200);

    expect(oauthService.revokeToken).toHaveBeenCalledWith('at-123', 'access_token');
    // Cache must be cleared BEFORE the check, or a cached "active" is replayed.
    expect(introspection.clearCache.mock.invocationCallOrder[0])
      .toBeLessThan(introspection.validateToken.mock.invocationCallOrder[0]);
    expect(res.body).toEqual({ revoked: true, activeAfterRevoke: false });
    expect(JSON.stringify(res.body)).not.toContain('at-123');
  });

  test('reports not revoked when PingOne still says active', async () => {
    introspection.validateToken.mockResolvedValue({ valid: true });
    const res = await request(buildApp()).post('/api/auth/oauth/user/revoke').expect(200);
    expect(res.body).toEqual({ revoked: false, activeAfterRevoke: true });
  });

  test('does not claim success when introspection itself failed', async () => {
    introspection.validateToken.mockResolvedValue({ valid: false, error: 'token_introspection_failed' });
    const res = await request(buildApp()).post('/api/auth/oauth/user/revoke').expect(200);
    expect(res.body.revoked).toBeNull();
    expect(res.body.activeAfterRevoke).toBeNull();
  });

  test('401 with no user session, and nothing is revoked', async () => {
    await request(buildApp({ withSession: false })).post('/api/auth/oauth/user/revoke').expect(401);
    expect(oauthService.revokeToken).not.toHaveBeenCalled();
  });
});
