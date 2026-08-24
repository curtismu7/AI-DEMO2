'use strict';

const keyMod = require('../../services/enterpriseIdpKey');

describe('enterpriseIdpKey', () => {
  const ORIG = { ...process.env };
  beforeEach(() => { keyMod.resetForTests(); delete process.env.ENTERPRISE_IDP_SIGNING_KEY_PEM; });
  afterEach(() => { process.env = { ...ORIG }; keyMod.resetForTests(); });

  test('generates a usable RSA private key when unconfigured', () => {
    const pem = keyMod.getPrivateKeyPem();
    expect(pem).toContain('BEGIN PRIVATE KEY');
  });

  test('is stable across calls (memoised)', () => {
    expect(keyMod.getPrivateKeyPem()).toBe(keyMod.getPrivateKeyPem());
    expect(keyMod.getKid()).toBe(keyMod.getKid());
  });

  test('publishes an RS256 signing JWK carrying the same kid', () => {
    const jwk = keyMod.getPublicJwk();
    expect(jwk.kty).toBe('RSA');
    expect(jwk.use).toBe('sig');
    expect(jwk.alg).toBe('RS256');
    expect(jwk.kid).toBe(keyMod.getKid());
    expect(jwk.n).toBeTruthy();
    expect(jwk.e).toBeTruthy();
  });

  test('never exposes private material in the public JWK', () => {
    const jwk = keyMod.getPublicJwk();
    expect(jwk.d).toBeUndefined();
    expect(jwk.p).toBeUndefined();
    expect(jwk.q).toBeUndefined();
  });

  test('honours ENTERPRISE_IDP_SIGNING_KEY_PEM when set', () => {
    const crypto = require('crypto');
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    process.env.ENTERPRISE_IDP_SIGNING_KEY_PEM = pem;
    keyMod.resetForTests();
    expect(keyMod.getPrivateKeyPem()).toBe(pem);
  });

  test('honours a \\n-escaped single-line PEM (the shape a .env file stores it in)', () => {
    const crypto = require('crypto');
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    process.env.ENTERPRISE_IDP_SIGNING_KEY_PEM = pem.replace(/\n/g, '\\n');
    keyMod.resetForTests();
    expect(keyMod.getPrivateKeyPem()).toBe(pem);
  });
});
