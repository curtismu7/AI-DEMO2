'use strict';

/**
 * OIDC nonce enforcement on the DaVinci widget login (OIDC Core §3.1.3.7).
 * POST /api/davinci-login/sdk-token arms a single-use nonce on the session and
 * passes it to the flow as a parameter; the flow's final node copies it into
 * the ID token. POST /widget-session and POST /callback verify the echo.
 * Missing or mismatched nonce fails — never warn-and-proceed (same rule as
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
  // The app the flow's final node issues the ID token to.
  config: { clientId: 'client-1' },
  exchangeCodeForToken: jest.fn(),
  getUserInfo: jest.fn(),
  createUserFromOAuth: jest.fn(),
};
const mockDataStore = {
  getUserByUsername: jest.fn(),
};
const mockVerifier = {
  verifyExchangedToken: jest.fn(),
};
jest.mock('../services/oauthService', () => mockOauthService);
jest.mock('../data/store', () => mockDataStore);
jest.mock('../services/tokenVerificationService', () => mockVerifier);
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
  PINGONE_RESOURCE_BFF_URI: 'enduser.ping.demo',
};

/** The nonce the last /sdk-token call handed the flow — the value it bound to the session. */
const lastArmedNonce = () => mockAxios.post.mock.calls.at(-1)[1].parameters.nonce;

/** Arms a nonce the way production does, and returns it. */
async function arm(agent) {
  mockAxios.post.mockResolvedValue({ data: { access_token: 'sdk-tok' } });
  await agent.post('/api/davinci-login/sdk-token').send({ username: 'demouser' });
  // The nonce never comes back over the wire — read it off the parameters the
  // route handed the flow.
  return lastArmedNonce();
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

const WIDGET_BODY = { idToken: 'id-w', accessToken: 'at-w' };

/** Both widget tokens JWKS-verify; the ID token carries `idClaims`. */
function mockWidgetTokens(idClaims) {
  mockVerifier.verifyExchangedToken.mockImplementation(async (token) => ({
    verified: true,
    fallbackMethod: 'jwks',
    claims: token === WIDGET_BODY.idToken
      ? idClaims
      : { sub: 'p1-u1', aud: ['enduser.ping.demo'], exp: Math.floor(Date.now() / 1000) + 3600, scope: 'openid read' },
  }));
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

  const res = await agent.post('/api/davinci-login/sdk-token').send({ username: 'demouser' });

  expect(res.status).toBe(200);
  const nonce = lastArmedNonce();
  expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  expect(JSON.stringify(res.body)).not.toContain(nonce);
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
  expect(res.body).toEqual({ ok: true, username: 'demouser' });

  // Replaying the identical callback must fail: the nonce was consumed.
  const replay = await agent.post('/api/davinci-login/callback').send(CALLBACK_BODY);
  expect(replay.status).toBe(401);
  expect(replay.body.error).toBe('nonce_missing');
});

test('widget-session FAILS when the ID token nonce does not match the armed one', async () => {
  const agent = request.agent(makeApp());
  await arm(agent);
  mockWidgetTokens({ sub: 'p1-u1', aud: 'client-1', nonce: 'attacker-nonce' });

  const res = await agent.post('/api/davinci-login/widget-session').send(WIDGET_BODY);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('nonce_mismatch');
  expect(mockOauthService.getUserInfo).not.toHaveBeenCalled();
});

test('widget-session succeeds when the ID token echoes the armed nonce, and the nonce is single-use', async () => {
  const agent = request.agent(makeApp());
  const nonce = await arm(agent);
  mockWidgetTokens({ sub: 'p1-u1', aud: 'client-1', nonce });

  const res = await agent.post('/api/davinci-login/widget-session').send(WIDGET_BODY);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, username: 'demouser' });

  // Replaying the same tokens must fail: the nonce was consumed.
  const replay = await agent.post('/api/davinci-login/widget-session').send(WIDGET_BODY);
  expect(replay.status).toBe(401);
  expect(replay.body.error).toBe('nonce_missing');
});
