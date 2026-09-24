'use strict';

const express = require('express');
const request = require('supertest');
const oauthUserRouter = require('../../routes/oauthUser');
const configStore = require('../../services/configStore');
const { buildPingOneSignoffUrl } = require('../../services/sessionCookies');
const oauthUserService = require('../../services/oauthUserService');

const UC40 = 'enterprise-managed-mcp-authorization';
const intent = { useCaseId: UC40, mode: 'live-id-jag', message: 'show my balance', returnTo: '/pingfederate-id-jag/demo' };

function appFor(sessionState = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = sessionState;
    req.session.save = (cb) => cb(null);
    next();
  });
  app.use('/api/auth/oauth/user', oauthUserRouter);
  return app;
}

describe('one-shot ID-JAG login intent', () => {
  afterEach(() => jest.restoreAllMocks());

  test('accepts UC40 and a same-origin path, then consumes exactly once', () => {
    const req = { session: {}, headers: {} };
    const saved = oauthUserRouter.setPendingIdJagRun(req, intent);
    const afterLogout = { session: {}, headers: { cookie: `_id_jag_run=${saved.nonce}` } };
    expect(saved).toEqual(expect.objectContaining({ ...intent, createdAt: expect.any(Number), nonce: expect.any(String) }));
    expect(oauthUserRouter.consumePendingIdJagRun(afterLogout)).toEqual(saved);
    expect(oauthUserRouter.consumePendingIdJagRun(afterLogout)).toBeNull();
  });

  test.each([
    { ...intent, useCaseId: 'other' },
    { ...intent, mode: 'mock-id-jag' },
    { ...intent, returnTo: 'https://evil.example/path' },
    { ...intent, returnTo: '//evil.example/path' },
    { ...intent, returnTo: '/dashboard?next=https://evil.example' },
  ])('rejects an untrusted run or return path', (bad) => {
    expect(() => oauthUserRouter.setPendingIdJagRun({ session: {} }, bad)).toThrow();
  });

  test('expires after five minutes and cannot be resumed', () => {
    const req = { session: {}, headers: {} };
    const saved = oauthUserRouter.setPendingIdJagRun(req, intent);
    req.headers.cookie = `_id_jag_run=${saved.nonce}`;
    jest.spyOn(Date, 'now').mockReturnValue(saved.createdAt + 5 * 60 * 1000 + 1);
    expect(oauthUserRouter.consumePendingIdJagRun(req)).toBeNull();
  });

  test('clear removes a pending handoff', () => {
    const req = { session: {}, headers: {} };
    const saved = oauthUserRouter.setPendingIdJagRun(req, intent);
    req.headers.cookie = `_id_jag_run=${saved.nonce}`;
    oauthUserRouter.clearPendingIdJagRun(req);
    expect(oauthUserRouter.consumePendingIdJagRun(req)).toBeNull();
  });

  test('capacity evicts the oldest live intent while retaining the newest', () => {
    const first = oauthUserRouter.setPendingIdJagRun({ session: {}, headers: {} }, intent);
    let newest;
    for (let i = 0; i < 256; i++) {
      newest = oauthUserRouter.setPendingIdJagRun({ session: {}, headers: {} }, intent);
    }
    const lookup = (nonce) => ({ headers: { cookie: `_id_jag_run=${nonce}` } });
    expect(oauthUserRouter.pendingIdJagRun(lookup(first.nonce))).toBeNull();
    expect(oauthUserRouter.pendingIdJagRun(lookup(newest.nonce))).toEqual(newest);
  });

  test('clear-session continuation is one-shot and requires a verified logout marker', () => {
    const direct = oauthUserRouter.setPendingIdJagRun({ session: {}, headers: {} }, intent);
    const directReq = { headers: { cookie: `_id_jag_run=${direct.nonce}` }, session: {} };
    expect(oauthUserRouter.consumeVerifiedIdJagLogoutContinuation(directReq)).toBe(false);
    oauthUserRouter.clearPendingIdJagRun(directReq);
    expect(oauthUserRouter.pendingIdJagRun(directReq)).toBeNull();

    const handoffSession = {};
    const handoff = oauthUserRouter.setPendingIdJagRun({ session: handoffSession, headers: {} }, intent);
    const handoffReq = { headers: { cookie: `_id_jag_run=${handoff.nonce}` }, session: handoffSession };
    expect(oauthUserRouter.markVerifiedIdJagLogoutContinuation(handoffReq)).toBe(true);
    expect(oauthUserRouter.consumeVerifiedIdJagLogoutContinuation(handoffReq)).toBe(true);
    expect(oauthUserRouter.pendingIdJagRun(handoffReq)).toEqual(handoff);
    expect(oauthUserRouter.consumeVerifiedIdJagLogoutContinuation(handoffReq)).toBe(false);
  });

  test('the real clear-session endpoint drops an unverified pending intent', async () => {
    const app = require('../../server');
    const activeRouter = require('../../routes/oauthUser');
    const saved = activeRouter.setPendingIdJagRun({ session: {}, headers: {} }, intent);
    const cookie = `_id_jag_run=${saved.nonce}`;
    const cleared = await request(app).post('/api/auth/clear-session').set('Cookie', cookie);
    expect(cleared.status).toBe(200);
    expect(activeRouter.pendingIdJagRun({ headers: { cookie } })).toBeNull();
    expect(cleared.headers['set-cookie'].join(';')).toContain('_id_jag_run=');
  });

  test('the real clear-session endpoint preserves only one verified logout continuation', async () => {
    const app = require('../../server');
    const activeRouter = require('../../routes/oauthUser');
    const session = {};
    const saved = activeRouter.setPendingIdJagRun({ session, headers: {} }, intent);
    const cookie = `_id_jag_run=${saved.nonce}`;
    expect(activeRouter.markVerifiedIdJagLogoutContinuation({ session, headers: { cookie } })).toBe(true);
    const first = await request(app).post('/api/auth/clear-session').set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(activeRouter.pendingIdJagRun({ headers: { cookie } })).not.toBeNull();
    const second = await request(app).post('/api/auth/clear-session').set('Cookie', cookie);
    expect(second.status).toBe(200);
    expect(activeRouter.pendingIdJagRun({ headers: { cookie } })).toBeNull();
  });

  test('route exposes only a same-origin one-shot handoff and rejects another origin', async () => {
    const originalGetEffective = configStore.getEffective.bind(configStore);
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => key === 'public_app_url'
      ? 'https://local.ping-devops.com:4000' : originalGetEffective(key));
    const app = appFor();
    const rejected = await request(app).post('/api/auth/oauth/user/id-jag/intent')
      .set('Origin', 'https://evil.example').send(intent);
    expect(rejected.status).toBe(403);
    const accepted = await request(app).post('/api/auth/oauth/user/id-jag/intent')
      .set('Origin', 'https://local.ping-devops.com:4000').send(intent);
    expect(accepted.status).toBe(201);
    expect(accepted.body).toEqual(expect.objectContaining({ returnTo: intent.returnTo, mode: intent.mode }));
    expect(accepted.body).not.toHaveProperty('nonce');
    const cookie = accepted.headers['set-cookie'].find((entry) => entry.startsWith('_id_jag_run='));
    expect(cookie).toMatch(/HttpOnly/);
    const pending = await request(app).get('/api/auth/oauth/user/id-jag/pending').set('Cookie', cookie);
    expect(pending.body).toEqual(expect.objectContaining({ pending: true, returnTo: intent.returnTo }));
  });

  test('PF login may claim the pending handoff while PingOne login cannot', () => {
    const req = { session: {}, headers: {} };
    const saved = oauthUserRouter.setPendingIdJagRun(req, intent);
    req.headers.cookie = `_id_jag_run=${saved.nonce}`;
    jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingone');
    expect(oauthUserRouter.claimPendingIdJagRunForLogin(req, intent.returnTo)).toBeNull();
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    expect(oauthUserRouter.claimPendingIdJagRunForLogin(req, intent.returnTo)).toEqual(saved);
  });

  test('normal login clears the handoff before starting ordinary OAuth', async () => {
    const session = {};
    const saved = oauthUserRouter.setPendingIdJagRun({ session }, intent);
    jest.spyOn(configStore, 'isUserOAuthConfigured').mockReturnValue(false);
    const res = await request(appFor(session)).get('/api/auth/oauth/user/login')
      .set('Cookie', `_id_jag_run=${saved.nonce}`);
    expect(res.status).toBe(302);
    expect(oauthUserRouter.pendingIdJagRun({ headers: { cookie: `_id_jag_run=${saved.nonce}` } })).toBeNull();
  });

  test('live PF login binds the intent to the OAuth transaction and prompts for credentials', async () => {
    const session = {};
    const saved = oauthUserRouter.setPendingIdJagRun({ session }, intent);
    const originalGetEffective = configStore.getEffective.bind(configStore);
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => ({
      public_app_url: 'https://local.ping-devops.com:4000',
      user_redirect_uri: 'https://local.ping-devops.com:4000/api/auth/oauth/user/callback',
    })[key] || originalGetEffective(key));
    jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingfederate');
    jest.spyOn(configStore, 'isUserOAuthConfigured').mockReturnValue(true);
    jest.spyOn(oauthUserService, 'generateState').mockReturnValue('state-1');
    jest.spyOn(oauthUserService, 'generateCodeVerifier').mockReturnValue('verifier-1');
    jest.spyOn(oauthUserService, 'generateAuthorizationUrl').mockImplementation(({ prompt }) =>
      `https://pf.example.test/as/authorization.oauth2?prompt=${prompt}`);
    const res = await request(appFor(session)).get('/api/auth/oauth/user/login')
      .query({ mode: 'live-id-jag', return_to: intent.returnTo })
      .set('Cookie', `_id_jag_run=${saved.nonce}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://pf.example.test/as/authorization.oauth2?prompt=login');
    expect(session.oauthLoginProvider).toBe('pingfederate');
    expect(session.pendingIdJagNonce).toBe(saved.nonce);
  });

  test('logout endpoint selection honors the session provider after a provider toggle', () => {
    jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingfederate');
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => ({
      pingone_environment_id: 'env-1', pingone_region: 'com', pingone_user_client_id: 'p1-client',
    }[key] || ''));
    const url = buildPingOneSignoffUrl('https://local.ping-devops.com:4000/logout', 'pingone_user_client_id', null, 'pingone');
    expect(url).toContain('https://auth.pingone.com/env-1/as/signoff?');
    expect(url).toContain('client_id=p1-client');
  });

  test('PF session logout uses PF end-session even after the global provider switches to PingOne', () => {
    jest.spyOn(configStore, 'getOAuthProvider').mockReturnValue('pingone');
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => ({
      pf_end_session_endpoint: 'https://pf.example.test/idp/init_logout.openid',
      pf_user_client_id: 'pf-client',
    })[key] || '');
    const url = buildPingOneSignoffUrl('https://local.ping-devops.com:4000/logout', 'pingone_user_client_id', null, 'pingfederate');
    expect(url).toContain('https://pf.example.test/idp/init_logout.openid?');
    expect(url).toContain('client_id=pf-client');
  });
});
