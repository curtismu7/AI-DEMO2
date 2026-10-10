'use strict';

/**
 * Login-hint persistence: a successful sign-in stores the username as the
 * role's hint in configStore so the next sign-in prefills it. Convenience
 * prefill only — never an auth decision.
 *
 * Drives the REAL callback (routes/oauthUser.js) with the OAuth service
 * auto-mocked and the happy-path collaborators stubbed, the same harness shape
 * as oauthUserCallbackNonce.test.js.
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');

jest.mock('../services/oauthUserService');
// validateIdToken mocked to decode-and-accept (the real one needs PingOne's
// JWKS); assertUserInfoSubjectMatches stays real (it is pure).
jest.mock('../services/oidcIdTokenValidationService', () => ({
  ...jest.requireActual('../services/oidcIdTokenValidationService'),
  validateIdToken: jest.fn(async (idToken) => {
    const fail = (reasonCode) => Object.assign(new Error('OIDC identity validation failed'), { reasonCode });
    let claims;
    try { claims = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString()); } catch (_) { throw fail('id_token_invalid'); }
    return claims;
  }),
}));
jest.mock('../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingone'),
  getEffective: jest.fn((key) => ({
    'pingone_environment_id': 'test-env-id',
    'user_client_id': 'test-client-id',
    'user_client_secret': 'test-secret',
    'admin_role': 'admin',
    'admin_username': '',
    'admin_population_id': '',
    'admin_role_claim': '',
  })[key]),
  isUserOAuthConfigured: jest.fn(() => true),
  setConfig: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/tokenIntrospectionService', () => ({
  introspectAtLogin: jest.fn().mockResolvedValue({ active: true }),
  validateToken: jest.fn().mockResolvedValue({ active: true }),
}));
jest.mock('../services/pingOneSessionService', () => ({
  terminateAllUserSessions: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserById: jest.fn().mockResolvedValue({ user: null }),
}));
jest.mock('../services/enterpriseMcpPolicyService', () => ({
  establishEnterpriseSession: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../services/loginFlowTraceService', () => ({
  startTrace: jest.fn(() => 'trace-1'),
  addStep: jest.fn(),
  getTrace: jest.fn(() => null),
}));
jest.mock('../services/authAccessAuditService', () => ({
  startLoginAudit: jest.fn(() => 'audit-1'),
  resumeLoginAudit: jest.fn(),
  finishLoginAudit: jest.fn(),
}));
jest.mock('../services/demoScenarioStore', () => ({
  isScenarioActive: jest.fn(() => false),
}));
// routes/oauth.js (admin) collaborates:
jest.mock('../services/oauthService', () => ({
  config: null,
  exchangeCodeForToken: jest.fn(),
  getUserInfo: jest.fn(),
  createUserFromOAuth: jest.fn(),
  generateAuthorizationUrl: jest.fn(() => 'https://idp.example/authorize'),
}));
jest.mock('../services/tokenChainService', () => ({
  trackTokenEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/apiCallTrackerService', () => ({
  trackToken: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/posthog', () => ({ capture: jest.fn() }));
jest.mock('../services/archEventEmitter', () => jest.fn());
jest.mock('../services/pingoneAdminSession', () => ({
  storeAdminSession: jest.fn(),
  getAdminSession: jest.fn(),
}));

const OIDC_CONFIG = {
  jwksEndpoint: 'https://idp.example/jwks',
  issuer: 'https://idp.example/as',
  clientId: 'test-client',
};

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken = (claims) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.s`;

const baseClaims = (extra = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return { iss: OIDC_CONFIG.issuer, sub: 'u1', aud: OIDC_CONFIG.clientId, iat: now, exp: now + 300, ...extra };
};

function makeApp(seed) {
  const app = express();
  app.use(session({ secret: 'hint-test', resave: false, saveUninitialized: true }));
  app.use((req, _res, next) => { Object.assign(req.session, seed); next(); });
  app.use('/api/auth/oauth/user', require('../routes/oauthUser'));
  return app;
}

const SEED = {
  oauthState: 'st-1',
  oauthNonce: 'expected-nonce',
  oauthCodeVerifier: 'cv-1',
  oauthRedirectUri: 'https://api.ping.demo:4000/api/auth/oauth/user/callback',
  oauthLoginProvider: 'pingone',
};

const userInfoFor = (username) => ({
  sub: 'u1',
  username,
  email: username,
  given_name: 'Demo',
  family_name: 'User',
  population: { id: 'pop-customer' },
});

// The global setup's afterEach runs jest.resetModules(), so every test gets a
// FRESH router wired to FRESH mocked modules — file-scope requires would point
// at stale instances. Each test therefore re-requires what it drives.
const freshMocks = () => {
  const oauthService = require('../services/oauthUserService');
  const configStore = require('../services/configStore');
  oauthService.config = OIDC_CONFIG;
  oauthService.exchangeCodeForToken.mockResolvedValue({
    access_token: 'at',
    id_token: idToken(baseClaims({ nonce: 'expected-nonce' })),
  });
  oauthService.getUserInfo.mockResolvedValue(userInfoFor('hintuser@pingone.com'));
  oauthService.createUserFromOAuth.mockImplementation((info) => ({
    username: info.username,
    email: info.email,
    firstName: info.given_name,
    lastName: info.family_name,
    oauthId: info.sub,
  }));
  return { oauthService, configStore };
};

test('successful sign-in stores the login hint for the customer role', async () => {
  const { configStore } = freshMocks();
  const res = await request(makeApp(SEED))
    .get('/api/auth/oauth/user/callback')
    .query({ code: 'c', state: 'st-1' });

  expect(res.status).toBe(302);
  expect(res.headers.location).not.toContain('error=');
  expect(configStore.setConfig).toHaveBeenCalledWith(
    expect.objectContaining({ last_login_hint_customer: 'hintuser@pingone.com' }));
});

test('callback overwrites stored hint: the next sign-in by a different user wins', async () => {
  const { oauthService, configStore } = freshMocks();
  configStore.getEffective.mockImplementation((key) => ({
    'pingone_environment_id': 'test-env-id',
    'user_client_id': 'test-client-id',
    'user_client_secret': 'test-secret',
    'admin_role': 'admin',
    'last_login_hint_customer': 'old-user@pingone.com',
  })[key]);
  oauthService.getUserInfo.mockResolvedValue(userInfoFor('new-user@pingone.com'));

  const res = await request(makeApp(SEED))
    .get('/api/auth/oauth/user/callback')
    .query({ code: 'c', state: 'st-1' });

  expect(res.status).toBe(302);
  const hintCalls = configStore.setConfig.mock.calls
    .filter((c) => c[0] && c[0].last_login_hint_customer !== undefined);
  expect(hintCalls.length).toBeGreaterThan(0);
  expect(hintCalls[hintCalls.length - 1][0].last_login_hint_customer).toBe('new-user@pingone.com');
});

test('a hint write failure never fails the sign-in', async () => {
  const { configStore } = freshMocks();
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  configStore.setConfig.mockRejectedValue(new Error('lmdb unavailable'));
  const res = await request(makeApp(SEED))
    .get('/api/auth/oauth/user/callback')
    .query({ code: 'c', state: 'st-1' });

  const stack = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  errSpy.mockRestore();
  if (!res.headers.location.includes('error=')) {
    // expected outcome — keep the spy noise out
  } else {
    throw new Error('DEBUG callback error: ' + stack.slice(0, 1200));
  }
  expect(res.status).toBe(302);
  expect(res.headers.location).not.toContain('error=');
});

// ── Admin role: routes/oauth.js callback stores the admin hint ──────────────

const ADMIN_SEED = {
  oauthState: 'st-a',
  oauthNonce: 'expected-nonce',
  oauthCodeVerifier: 'cv-a',
  oauthRedirectUri: 'https://api.ping.demo:4000/api/auth/oauth/callback',
  oauthLoginProvider: 'pingone',
};

function makeAdminApp() {
  const app = express();
  app.use(session({ secret: 'hint-admin-test', resave: false, saveUninitialized: true }));
  app.use((req, _res, next) => { Object.assign(req.session, ADMIN_SEED); next(); });
  app.use('/api/auth/oauth', require('../routes/oauth'));
  return app;
}

describe('admin callback', () => {
  beforeEach(() => {
    jest.resetModules();
    const adminService = require('../services/oauthService');
    adminService.config = {
      jwksEndpoint: 'https://idp.example/jwks',
      issuer: 'https://idp.example/as',
      clientId: 'test-client',
    };
    adminService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'at',
      id_token: idToken(baseClaims({ nonce: 'expected-nonce' })),
    });
    adminService.getUserInfo.mockResolvedValue({
      sub: 'u1',
      username: 'demoAdmin',
      email: 'demoAdmin@pingone.com',
      given_name: 'Demo',
      family_name: 'Admin',
    });
    adminService.createUserFromOAuth.mockImplementation((info) => ({
      username: info.username,
      email: info.email,
      firstName: info.given_name,
      lastName: info.family_name,
      oauthId: info.sub,
    }));
    const configStore = require('../services/configStore');
    configStore.getEffective.mockImplementation((key) => ({
      'pingone_environment_id': 'test-env-id',
      'admin_client_id': 'admin-client-id',
      'admin_client_secret': 'admin-secret',
      'admin_redirect_uri': 'https://api.ping.demo:4000/api/auth/oauth/callback',
      'admin_role': 'admin',
      'admin_username': 'demoAdmin',
    })[key] || '');
  });

  test('successful admin sign-in stores the login hint for the admin role', async () => {
    const configStore = require('../services/configStore');
    const res = await request(makeAdminApp())
      .get('/api/auth/oauth/callback')
      .query({ code: 'c', state: 'st-a' });

    expect(res.status).toBe(302);
    expect(res.headers.location).not.toContain('error=');
    const hintCalls = configStore.setConfig.mock.calls
      .filter((c) => c[0] && c[0].last_login_hint_admin !== undefined);
    expect(hintCalls.length).toBeGreaterThan(0);
  });
});
