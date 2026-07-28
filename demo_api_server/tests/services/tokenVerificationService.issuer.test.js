/**
 * tokenVerificationService — issuer validation (RFC 7519 §4.1.1).
 *
 * A verifier that checks only the signature accepts a correctly-signed token
 * from the WRONG issuer. jsonwebtoken enforces `issuer` so the check cannot
 * drift from the parse.
 *
 * Enforced only when an issuer is configured: getIssuer() returns '' on an
 * unconfigured environment, and passing '' would reject every token.
 */
'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ISSUER = 'https://auth.pingone.com/env-123/as';

let mockIssuer = ISSUER;
jest.mock('../../services/oauthEndpointResolver', () => ({
  getIssuer: () => mockIssuer,
}));
jest.mock('../../services/jwksService', () => ({ getPublicKey: jest.fn() }));
jest.mock('../../services/tokenIntrospectionService', () => ({ validateToken: jest.fn() }));

const jwksService = require('../../services/jwksService');
const { verifyExchangedToken } = require('../../services/tokenVerificationService');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const sign = (claims) => jwt.sign(claims, privateKey, { algorithm: 'RS256', keyid: 'kid-1' });
const base = (over = {}) => ({
  sub: 'u1',
  iss: ISSUER,
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...over,
});

beforeEach(() => {
  mockIssuer = ISSUER;
  jwksService.getPublicKey.mockResolvedValue({ keyObject: publicKey, alg: 'RS256' });
});

test('verifies a correctly-signed token from the expected issuer', async () => {
  const r = await verifyExchangedToken(sign(base()));
  expect(r.verified).toBe(true);
  expect(r.claims.sub).toBe('u1');
});

// The whole point: the signature is valid, the issuer is not.
test('REJECTS a correctly-signed token from a different issuer', async () => {
  const r = await verifyExchangedToken(sign(base({ iss: 'https://evil.example/as' })));
  expect(r.verified).toBe(false);
});

test('reports an issuer mismatch distinctly from a signature failure', async () => {
  const r = await verifyExchangedToken(sign(base({ iss: 'https://evil.example/as' })));
  const message = r.error || r.warning || '';
  expect(message).toMatch(/issuer mismatch/i);
  // The classic misconfiguration (oauth_issuer missing the /as suffix) must not
  // masquerade as a broken signature — that made it undiagnosable before.
  expect(message).not.toMatch(/signature invalid/i);
});

test('REJECTS a token with no iss claim at all', async () => {
  const claims = base();
  delete claims.iss;
  const r = await verifyExchangedToken(sign(claims));
  expect(r.verified).toBe(false);
});

// getIssuer() returns '' on an unconfigured environment. Passing '' to
// jsonwebtoken would reject every token; omission means "unknown".
test('skips the issuer check when no issuer is configured', async () => {
  mockIssuer = '';
  const r = await verifyExchangedToken(sign(base({ iss: 'https://anything.example/as' })));
  expect(r.verified).toBe(true);
});
