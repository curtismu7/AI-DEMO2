'use strict';

/**
 * OIDC nonce enforcement on the DaVinci widget login callback (OIDC Core
 * §3.1.3.7). POST /api/davinci-login/nonce binds a single-use nonce to the
 * session; the UI sends it on client.start({ query: { nonce } }) so PingOne
 * echoes it in the ID token; POST /callback verifies the echo. Missing or
 * mismatched nonce fails the callback — never warn-and-proceed (same rule as
 * routes/oauthUser.js post-#2043).
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
};
const mockDataStore = {
  getUserByUsername: jest.fn(),
};
jest.mock('../services/oauthService', () => mockOauthService);
jest.mock('../data/store', () => mockDataStore);

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

beforeEach(() => {
  jest.clearAllMocks();
});

test('POST /nonce returns a fresh nonce', async () => {
  const res = await request(makeApp()).post('/api/davinci-login/nonce');
  expect(res.status).toBe(200);
  expect(res.body.nonce).toMatch(/^[0-9a-f]{32}$/);
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
  await agent.post('/api/davinci-login/nonce');

  const res = await agent.post('/api/davinci-login/callback').send(CALLBACK_BODY);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('nonce_missing');
  expect(mockOauthService.exchangeCodeForToken).toHaveBeenCalledTimes(1);
  expect(mockOauthService.getUserInfo).not.toHaveBeenCalled();
});

test('FAILS when the ID token nonce does not match the session nonce', async () => {
  mockExchange({ sub: 'u1', nonce: 'attacker-nonce' });
  const agent = request.agent(makeApp());
  await agent.post('/api/davinci-login/nonce');

  const res = await agent.post('/api/davinci-login/callback').send(CALLBACK_BODY);

  expect(res.status).toBe(401);
  expect(res.body.error).toBe('nonce_mismatch');
  expect(mockOauthService.getUserInfo).not.toHaveBeenCalled();
});

test('succeeds when the ID token echoes the issued nonce, and the nonce is single-use', async () => {
  const agent = request.agent(makeApp());
  const { body } = await agent.post('/api/davinci-login/nonce');
  mockExchange({ sub: 'u1', nonce: body.nonce });

  const res = await agent.post('/api/davinci-login/callback').send(CALLBACK_BODY);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });

  // Replaying the identical callback must fail: the nonce was consumed.
  const replay = await agent.post('/api/davinci-login/callback').send(CALLBACK_BODY);
  expect(replay.status).toBe(401);
  expect(replay.body.error).toBe('nonce_missing');
});
