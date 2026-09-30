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
// validateIdToken verifies the ID token signature against the provider's JWKS
// before it looks at the nonce. Stub only that signature step (returning the
// token's own claims) so the REAL validateIdToken still runs and the nonce gate
// is what these tests reach.
jest.mock('../services/tokenValidationService', () => ({ validateToken: jest.fn() }));
jest.mock('../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingone'),
  getEffective: jest.fn(() => ''),
  isUserOAuthConfigured: jest.fn(() => true),
}));

const oauthService = require('../services/oauthUserService');
const configStore = require('../services/configStore');
const { validateToken } = require('../services/tokenValidationService');

const OIDC_CONFIG = {
  jwksEndpoint: 'https://idp.example/jwks',
  issuer: 'https://idp.example/as',
  clientId: 'test-client',
};

/** header.payload.sig with an RS256 header and the claims as the base64url payload. */
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const idToken = (claims) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.s`;

/** Claims that pass every check in validateIdToken except the ones a test varies. */
const baseClaims = (extra = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return { iss: OIDC_CONFIG.issuer, sub: 'u1', aud: OIDC_CONFIG.clientId, iat: now, exp: now + 300, ...extra };
};

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
  oauthLoginProvider: 'pingone',
};

beforeEach(() => {
  jest.clearAllMocks();
  oauthService.config = OIDC_CONFIG;
  validateToken.mockImplementation(async (token) =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()));
});

test('FAILS the callback when a nonce was requested but the ID token omits it', async () => {
  oauthService.exchangeCodeForToken.mockResolvedValue({
    access_token: 'at',
    id_token: idToken(baseClaims()), // no `nonce` claim
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
    id_token: idToken(baseClaims({ nonce: 'expected-nonce' })),
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

test('does not redeem a callback with the provider changed since login began', async () => {
  configStore.getOAuthProvider.mockReturnValue('pingone');
  const res = await request(makeApp({ ...SEED, oauthLoginProvider: 'pingfederate' }))
    .get('/api/auth/oauth/user/callback')
    .query({ code: 'c', state: 'st-1' });

  expect(res.status).toBe(302);
  expect(res.headers.location).toContain('error=provider_changed');
  expect(oauthService.exchangeCodeForToken).not.toHaveBeenCalled();
});

test('does not redeem a callback without a recorded login provider', async () => {
  const { oauthLoginProvider: _ignored, ...legacySeed } = SEED;
  const res = await request(makeApp(legacySeed))
    .get('/api/auth/oauth/user/callback')
    .query({ code: 'c', state: 'st-1' });

  expect(res.status).toBe(302);
  expect(res.headers.location).toContain('error=provider_changed');
  expect(oauthService.exchangeCodeForToken).not.toHaveBeenCalled();
});
