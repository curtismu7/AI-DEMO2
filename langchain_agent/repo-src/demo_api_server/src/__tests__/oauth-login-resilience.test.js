/**
 * oauth-login-resilience.test.js
 *
 * Regression tests for the session.save() / session.regenerate() non-fatal
 * fixes applied to oauthUser.js and oauth.js.
 *
 * Bug covered:
 *   Clicking "Customer Sign-In" redirected to ?error=session_error when
 *   req.session.save() failed (Redis cold start / write timeout).
 *   Root cause: the login route treated a Redis write error as fatal even
 *   though the PKCE state was already stored in the signed cookie fallback.
 *   Fix: session.save() failure is now a console.warn; the redirect to PingOne
 *   proceeds regardless.
 */

'use strict';

jest.mock('../../services/configStore', () => ({
  getEffective: (key) => {
    const vals = {
      pingone_environment_id: 'env-test-abc',
      pingone_region:         'com',
      user_client_id:         'user-client-id',
      user_client_secret:     'user-client-secret',
      user_redirect_uri:      'https://banking-demo-puce.vercel.app/api/auth/oauth/user/callback',
    };
    return vals[key] || null;
  },
  isUserOAuthConfigured: () => true,
  ensureInitialized: () => Promise.resolve(),
}));

jest.mock('../../config/oauthUser', () => ({
  get authorizeUsesPiFlow() { return false; },
  get authorizationEndpoint() { return 'https://auth.pingone.com/env-test-abc/as/authorize'; },
  get scopes() { return ['openid', 'profile', 'email']; },
  get clientId() { return 'user-client-id'; },
}));

jest.mock('../../services/oauthRedirectUris', () => ({
  getFrontendOrigin:           () => 'https://banking-demo-puce.vercel.app',
  getUserRedirectUri:          () => 'https://banking-demo-puce.vercel.app/api/auth/oauth/user/callback',
  validateRedirectUriOrigin:   () => ({ ok: true }),
  getExpectedFrontendOrigin:   () => 'https://banking-demo-puce.vercel.app',
}));

jest.mock('../../services/pkceStateCookie', () => ({
  setPkceCookie:   jest.fn(),
  readPkceCookie:  jest.fn().mockReturnValue(null),
  clearPkceCookie: jest.fn(),
}));

jest.mock('../../services/authStateCookie', () => ({
  setAuthCookie:   jest.fn(),
  clearAuthCookie: jest.fn(),
}));

// Mock oauthUserService (not used in login route but required by the module)
jest.mock('../../services/oauthUserService', () => ({
  generateState:            () => 'mock-state-abc123',
  generateCodeVerifier:     () => 'mock-verifier',
  generateCodeChallenge:    () => Promise.resolve('mock-challenge'),
  generateAuthorizationUrl: (_state, _verifier, _extra, _redirectUri) =>
    'https://auth.pingone.com/env-test-abc/as/authorize?client_id=user-client-id&response_type=code',
  exchangeCodeForToken: jest.fn(),
  getUserInfo:          jest.fn(),
  refreshAccessToken:   jest.fn(),
}));

const request = require('supertest');
const express = require('express');

// Build a minimal Express app with the oauthUser router
function buildApp({ saveError = null } = {}) {
  const app = express();
  app.use(express.json());

  // Inject a fake session middleware
  app.use((req, _res, next) => {
    req.session = {
      oauthState: null,
      oauthCodeVerifier: null,
      oauthType: null,
      save(cb) { cb(saveError); },
      regenerate(cb) { cb(null); },
      destroy(cb) { cb(null); },
    };
    next();
  });

  const oauthUserRouter = require('../../routes/oauthUser');
  app.use('/api/auth/oauth/user', oauthUserRouter);
  return app;
}

describe('oauthUser /login — session.save() resilience', () => {
  beforeEach(() => jest.clearAllMocks());

  it('redirects to PingOne when session.save() succeeds', async () => {
    const app = buildApp({ saveError: null });
    const res = await request(app).get('/api/auth/oauth/user/login').expect(302);
    expect(res.headers.location).toMatch(/auth\.pingone\.com/);
    expect(res.headers.location).not.toContain('session_error');
  });

  it('still redirects to PingOne even when session.save() fails (regression)', async () => {
    // Regression: before the fix, a Redis write error here sent the user to
    // ?error=session_error before they ever reached PingOne.
    const app = buildApp({ saveError: new Error('Redis write timeout') });
    const res = await request(app).get('/api/auth/oauth/user/login').expect(302);

    // Must redirect to PingOne, NOT back to the login page with session_error
    expect(res.headers.location).toMatch(/auth\.pingone\.com/);
    expect(res.headers.location).not.toContain('session_error');
    expect(res.headers.location).not.toContain('login');
  });

  it('sets the PKCE cookie before attempting session.save()', async () => {
    const { setPkceCookie } = require('../../services/pkceStateCookie');
    const app = buildApp({ saveError: new Error('Redis ECONNRESET') });
    await request(app).get('/api/auth/oauth/user/login');
    // Cookie must be set even when session save fails
    expect(setPkceCookie).toHaveBeenCalledTimes(1);
    expect(setPkceCookie).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: expect.any(String), codeVerifier: expect.any(String) }),
      expect.any(Boolean),
    );
  });
});
