'use strict';

/**
 * Route-level pins for the tail of the ADMIN GET /callback (the part delegated to
 * adminSessionService.establishAdminSession): failure paths, cookie/audit order and the
 * stored session fields must behave exactly as before the extraction.
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');

jest.mock('../services/oauthService');
jest.mock('../services/tokenValidationService', () => ({ validateToken: jest.fn() }));
jest.mock('../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingone'),
  getEffective: jest.fn(() => ''),
  setConfig: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
  getAdminRedirectUri: jest.fn(() => 'https://x/api/auth/oauth/callback'),
  validateRedirectUriOrigin: jest.fn(() => ({ ok: true })),
  getExpectedFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
}));
jest.mock('../middleware/auth', () => ({ determineClientType: jest.fn(() => 'admin') }));
jest.mock('../services/tokenIntrospectionService', () => ({
  validateToken: jest.fn().mockResolvedValue({ valid: true, sub: 'u1', exp: 1, aud: 'a', scopes: ['s'], client_id: 'c' }),
}));
jest.mock('../services/tokenChainService', () => ({ trackTokenEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/apiCallTrackerService', () => ({ trackToken: jest.fn() }));
jest.mock('../services/posthog', () => ({ identify: jest.fn(), capture: jest.fn() }));
jest.mock('../services/authAccessAuditService', () => ({
  startLoginAudit: jest.fn(),
  resumeLoginAudit: jest.fn(),
  finishLoginAudit: jest.fn(),
}));
jest.mock('../services/authStateCookie', () => ({
  ...jest.requireActual('../services/authStateCookie'),
  setAuthCookie: jest.fn(),
  clearAuthCookie: jest.fn(),
}));
jest.mock('../services/hostedAccessPolicy', () => ({
  ...jest.requireActual('../services/hostedAccessPolicy'),
  loadHostedAccessPolicy: jest.fn(() => ({ enabled: true })),
  evaluateHostedIdentity: jest.fn(() => ({ allowed: true, identifier: 'bob@example.com' })),
  stampHostedAccessApproval: jest.fn((sess) => { sess.hostedStamp = 'stamped'; }),
}));
jest.mock('../data/store', () => {
  const user = { id: 'u1', username: 'bob', role: 'admin', firstName: 'B', lastName: 'O' };
  return {
    getUserByUsername: jest.fn(() => user),
    updateUser: jest.fn(async () => user),
    createUser: jest.fn(async () => user),
  };
});

// The shared jest setup runs jest.resetModules() after every test, so these handles
// are re-required in arm() (before the route is) to be the same instances the route sees.
let oauthService, validateToken, finishLoginAudit, clearAuthCookie, setAuthCookie, stampHostedAccessApproval;

const OIDC_CONFIG = { jwksEndpoint: 'https://idp.example/jwks', issuer: 'https://idp.example/as', clientId: 'test-client' };
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.s`;
const now = () => Math.floor(Date.now() / 1000);
const idClaims = () => ({ iss: OIDC_CONFIG.issuer, sub: 'u1', aud: OIDC_CONFIG.clientId, iat: now(), exp: now() + 300, nonce: 'n1' });

const SEED = {
  oauthState: 'st-1',
  oauthNonce: 'n1',
  oauthCodeVerifier: 'cv-1',
  oauthRedirectUri: 'https://x/api/auth/oauth/callback',
  oauthLoginProvider: 'pingone',
  hostedLoginAudit: { id: 'audit-1' },
  hostedLoginAudits: [{ id: 'audit-1' }],
};

function makeApp({ failRegenerate = false, failSave = false, holder = {}, seed = {} } = {}) {
  const store = new session.MemoryStore();
  if (failSave) store.set = (_sid, _s, cb) => cb(new Error('store down'));
  const app = express();
  app.use(session({ secret: 's', resave: false, saveUninitialized: true, store }));
  app.use((req, _res, next) => {
    Object.assign(req.session, SEED, seed);
    if (failRegenerate) req.session.regenerate = (cb) => cb(new Error('regen down'));
    next();
  });
  app.use((req, res, next) => {
    res.on('finish', () => { holder.session = req.session; });
    next();
  });
  app.use('/api/auth/oauth', require('../routes/oauth'));
  return app;
}

const callback = (app) => request(app).get('/api/auth/oauth/callback').query({ code: 'c', state: 'st-1' });

function arm() {
  oauthService = require('../services/oauthService');
  validateToken = require('../services/tokenValidationService').validateToken;
  ({ finishLoginAudit } = require('../services/authAccessAuditService'));
  ({ clearAuthCookie, setAuthCookie } = require('../services/authStateCookie'));
  ({ stampHostedAccessApproval } = require('../services/hostedAccessPolicy'));
  const cs = require('../services/configStore');
  cs.getOAuthProvider.mockReturnValue('pingone');
  cs.getEffective.mockReturnValue('');
  cs.setConfig.mockResolvedValue(undefined);
  require('../services/oauthRedirectUris').getFrontendOrigin.mockReturnValue('http://localhost:3000');
  require('../middleware/auth').determineClientType.mockReturnValue('admin');
  require('../services/tokenIntrospectionService').validateToken
    .mockResolvedValue({ valid: true, sub: 'u1', exp: 1, aud: 'a', scopes: ['s'], client_id: 'c' });
  require('../services/tokenChainService').trackTokenEvent.mockResolvedValue(undefined);
  const hp = require('../services/hostedAccessPolicy');
  hp.loadHostedAccessPolicy.mockReturnValue({ enabled: true });
  hp.evaluateHostedIdentity.mockReturnValue({ allowed: true, identifier: 'bob@example.com' });
  hp.stampHostedAccessApproval.mockImplementation((sess) => { sess.hostedStamp = 'stamped'; });
  const ds = require('../data/store');
  const u = { id: 'u1', username: 'bob', role: 'admin', firstName: 'B', lastName: 'O' };
  ds.getUserByUsername.mockReturnValue(u);
  ds.updateUser.mockResolvedValue(u);
  oauthService.config = OIDC_CONFIG;
  validateToken.mockImplementation(async (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()));
  oauthService.exchangeCodeForToken.mockResolvedValue({
    access_token: jwt({ sub: 'u1' }),
    id_token: jwt(idClaims()),
    refresh_token: 'rt',
    expires_in: 60,
  });
  oauthService.getUserInfo.mockResolvedValue({ sub: 'u1', email: 'bob@example.com' });
  oauthService.createUserFromOAuth.mockReturnValue({ username: 'bob', email: 'bob@example.com', role: 'admin', oauthProvider: 'pingone', oauthId: 'u1' });
}
beforeEach(arm);

test('regenerate failure: redirects session_regenerate_failed, clears auth cookie THEN audits failure, stores nothing', async () => {
  const holder = {};
  const res = await callback(makeApp({ failRegenerate: true, holder }));

  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('http://localhost:3000/login?error=session_regenerate_failed');
  expect(clearAuthCookie).toHaveBeenCalledTimes(1);
  expect(finishLoginAudit).toHaveBeenCalledTimes(1);
  expect(finishLoginAudit).toHaveBeenCalledWith(expect.anything(), { outcome: 'failure', reasonCode: 'session_regenerate_failed' });
  expect(clearAuthCookie.mock.invocationCallOrder[0]).toBeLessThan(finishLoginAudit.mock.invocationCallOrder[0]);
  expect(holder.session.oauthTokens).toBeUndefined();
  expect(holder.session.user).toBeUndefined();
  expect(setAuthCookie).not.toHaveBeenCalled();
});

test('save failure: redirects session_persist_failed, audits THEN clears auth cookie, destroys session', async () => {
  const holder = {};
  const res = await callback(makeApp({ failSave: true, holder }));

  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('http://localhost:3000/login?error=session_persist_failed');
  expect(finishLoginAudit).toHaveBeenCalledTimes(1);
  expect(finishLoginAudit).toHaveBeenCalledWith(expect.anything(), { outcome: 'failure', reasonCode: 'session_persist_failed' });
  expect(clearAuthCookie).toHaveBeenCalledTimes(1);
  expect(setAuthCookie).not.toHaveBeenCalled();
  expect(holder.session).toBeUndefined(); // req.session.destroy() removed it
  expect(finishLoginAudit.mock.invocationCallOrder[0]).toBeLessThan(clearAuthCookie.mock.invocationCallOrder[0]);
});

test('success: stored fields, hosted stamps on the NEW session, admin auth cookie, audit success, redirect', async () => {
  const holder = {};
  const res = await callback(makeApp({ holder }));

  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('http://localhost:3000/admin?oauth=success');
  const s = holder.session;
  expect(s.oauthTokens).toMatchObject({ refreshToken: 'rt', tokenType: 'Bearer' });
  expect(s.user.username).toBe('bob');
  expect(s.clientType).toBe('admin');
  expect(s.oauthProvider).toBe('pingone');
  expect(s.hostedLoginAudit).toEqual({ id: 'audit-1' });
  expect(s.hostedLoginAudits).toEqual([{ id: 'audit-1' }]);
  expect(s.hostedStamp).toBe('stamped');
  expect(stampHostedAccessApproval).toHaveBeenCalledWith(s, expect.objectContaining({ allowed: true }), expect.anything());
  expect(finishLoginAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: 'success', reasonCode: 'allowed' }));
  expect(setAuthCookie).toHaveBeenCalledTimes(1);
  expect(setAuthCookie.mock.calls[0][1]).toMatchObject({ username: 'bob', oauthType: 'admin', expiresAt: s.oauthTokens.expiresAt });
  expect(clearAuthCookie).not.toHaveBeenCalled();
});
