'use strict';

/**
 * Route-level pins for the tail of GET /callback (the part delegated to
 * userSessionService.establishUserSession): failure paths and the
 * onRegenerated stamping must behave exactly as before the extraction.
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');

jest.mock('../services/oauthUserService');
jest.mock('../services/tokenValidationService', () => ({ validateToken: jest.fn() }));
jest.mock('../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingone'),
  getEffective: jest.fn(() => ''),
  isUserOAuthConfigured: jest.fn(() => true),
  setConfig: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserById: jest.fn().mockResolvedValue({ user: null }),
}));
jest.mock('../services/tokenIntrospectionService', () => ({
  introspectAtLogin: jest.fn().mockResolvedValue({ active: true }),
}));
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
  const user = { id: 'u1', username: 'bob', role: 'customer', firstName: 'B', lastName: 'O' };
  return {
    getUserByUsername: jest.fn(() => user),
    updateUser: jest.fn(async () => user),
    createUser: jest.fn(async () => user),
    seedAccountsForUser: jest.fn(async () => ({})),
  };
});

// The shared jest setup runs jest.resetModules() after every test, so these handles
// are re-required in arm() (before the route is) to be the same instances the route sees.
let oauthService, validateToken, finishLoginAudit, clearAuthCookie, setAuthCookie, stampHostedAccessApproval;

const OIDC_CONFIG = { jwksEndpoint: 'https://idp.example/jwks', issuer: 'https://idp.example/as', clientId: 'test-client' };
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.s`;
const now = () => Math.floor(Date.now() / 1000);
const idClaims = () => ({ iss: OIDC_CONFIG.issuer, sub: 'u1', aud: OIDC_CONFIG.clientId, iat: now(), exp: now() + 300, nonce: 'n1', acr: 'Multi_Factor' });

const SEED = {
  oauthState: 'st-1',
  oauthNonce: 'n1',
  oauthCodeVerifier: 'cv-1',
  oauthRedirectUri: 'https://api.ping.demo:4000/api/auth/oauth/user/callback',
  oauthLoginProvider: 'pingone',
  hostedLoginAudit: { id: 'audit-1' },
  hostedLoginAudits: [{ id: 'audit-1' }],
};

function makeApp({ failRegenerate = false, failSave = false, holder = {} } = {}) {
  const store = new session.MemoryStore();
  if (failSave) store.set = (_sid, _s, cb) => cb(new Error('store down'));
  const app = express();
  app.use(session({ secret: 's', resave: false, saveUninitialized: true, store }));
  app.use((req, _res, next) => {
    Object.assign(req.session, SEED);
    if (failRegenerate) req.session.regenerate = (cb) => cb(new Error('regen down'));
    next();
  });
  // Capture the session as the route left it, after the callback has finished.
  app.use((req, res, next) => {
    res.on('finish', () => { holder.session = req.session; });
    next();
  });
  app.use('/api/auth/oauth/user', require('../routes/oauthUser'));
  return app;
}

const callback = (app) => request(app).get('/api/auth/oauth/user/callback').query({ code: 'c', state: 'st-1' });

function arm() {
  oauthService = require('../services/oauthUserService');
  validateToken = require('../services/tokenValidationService').validateToken;
  ({ finishLoginAudit } = require('../services/authAccessAuditService'));
  ({ clearAuthCookie, setAuthCookie } = require('../services/authStateCookie'));
  ({ stampHostedAccessApproval } = require('../services/hostedAccessPolicy'));
    require('../services/configStore').getOAuthProvider.mockReturnValue('pingone');
  require('../services/configStore').getEffective.mockReturnValue('');
  require('../services/configStore').setConfig.mockResolvedValue(undefined);
  require('../services/pingOneUserLookupService').fetchPingOneUserById.mockResolvedValue({ user: null });
  require('../services/tokenIntrospectionService').introspectAtLogin.mockResolvedValue({ active: true });
  const hp = require('../services/hostedAccessPolicy');
  hp.loadHostedAccessPolicy.mockReturnValue({ enabled: true });
  hp.evaluateHostedIdentity.mockReturnValue({ allowed: true, identifier: 'bob@example.com' });
  hp.stampHostedAccessApproval.mockImplementation((sess) => { sess.hostedStamp = 'stamped'; });
  const ds = require('../data/store');
  const u = { id: 'u1', username: 'bob', role: 'customer', firstName: 'B', lastName: 'O' };
  ds.getUserByUsername.mockReturnValue(u);
  ds.updateUser.mockResolvedValue(u);
  oauthService.config = OIDC_CONFIG;
  validateToken.mockImplementation(async (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()));
  oauthService.exchangeCodeForToken.mockResolvedValue({
    access_token: jwt({ may_act: { sub: 'agent' } }),
    id_token: jwt(idClaims()),
    refresh_token: 'rt',
    expires_in: 60,
  });
  oauthService.getUserInfo.mockResolvedValue({ sub: 'u1', email: 'bob@example.com' });
  oauthService.createUserFromOAuth.mockReturnValue({ username: 'bob', email: 'bob@example.com', role: 'customer', oauthProvider: 'pingone', oauthIssuer: 'i', oauthId: 'u1' });
}
beforeEach(arm);

const setCookies = (res) => (res.headers['set-cookie'] || []).join('\n');

test('regenerate failure: redirects session_regenerate_failed, clears ID-JAG cookie + auth cookie, audits failure, stores nothing', async () => {
  const holder = {};
  const res = await callback(makeApp({ failRegenerate: true, holder }));

  expect(res.status).toBe(302);
  expect(res.headers.location).toContain('error=session_regenerate_failed');
  expect(setCookies(res)).toMatch(/idjag|id_jag|id-jag/i);
  expect(clearAuthCookie).toHaveBeenCalledTimes(1);
  expect(finishLoginAudit).toHaveBeenCalledWith(expect.anything(), { outcome: 'failure', reasonCode: 'session_regenerate_failed' });
  expect(clearAuthCookie.mock.invocationCallOrder[0]).toBeLessThan(finishLoginAudit.mock.invocationCallOrder[0]);
  expect(holder.session.oauthTokens).toBeUndefined();
  expect(holder.session.user).toBeUndefined();
  expect(setAuthCookie).not.toHaveBeenCalled();
});

test('save failure: redirects session_persist_failed, audits, destroys session, clears auth cookie', async () => {
  const holder = {};
  const res = await callback(makeApp({ failSave: true, holder }));

  expect(res.status).toBe(302);
  expect(res.headers.location).toContain('error=session_persist_failed');
  expect(finishLoginAudit).toHaveBeenCalledTimes(1);
  expect(finishLoginAudit).toHaveBeenCalledWith(expect.anything(), { outcome: 'failure', reasonCode: 'session_persist_failed' });
  expect(clearAuthCookie).toHaveBeenCalledTimes(1);
  expect(setAuthCookie).not.toHaveBeenCalled();
  expect(holder.session).toBeUndefined(); // req.session.destroy() removed it
  // The ID-JAG cookie is cleared unconditionally earlier in /callback, so it is not asserted here.
  expect(finishLoginAudit.mock.invocationCallOrder[0]).toBeLessThan(clearAuthCookie.mock.invocationCallOrder[0]);
});

test('success: onRegenerated stamps land on the NEW session, auth cookie set, audit success, redirect', async () => {
  const holder = {};
  const res = await callback(makeApp({ holder }));

  expect(res.status).toBe(302);
  expect(res.headers.location).toContain('oauth=success');
  const s = holder.session;
  expect(s.oauthType).toBe('user');
  expect(s.oauthProvider).toBe('pingone');
  expect(s.consentAcr).toBe('Multi_Factor');
  expect(s.mayAct).toEqual({ sub: 'agent' });
  expect(s.hostedLoginAudit).toEqual({ id: 'audit-1' });
  expect(s.hostedLoginAudits).toEqual([{ id: 'audit-1' }]);
  expect(s.hostedStamp).toBe('stamped');
  expect(stampHostedAccessApproval).toHaveBeenCalledWith(s, expect.objectContaining({ allowed: true }), expect.anything());
  expect(finishLoginAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: 'success', reasonCode: 'allowed' }));
  expect(setAuthCookie).toHaveBeenCalledTimes(1);
  expect(clearAuthCookie).not.toHaveBeenCalled();
});
