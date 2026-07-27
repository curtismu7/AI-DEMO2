/**
 * jwksService.hasKid — exact JWKS membership.
 *
 * Distinct from getPublicKey, which deliberately falls back to the first
 * signature key (jwksService.js:99-103) and therefore can NEVER report a kid as
 * absent. A membership check built on getPublicKey returns true for every kid
 * whenever the JWKS is reachable — see the revert-to-RED step in the plan.
 */
'use strict';

const crypto = require('crypto');
const axios = require('axios');

jest.mock('axios');
jest.mock('../../services/oauthEndpointResolver', () => ({
  getJwksUri: jest.fn(() => 'https://auth.pingone.com/env-123/as/jwks'),
}));

const jwksService = require('../../services/jwksService');

/** Real RSA public JWK so crypto.createPublicKey() actually succeeds. */
function makeJwk(kid) {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
}

const KNOWN_KID = 'kid-known-1';

beforeEach(() => {
  jwksService.clearCache();
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: { keys: [makeJwk(KNOWN_KID)] } });
});

test('returns true for a kid published in the JWKS', async () => {
  await expect(jwksService.hasKid(KNOWN_KID)).resolves.toBe(true);
});

test('returns false for a kid the JWKS does not publish', async () => {
  await expect(jwksService.hasKid('kid-forged')).resolves.toBe(false);
});

test('returns true when a refresh picks up a rotated key', async () => {
  // getKeys() returns a STALE cache on failure, so a bare .has() would report a
  // legitimately-rotated key as forged. hasKid must refresh before concluding false.
  axios.get
    .mockResolvedValueOnce({ data: { keys: [makeJwk(KNOWN_KID)] } })
    .mockResolvedValueOnce({ data: { keys: [makeJwk(KNOWN_KID), makeJwk('kid-rotated')] } });
  await expect(jwksService.hasKid('kid-rotated')).resolves.toBe(true);
});

test('returns null when the JWKS cannot be fetched (unknown, not forged)', async () => {
  axios.get.mockReset();
  axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
  await expect(jwksService.hasKid(KNOWN_KID)).resolves.toBeNull();
});

test('returns null when no kid is supplied', async () => {
  await expect(jwksService.hasKid(null)).resolves.toBeNull();
});
