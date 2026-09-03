'use strict';

/**
 * OIDC nonce enforcement on the DaVinci widget login callback (OIDC Core
 * §3.1.3.7). POST /api/davinci-login/sdk-token arms a single-use nonce on the
 * session and bakes it into the authorize URL it returns, so PingOne echoes it
 * in the ID token; POST /callback verifies the echo. Missing or mismatched
 * nonce fails the callback — never warn-and-proceed (same rule as
 * routes/oauthUser.js post-#2043).
 *
 * Arming goes through the real /sdk-token route rather than a hand-seeded
 * session: that is the only way a nonce gets armed in production, so a change
 * that stops arming one shows up here.
 *
 * Mocks use factories returning module-scope singletons (not automock): the
 * suite observed jest hand the route a SECOND automock instance mid-file, so
 * implementations set on the test's instance never reached the route. A
 * factory returns the same object to every registry instance.
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');

const mockOauthService = {
  exchangeCodeForToken: jest.fn(),
  getUserInfo: jest.fn(),
  createUserFromOAuth: jest.fn(),
  generateState: jest.fn(() => 'state-1'),
  generateCodeVerifier: jest.fn(() => 'verifier-1'),
  // Positional (state, codeVerifier, redirectUri, nonce) — matches the real
  // oauthService, which is also the service that signs the exchange.
  generateAuthorizationUrl: jest.fn(
    (state, _cv, redirectUri, nonce) =>
      `https://auth.pingone.com/env-1/as/authorize?state=${state}&nonce=${nonce}&redirect_uri=${encodeURIComponent(redirectUri)}`
  ),
};
const mockDataStore = {
  getUserByUsername: jest.fn(),
};
jest.mock('../services/oauthService', () => mockOauthService);
jest.mock('../data/store', () => mockDataStore);
// Module-scope singletons for the same reason as the mocks above: setup.js
// calls jest.resetModules() between tests, and makeApp() re-requires the route,
// so an automock would hand the route a FRESH axios while this file kept the
// old handle — every mockResolvedValue set here would miss.
const mockAxios = { post: jest.fn() };
const mockConfigStore = {
  // The DaVinci API key is a vault secret, cached into configStore under the
  // lowercased name by services/vaultLoader.js — never into process.env.
  getEffective: jest.fn((k) => (k === 'pingone_davinci_api_key' ? 'sk-secret-key' : '')),
};
const mockResolver = {
  getDiscoveryEndpoint: jest.fn(
    () => 'https://auth.pingone.com/env-1/as/.well-known/openid-configuration'
  ),
};
jest.mock('axios', () => mockAxios);
jest.mock('../services/configStore', () => mockConfigStore);
jest.mock('../services/oauthEndpointResolver', () => mockResolver);

const DAVINCI_ENV = {
  PINGONE_DAVINCI_LOGIN_COMPANY_ID: 'co-1',
  PINGONE_DAVINCI_LOGIN_POLICY_ID_V1: 'pol-v1',
};

/** Arms a nonce the way production does, and returns it. */
async function arm(agent) {
  mockAxios.post.mockResolvedValue({ data: { access_token: 'sdk-tok' } });
  const res = await agent.post('/api/davinci-login/sdk-token');
  // The nonce never comes back over the wire — read it off the authorize URL
  // the route built, which is the same value it bound to the session.
  return new URL(res.body.authorizeUrl).searchParams.get('nonce');
}

/** header.payload.sig with the given claims as the base64url payload. */
const idToken = (claims) =>
  'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'davinci-nonce-test', resave: false, saveUninitialized: true }));
  app.use('/api/davinci-login', require('../routes/davinciLogin'));
  return app;
}

const CALLBACK_BODY = {
  code: 'c-1',
  codeVerifier: 'cv-1',
  redirectUri: 'https://local.ping-devops.com:4000/davinci-login/callback',
};

function mockExchange(claims) {
  mockOauthService.exchangeCodeForToken.mockResolvedValue({
    access_token: 'at',
    id_token: idToken(claims),
    refresh_token: 'rt',
    expires_in: 3600,
  });
  mockOauthService.getUserInfo.mockResolvedValue({ preferred_username: 'demouser' });
  mockOauthService.createUserFromOAuth.mockReturnValue({ username: 'demouser' });
  mockDataStore.getUserByUsername.mockReturnValue({ id: 'u-1', username: 'demouser', role: 'customer' });
}

const savedEnv = {};
beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(DAVINCI_ENV).forEach((k) => {
    savedEnv[k] = process.env[k];
    process.env[k] = DAVINCI_ENV[k];
  });
});
afterEach(() => {
  Object.keys(DAVINCI_ENV).forEach((k) => {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  });
});

test('POST /sdk-token arms a fresh nonce and never returns it', async () => {
  const agent = request.agent(makeApp());
  mockAxios.post.mockResolvedValue({ data: { access_token: 'sdk-tok' } });

  const res = await agent.post('/api/davinci-login/sdk-token');

  expect(res.status).toBe(200);
  const nonce = new URL(res.body.authorizeUrl).searchParams.get('nonce');
  expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  expect(JSON.stringify(res.body)).not.toContain('verifier-1');
});

test('callback with no nonce bound to the session is refused before the code is spent', async () => {
  const res = await request(makeApp())
    .post('/api/davinci-login/callback')
    .send(CALLBACK_BODY);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('nonce_missing');
  expect(mockOauthService.exchangeCodeForToken).not.toHaveBeenCalled();
});

test('FAILS when the ID token omits the nonce claim', async () => {
  mockExchange({ sub: 'u1' }); // no `nonce`
  const agent = request.agent(makeApp());
  await arm(agent);

  const res = await agent.post('/api/davinci-login/callback').send(CALLBACK_BODY);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('nonce_missing');
  expect(mockOauthService.exchangeCodeForToken).toHaveBeenCalledTimes(1);
  expect(mockOauthService.getUserInfo).not.toHaveBeenCalled();
});

test('FAILS when the ID token nonce does not match the session nonce', async () => {
  mockExchange({ sub: 'u1', nonce: 'attacker-nonce' });
  const agent = request.agent(makeApp());
  await arm(agent);

  const res = await agent.post('/api/davinci-login/callback').send(CALLBACK_BODY);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('nonce_mismatch');
  expect(mockOauthService.getUserInfo).not.toHaveBeenCalled();
});

test('succeeds when the ID token echoes the issued nonce, and the nonce is single-use', async () => {
  const agent = request.agent(makeApp());
  const nonce = await arm(agent);
  mockExchange({ sub: 'u1', nonce });

  const res = await agent.post('/api/davinci-login/callback').send(CALLBACK_BODY);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });

  // Replaying the identical callback must fail: the nonce was consumed.
  const replay = await agent.post('/api/davinci-login/callback').send(CALLBACK_BODY);
  expect(replay.status).toBe(401);
  expect(replay.body.error).toBe('nonce_missing');
});
