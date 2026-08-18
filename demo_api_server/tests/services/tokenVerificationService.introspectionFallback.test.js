/**
 * tokenVerificationService — JWKS-unavailable introspection fallback.
 *
 * When JWKS is momentarily unavailable the verifier falls back to RFC 7662
 * introspection. Two "token could not be confirmed active" outcomes must NOT be
 * conflated:
 *
 *   - PingOne actively reports the token INACTIVE  → reject (fail-closed).
 *   - Introspection simply ISN'T CONFIGURED        → the check was SKIPPED, not
 *     a rejection. A valid exchanged token must not be rejected just because
 *     introspection happens to be off — otherwise a transient JWKS blip plus an
 *     unconfigured introspector rejects good tokens in fail-closed mode.
 *
 * Runs in FAIL-CLOSED mode (JWKS_VERIFY_FAIL_OPEN=false) — that is the mode
 * where the two outcomes diverge, so it is where the fix matters.
 */
'use strict';

process.env.JWKS_VERIFY_FAIL_OPEN = 'false';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ISSUER = 'https://auth.pingone.com/env-123/as';

jest.mock('../../services/oauthEndpointResolver', () => ({ getIssuer: () => ISSUER }));
jest.mock('../../services/jwksService', () => ({ getPublicKey: jest.fn() }));
jest.mock('../../services/tokenIntrospectionService', () => ({ validateToken: jest.fn() }));

const jwksService = require('../../services/jwksService');
const tokenIntrospectionService = require('../../services/tokenIntrospectionService');
const { verifyExchangedToken } = require('../../services/tokenVerificationService');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sign = () => jwt.sign(
  { sub: 'u1', iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 3600 },
  privateKey,
  { algorithm: 'RS256', keyid: 'kid-1' },
);

beforeEach(() => {
  jest.clearAllMocks();
  // JWKS unavailable → forces the introspection fallback path.
  jwksService.getPublicKey.mockResolvedValue(null);
});

test('introspection NOT configured → treated as skipped, NOT rejected (fail-closed)', async () => {
  tokenIntrospectionService.validateToken.mockRejectedValue(
    Object.assign(new Error('Token introspection not configured'), { code: 'INTROSPECTION_NOT_CONFIGURED' }),
  );

  const r = await verifyExchangedToken(sign());

  // "Skipped", not "rejected": no error is surfaced (a warning is), so callers
  // that treat error-set as a hard failure do not reject this valid token.
  expect(r.error).toBeNull();
  expect(r.warning).toMatch(/introspection not configured|skipped/i);
});

test('PingOne reports the token INACTIVE → rejected in fail-closed mode', async () => {
  // Contrast case: a real inactive verdict MUST still reject (error set), proving
  // the fix did not weaken the configured/inactive path.
  tokenIntrospectionService.validateToken.mockResolvedValue({ valid: false, sub: null, scopes: [] });

  const r = await verifyExchangedToken(sign());

  expect(r.verified).toBe(false);
  expect(r.error).toMatch(/inactive/i);
  expect(r.warning).toBeNull();
});

test('a real introspection error (network) → still rejected in fail-closed mode', async () => {
  // Only INTROSPECTION_NOT_CONFIGURED is reclassified as "skipped"; other errors
  // keep honouring FAIL_OPEN (here, fail-closed → reject).
  tokenIntrospectionService.validateToken.mockRejectedValue(new Error('ECONNREFUSED'));

  const r = await verifyExchangedToken(sign());

  expect(r.verified).toBe(false);
  expect(r.error).toMatch(/introspection fallback failed/i);
});
