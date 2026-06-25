/**
 * @file clientAssertionService.test.js
 * @description Unit tests for private_key_jwt (RFC 7523) client authentication.
 *
 * Coverage:
 *  1. resolveAuthMethod — flag + key gating (private_key_jwt vs basic/post)
 *  2. buildClientAssertion — claims (iss/sub/aud/jti/exp), kid header, verifies
 *     against the derived public JWK
 *  3. getPublicJwk — derived public key matches the configured private key
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Generate a per-run keypair the mocked configStore will serve. `mock`-prefixed
// so the jest.mock factory may reference it (jest hoists the factory).
const mockKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = mockKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const KID = 'unit-test-kid';

// Mutable config state the mock reads, so tests can flip the flag/key.
const mockCfg = {};

jest.mock('../../services/configStore', () => ({
  getEffective: (key) => mockCfg[key],
}));

const svc = require('../../services/clientAssertionService');

beforeEach(() => {
  mockCfg.ff_token_auth_private_key_jwt = 'false';
  mockCfg.pingone_client_jwt_private_key = PRIVATE_PEM;
  mockCfg.pingone_client_jwt_kid = KID;
});

describe('resolveAuthMethod', () => {
  test('returns configured method when flag is OFF', () => {
    mockCfg.ff_token_auth_private_key_jwt = 'false';
    expect(svc.resolveAuthMethod('basic')).toBe('basic');
    expect(svc.resolveAuthMethod('post')).toBe('post');
  });

  test('returns private_key_jwt when flag ON and key configured', () => {
    mockCfg.ff_token_auth_private_key_jwt = 'true';
    expect(svc.resolveAuthMethod('post')).toBe('private_key_jwt');
  });

  test('falls back to configured method when flag ON but no key', () => {
    mockCfg.ff_token_auth_private_key_jwt = 'true';
    mockCfg.pingone_client_jwt_private_key = '';
    expect(svc.resolveAuthMethod('basic')).toBe('basic');
  });
});

describe('buildClientAssertion', () => {
  const CLIENT_ID = 'test-client-id';
  const AUD = 'https://auth.pingone.com/env/as/token';

  test('produces a JWT with kid header that verifies against the derived public JWK', () => {
    const token = svc.buildClientAssertion(CLIENT_ID, AUD);

    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe(KID);

    const jwk = svc.getPublicJwk();
    const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const claims = jwt.verify(token, pub, { algorithms: ['RS256'] });

    expect(claims.iss).toBe(CLIENT_ID);
    expect(claims.sub).toBe(CLIENT_ID);
    expect(claims.aud).toBe(AUD);
    expect(typeof claims.jti).toBe('string');
    expect(claims.exp - claims.iat).toBe(60);
  });

  test('throws when no private key configured', () => {
    mockCfg.pingone_client_jwt_private_key = '';
    expect(() => svc.buildClientAssertion(CLIENT_ID, AUD)).toThrow(/no private key/);
  });

  test('throws when audience missing', () => {
    expect(() => svc.buildClientAssertion(CLIENT_ID, '')).toThrow(/token endpoint/);
  });
});

describe('getPublicJwk', () => {
  test('returns a sig RS256 JWK with the configured kid', () => {
    const jwk = svc.getPublicJwk();
    expect(jwk.use).toBe('sig');
    expect(jwk.alg).toBe('RS256');
    expect(jwk.kid).toBe(KID);
    expect(jwk.kty).toBe('RSA');
  });

  test('returns null when no key configured', () => {
    mockCfg.pingone_client_jwt_private_key = '';
    expect(svc.getPublicJwk()).toBeNull();
  });
});

describe('Dedicated Token-Exchange Exchanger', () => {
  const EXCHANGER_CLIENT_ID = 'dedic-exchanger-client-id';
  const AUD = 'https://auth.pingone.com/env/as/token';
  const exchangerKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const EXCHANGER_PRIVATE_PEM = exchangerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const EXCHANGER_KID = 'exchanger-test-kid';

  beforeEach(() => {
    mockCfg.ff_private_key_jwt_token_exchange = 'false';
    mockCfg.pingone_private_key_jwt_exchanger_client_id = '';
    mockCfg.pingone_private_key_jwt_exchanger_private_key = EXCHANGER_PRIVATE_PEM;
    mockCfg.pingone_private_key_jwt_exchanger_kid = EXCHANGER_KID;
  });

  describe('isExchangerPrivateKeyJwtEnabled', () => {
    test('returns false when flag is OFF', () => {
      mockCfg.ff_private_key_jwt_token_exchange = 'false';
      expect(svc.isExchangerPrivateKeyJwtEnabled()).toBe(false);
    });

    test('returns false when flag ON but no client_id', () => {
      mockCfg.ff_private_key_jwt_token_exchange = 'true';
      mockCfg.pingone_private_key_jwt_exchanger_client_id = '';
      expect(svc.isExchangerPrivateKeyJwtEnabled()).toBe(false);
    });

    test('returns false when flag ON but no private key', () => {
      mockCfg.ff_private_key_jwt_token_exchange = 'true';
      mockCfg.pingone_private_key_jwt_exchanger_client_id = EXCHANGER_CLIENT_ID;
      mockCfg.pingone_private_key_jwt_exchanger_private_key = '';
      expect(svc.isExchangerPrivateKeyJwtEnabled()).toBe(false);
    });

    test('returns true when flag ON, client_id set, and key configured', () => {
      mockCfg.ff_private_key_jwt_token_exchange = 'true';
      mockCfg.pingone_private_key_jwt_exchanger_client_id = EXCHANGER_CLIENT_ID;
      expect(svc.isExchangerPrivateKeyJwtEnabled()).toBe(true);
    });
  });

  describe('buildExchangerClientAssertion', () => {
    test('produces a JWT with exchanger kid header that verifies against the derived public key', () => {
      mockCfg.ff_private_key_jwt_token_exchange = 'true';
      mockCfg.pingone_private_key_jwt_exchanger_client_id = EXCHANGER_CLIENT_ID;

      const token = svc.buildExchangerClientAssertion(EXCHANGER_CLIENT_ID, AUD);

      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
      expect(header.alg).toBe('RS256');
      expect(header.kid).toBe(EXCHANGER_KID);

      const pub = crypto.createPublicKey({ key: EXCHANGER_PRIVATE_PEM, format: 'pem' });
      const claims = jwt.verify(token, pub, { algorithms: ['RS256'] });

      expect(claims.iss).toBe(EXCHANGER_CLIENT_ID);
      expect(claims.sub).toBe(EXCHANGER_CLIENT_ID);
      expect(claims.aud).toBe(AUD);
      expect(typeof claims.jti).toBe('string');
      expect(claims.exp - claims.iat).toBe(60);
    });

    test('throws when no private key configured', () => {
      mockCfg.pingone_private_key_jwt_exchanger_private_key = '';
      expect(() => svc.buildExchangerClientAssertion(EXCHANGER_CLIENT_ID, AUD)).toThrow(
        /no private key/
      );
    });

    test('throws when audience missing', () => {
      expect(() => svc.buildExchangerClientAssertion(EXCHANGER_CLIENT_ID, '')).toThrow(
        /token endpoint/
      );
    });
  });
});
