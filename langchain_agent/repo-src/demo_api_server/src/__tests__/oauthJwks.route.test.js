/**
 * @file oauthJwks.route.test.js
 * @description GET /api/oauth/jwks publishes the BFF's PUBLIC client-auth JWK,
 * and returns an empty key set when no private key is configured.
 */
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const mockKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = mockKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const mockCfg = {
  pingone_client_jwt_private_key: PRIVATE_PEM,
  pingone_client_jwt_kid: 'jwks-route-kid',
};
jest.mock('../../services/configStore', () => ({ getEffective: (k) => mockCfg[k] }));

function makeApp() {
  const app = express();
  app.use('/api/oauth/jwks', require('../../routes/oauthJwks'));
  return app;
}

beforeEach(() => {
  mockCfg.pingone_client_jwt_private_key = PRIVATE_PEM;
  mockCfg.pingone_client_jwt_kid = 'jwks-route-kid';
});

test('returns a JWK set with the configured kid and only public material', async () => {
  const res = await request(makeApp()).get('/api/oauth/jwks');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.keys)).toBe(true);
  expect(res.body.keys).toHaveLength(1);
  const jwk = res.body.keys[0];
  expect(jwk.kid).toBe('jwks-route-kid');
  expect(jwk.use).toBe('sig');
  expect(jwk.kty).toBe('RSA');
  // Public JWK must NOT carry private RSA components.
  expect(jwk.d).toBeUndefined();
  expect(jwk.p).toBeUndefined();
  expect(jwk.q).toBeUndefined();
});

test('returns an empty key set when no private key is configured', async () => {
  mockCfg.pingone_client_jwt_private_key = '';
  const res = await request(makeApp()).get('/api/oauth/jwks');
  expect(res.status).toBe(200);
  expect(res.body.keys).toEqual([]);
});
