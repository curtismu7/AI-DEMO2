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

// The shared jest setup calls jest.resetModules() after every test, so the
// router is re-required per test (same pattern as oauthUserSuccessScreenPref).
let router;
beforeEach(() => {
  jest.resetModules();
  router = require('../routes/oauthUser');
});

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.c2ln-SECRET-SIGNATURE`;

function buildApp(oauthTokens) {
  const app = express();
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use((req, _res, next) => {
    req.session.user = { id: 'u1', email: 'a@b.c', role: 'user' };
    req.session.oauthTokens = oauthTokens;
    next();
  });
  app.use('/api/auth/oauth/user', router);
  return app;
}

describe('GET /api/auth/oauth/user/token-claims', () => {
  test('adds the decoded ID token and the refresh token format, and never a raw token', async () => {
    const res = await request(buildApp({
      accessToken: jwt({ sub: 'u1', scope: 'openid' }),
      idToken: jwt({ sub: 'u1', email: 'a@b.c', nonce: 'n' }),
      refreshToken: 'opaque-refresh-value-123',
    })).get('/api/auth/oauth/user/token-claims').expect(200);

    expect(res.body.idToken.payload).toMatchObject({ sub: 'u1', email: 'a@b.c' });
    expect(res.body.idToken.header.alg).toBe('RS256');
    expect(res.body.hasRefreshToken).toBe(true);
    expect(res.body.refreshTokenFormat).toBe('opaque');
    // header + payload + signature is the raw token: none of it may reach the browser.
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain('SECRET-SIGNATURE');
    expect(wire).not.toContain('opaque-refresh-value-123');
  });

  test('idToken is null and the refresh format null when the session has neither', async () => {
    const res = await request(buildApp({ accessToken: jwt({ sub: 'u1' }) }))
      .get('/api/auth/oauth/user/token-claims').expect(200);

    expect(res.body.idToken).toBeNull();
    expect(res.body.hasRefreshToken).toBe(false);
    expect(res.body.refreshTokenFormat).toBeNull();
  });
});
