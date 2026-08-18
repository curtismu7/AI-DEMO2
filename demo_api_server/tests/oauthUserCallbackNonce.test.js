'use strict';

/**
 * OIDC nonce enforcement on the end-user OAuth callback (OIDC Core §3.1.3.7).
 *
 * When the client sent a nonce in the authorization request it MUST verify a
 * matching nonce is present in the ID token. A missing nonce (an ID token that
 * simply omits the claim) is a verification FAILURE — a replayed or forged ID
 * token could just leave it out — and must fail the callback exactly like a
 * nonce mismatch, not warn-and-proceed.
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');

// Auto-mock the OAuth service so we control the token exchange result. Auto-mock
// replaces every export with a jest.fn(); only exchangeCodeForToken/getUserInfo
// are exercised on the callback path up to (and just past) the nonce gate.
jest.mock('../services/oauthUserService');

const oauthService = require('../services/oauthUserService');

/** header.payload.sig with the given claims as the base64url payload. */
const idToken = (claims) =>
  'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';

function makeApp(seed) {
  const app = express();
  app.use(session({ secret: 'nonce-test', resave: false, saveUninitialized: true }));
  // Seed the session the /login step would have written (state, nonce, PKCE).
  app.use((req, _res, next) => { Object.assign(req.session, seed); next(); });
  app.use('/api/auth/oauth/user', require('../routes/oauthUser'));
  return app;
}

const SEED = {
  oauthState: 'st-1',
  oauthNonce: 'expected-nonce',
  oauthCodeVerifier: 'cv-1',
  oauthRedirectUri: 'https://api.ping.demo:4000/api/auth/oauth/user/callback',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('FAILS the callback when a nonce was requested but the ID token omits it', async () => {
  oauthService.exchangeCodeForToken.mockResolvedValue({
    access_token: 'at',
    id_token: idToken({ sub: 'u1' }), // no `nonce` claim
  });

  const res = await request(makeApp(SEED))
    .get('/api/auth/oauth/user/callback')
    .query({ code: 'c', state: 'st-1' });

  expect(res.status).toBe(302);
  expect(res.headers.location).toContain('error=nonce_missing');
});

test('does NOT emit a nonce error when the ID token carries the matching nonce', async () => {
  oauthService.exchangeCodeForToken.mockResolvedValue({
    access_token: 'at',
    id_token: idToken({ sub: 'u1', nonce: 'expected-nonce' }),
  });
  // Force a downstream failure AFTER the nonce gate so the flow ends in the
  // generic callback catch — proving the nonce gate itself was passed, not that
  // the whole happy path succeeded (which would need the full user/session mocks).
  oauthService.getUserInfo.mockRejectedValue(new Error('boom'));

  const res = await request(makeApp(SEED))
    .get('/api/auth/oauth/user/callback')
    .query({ code: 'c', state: 'st-1' });

  expect(res.status).toBe(302);
  expect(res.headers.location).not.toContain('error=nonce_missing');
  expect(res.headers.location).not.toContain('error=nonce_mismatch');
});
