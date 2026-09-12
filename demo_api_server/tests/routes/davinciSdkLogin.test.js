'use strict';
// The load-bearing assertion here is the first one: the exchange must carry the
// DaVinci SDK app's client_id, never the admin client. Getting that wrong
// returns invalid_grant from PingOne, and the obvious "simplification" —
// routing this through oauthService.exchangeCodeForToken like the widget path
// does — reintroduces it silently. Everything else guards the nonce and the
// existing-user-only rule.

const request = require('supertest');
const express = require('express');
const session = require('express-session');

jest.mock('../../services/oauthService', () => ({
  getUserInfo: jest.fn(),
  createUserFromOAuth: jest.fn(),
}));

jest.mock('../../data/store', () => ({
  getUserByUsername: jest.fn(),
}));

// Explicit factory, NOT bare jest.mock('axios'). With the automock, this suite
// saw the route's axios.post return undefined while the test's own handle was
// correctly armed (verified: getMockImplementation() was a function and a direct
// call returned the stubbed payload) — two different objects. A factory returns
// one plain object that both the test and the route resolve to.
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
// Config comes from the FACTORY, driven by a mock-prefixed variable (the only
// kind jest lets a factory close over). jest.config sets `clearMocks: true`,
// and a per-test mockImplementation proved unreliable against it — only the
// first test saw the value and every later one 503'd. A flag the factory reads
// on each call has no ordering dependency at all.
//
// The explicit redirect key is used rather than pingone_public_app_url so this
// suite cannot perturb any other consumer of that base URL.
let mockAppId = '4e122cbf-defe-4c39-a5b5-c6b7da2b63f1';
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'pingone_davinci_login_app_id') return mockAppId;
    if (key === 'pingone_davinci_sdk_login_redirect_uri') {
      return 'https://local.ping-devops.com:4000/davinci-sdk-login';
    }
    return '';
  }),
}));
jest.mock('../../services/oauthEndpointResolver', () => ({
  getDiscoveryEndpoint: jest.fn(() => 'https://auth.pingone.com/env-1/as/.well-known/openid-configuration'),
  getTokenEndpoint: jest.fn(() => 'https://auth.pingone.com/env-1/as/token'),
}));

const axios = require('axios');
const configStore = require('../../services/configStore');
const oauthService = require('../../services/oauthService');
const dataStore = require('../../data/store');

const SDK_APP_ID = '4e122cbf-defe-4c39-a5b5-c6b7da2b63f1';
const PUBLIC_BASE = 'https://local.ping-devops.com:4000';
const EXPECTED_REDIRECT = `${PUBLIC_BASE}/davinci-sdk-login`;

function idTokenWithNonce(nonce) {
  const payload = Buffer.from(JSON.stringify({ nonce })).toString('base64url');
  return `h.${payload}.s`;
}

// Required ONCE, at module scope — deliberately not inside buildApp().
//
// src/__tests__/setup.js (setupFilesAfterEach) runs a global afterEach that
// calls jest.resetModules(). Re-requiring the router per test therefore hands it
// a FRESH copy of every mocked module, while the `axios` / `configStore` handles
// imported at the top of this file still point at the originals. The route then
// calls a different axios.post than the one the test armed, which returns
// undefined — so the first test passes and every later one fails with
// "Cannot destructure property 'data' of undefined". Requiring here binds the
// route to the same mock instances this file holds, for the whole run.
const davinciSdkLoginRouter = require('../../routes/davinciSdkLogin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 't', resave: false, saveUninitialized: false }));
  app.use('/api/davinci-sdk-login', davinciSdkLoginRouter);
  return app;
}

describe('routes/davinciSdkLogin', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    // Deliberately NO jest.resetModules(): it hands the route a fresh instance
    // of the mocked configStore while the handle imported at the top of this
    // file still points at the old one, so every mockImplementation set here
    // would be invisible to the code under test and /start would 503.
    mockAppId = SDK_APP_ID;
    app = buildApp();
  });

  describe('POST /start', () => {
    it('returns the non-secret config the SDK needs, including a nonce', async () => {
      const res = await request(app).post('/api/davinci-sdk-login/start').expect(200);
      expect(res.body).toMatchObject({
        clientId: SDK_APP_ID,
        redirectUri: EXPECTED_REDIRECT,
        scope: 'openid profile email',
        wellknown: 'https://auth.pingone.com/env-1/as/.well-known/openid-configuration',
      });
      expect(res.body.nonce).toMatch(/^[0-9a-f]{32}$/);
    });

    it('makes NO upstream call — the SDK talks to PingOne directly', async () => {
      // Unlike the widget's /sdk-token there is no DaVinci SDK token to mint,
      // so requiring companyId/policyId/apiKey here would be dead weight.
      await request(app).post('/api/davinci-sdk-login/start').expect(200);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('503s naming the exact missing key when the app id is unset', async () => {
      mockAppId = '';
      const res = await request(app).post('/api/davinci-sdk-login/start').expect(503);
      expect(res.body.error).toBe('davinci_sdk_not_configured');
      expect(res.body.missing.join(' ')).toContain('PINGONE_DAVINCI_LOGIN_APP_ID');
    });
  });

  describe('POST /callback', () => {
    const agent = () => request.agent(app);

    async function armed() {
      const a = agent();
      const res = await a.post('/api/davinci-sdk-login/start').expect(200);
      return { a, nonce: res.body.nonce };
    }

    function happyUpstream(nonce) {
      axios.post.mockResolvedValue({
        data: {
          access_token: 'at',
          id_token: idTokenWithNonce(nonce),
          refresh_token: 'rt',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      });
      oauthService.getUserInfo.mockResolvedValue({ sub: 's', preferred_username: 'customer1' });
      oauthService.createUserFromOAuth.mockReturnValue({ username: 'customer1' });
      dataStore.getUserByUsername.mockReturnValue({ id: 'u1', username: 'customer1', role: 'customer' });
    }

    it('exchanges with the DaVinci app client_id and PKCE, never a secret', async () => {
      const { a, nonce } = await armed();
      happyUpstream(nonce);

      await a
        .post('/api/davinci-sdk-login/callback')
        .send({ code: 'c', codeVerifier: 'v' })
        .expect(200, { ok: true });

      const [url, body] = axios.post.mock.calls[0];
      expect(url).toBe('https://auth.pingone.com/env-1/as/token');
      const form = new URLSearchParams(body);
      expect(form.get('client_id')).toBe(SDK_APP_ID);
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('code_verifier')).toBe('v');
      expect(form.get('redirect_uri')).toBe(EXPECTED_REDIRECT);
      // Public client: PKCE proves possession, so no secret may be sent.
      expect(form.get('client_secret')).toBeNull();
      expect(body).not.toContain('client_secret');
    });

    it('ignores a body-supplied redirectUri and uses the server-derived one', async () => {
      // The browser built the authorize request, so honouring a body value
      // would let a caller steer redirect_uri at the token endpoint.
      const { a, nonce } = await armed();
      happyUpstream(nonce);

      await a
        .post('/api/davinci-sdk-login/callback')
        .send({ code: 'c', codeVerifier: 'v', redirectUri: 'https://evil.example/steal' })
        .expect(200);

      const form = new URLSearchParams(axios.post.mock.calls[0][1]);
      expect(form.get('redirect_uri')).toBe(EXPECTED_REDIRECT);
    });

    it('401s when no flow was armed in this session', async () => {
      const res = await request(app)
        .post('/api/davinci-sdk-login/callback')
        .send({ code: 'c', codeVerifier: 'v' })
        .expect(401);
      expect(res.body.error).toBe('nonce_missing');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('401s on an ID-token nonce mismatch rather than warning and proceeding', async () => {
      const { a } = await armed();
      happyUpstream('a-different-nonce');
      const res = await a
        .post('/api/davinci-sdk-login/callback')
        .send({ code: 'c', codeVerifier: 'v' })
        .expect(401);
      expect(res.body.error).toBe('nonce_mismatch');
    });

    it('401s when the ID token carries no nonce at all', async () => {
      const { a } = await armed();
      axios.post.mockResolvedValue({ data: { access_token: 'at', id_token: 'not.a.jwt', expires_in: 3600 } });
      const res = await a
        .post('/api/davinci-sdk-login/callback')
        .send({ code: 'c', codeVerifier: 'v' })
        .expect(401);
      expect(res.body.error).toBe('nonce_missing');
    });

    it('spends the nonce once — a replayed code cannot reuse it', async () => {
      const { a, nonce } = await armed();
      happyUpstream(nonce);
      await a.post('/api/davinci-sdk-login/callback').send({ code: 'c', codeVerifier: 'v' }).expect(200);

      const res = await a
        .post('/api/davinci-sdk-login/callback')
        .send({ code: 'c', codeVerifier: 'v' })
        .expect(401);
      expect(res.body.error).toBe('nonce_missing');
    });

    it('404s for an unknown user and never creates one', async () => {
      const { a, nonce } = await armed();
      happyUpstream(nonce);
      dataStore.getUserByUsername.mockReturnValue(undefined);

      const res = await a
        .post('/api/davinci-sdk-login/callback')
        .send({ code: 'c', codeVerifier: 'v' })
        .expect(404);
      expect(res.body.error).toBe('user_not_found');
      // No auto-create, no auto-admin, unlike routes/oauth.js's admin flow.
      expect(dataStore.createUser).toBeUndefined();
    });

    it('400s without code or codeVerifier', async () => {
      const { a } = await armed();
      await a.post('/api/davinci-sdk-login/callback').send({ code: 'c' }).expect(400);
      await a.post('/api/davinci-sdk-login/callback').send({ codeVerifier: 'v' }).expect(400);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('400s on an over-long code or verifier at the trust boundary', async () => {
      const { a } = await armed();
      await a
        .post('/api/davinci-sdk-login/callback')
        .send({ code: 'x'.repeat(4097), codeVerifier: 'v' })
        .expect(400);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('does not touch the widget path\'s session keys', async () => {
      // Distinct keys mean a user with both pages open cannot have one consume
      // the other's armed nonce.
      const src = require('fs').readFileSync(require.resolve('../../routes/davinciSdkLogin'), 'utf8');
      expect(src).toContain('davinciSdkLoginNonce');
      expect(src).not.toContain('davinciLoginNonce');
    });
  });
});
