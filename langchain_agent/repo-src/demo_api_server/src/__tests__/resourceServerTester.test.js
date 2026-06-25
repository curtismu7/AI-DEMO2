/**
 * Unit tests for resourceServerTesterService — validate / decode / resolveToken.
 * Uses a locally-generated RSA keypair and a mocked jwksService so signature
 * verification is deterministic and offline.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TARGET_AUD = 'https://banking.example/rs';

// Mock the shared BFF-audience resolver so getTargetAudience() is deterministic and
// independent of ambient env / configStore.
jest.mock('../../config/resourceAudience', () => ({ getBffResourceAudience: () => 'https://banking.example/rs' }));

// Mock configStore so any transitive read is inert (the service no longer reads it directly).
jest.mock('../../services/configStore', () => ({ getEffective: () => undefined }));

// Mock jwksService — getPublicKey returns our test public key.
jest.mock('../../services/jwksService', () => ({ getPublicKey: jest.fn() }));

// Mock the RFC 7662 introspection service used for opaque (non-JWT) tokens.
jest.mock('../../services/tokenIntrospectionService', () => ({ validateToken: jest.fn() }));

const jwksService = require('../../services/jwksService');
const introspection = require('../../services/tokenIntrospectionService');
const tester = require('../../services/resourceServerTesterService');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function sign(claims, opts = {}) {
  return jwt.sign(claims, privateKey, { algorithm: 'RS256', keyid: 'test-kid', ...opts });
}

const baseClaims = () => ({
  sub: 'user-1',
  aud: TARGET_AUD,
  scope: 'openid read',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
});

beforeEach(() => {
  jwksService.getPublicKey.mockResolvedValue({ keyObject: publicKey, alg: 'RS256' });
  introspection.validateToken.mockReset();
});

describe('validate', () => {
  test('PERMIT for a valid, correctly-signed token', async () => {
    const res = await tester.validate(sign(baseClaims()));
    expect(res.decision).toBe('PERMIT');
    expect(res.rules.find((r) => r.name === 'signature').pass).toBe(true);
    expect(res.rules.every((r) => r.pass)).toBe(true);
  });

  test('REJECT for an expired token (signature still passes)', async () => {
    const claims = { ...baseClaims(), exp: Math.floor(Date.now() / 1000) - 60 };
    const res = await tester.validate(sign(claims));
    expect(res.decision).toBe('REJECT');
    expect(res.rules.find((r) => r.name === 'signature').pass).toBe(true);
    expect(res.rules.find((r) => r.name === 'exp').pass).toBe(false);
  });

  test('REJECT for a wrong-audience token', async () => {
    const res = await tester.validate(sign({ ...baseClaims(), aud: 'https://other/rs' }));
    expect(res.decision).toBe('REJECT');
    expect(res.rules.find((r) => r.name === 'aud').pass).toBe(false);
  });

  test('REJECT for a missing-scope token', async () => {
    const res = await tester.validate(sign({ ...baseClaims(), scope: 'openid' }));
    expect(res.decision).toBe('REJECT');
    expect(res.rules.find((r) => r.name === 'scope').pass).toBe(false);
  });

  test('signature rule fails when JWKS is unavailable', async () => {
    jwksService.getPublicKey.mockResolvedValue(null);
    const res = await tester.validate(sign(baseClaims()));
    expect(res.decision).toBe('REJECT');
    expect(res.rules.find((r) => r.name === 'signature').pass).toBe(false);
  });

  test('signature rule fails for a token signed by a different key', async () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = jwt.sign(baseClaims(), other.privateKey, { algorithm: 'RS256', keyid: 'test-kid' });
    const res = await tester.validate(token);
    expect(res.rules.find((r) => r.name === 'signature').pass).toBe(false);
  });

  test('opaque token falls back to RFC 7662 introspection', async () => {
    introspection.validateToken.mockResolvedValue({
      valid: true, sub: 'user-1', aud: TARGET_AUD, scopes: ['read'],
      exp: Math.floor(Date.now() / 1000) + 3600, client_id: 'app-1',
    });
    const res = await tester.validate('opaque-reference-token');
    expect(introspection.validateToken).toHaveBeenCalledWith('opaque-reference-token');
    expect(res.method).toBe('introspection');
    expect(res.decision).toBe('PERMIT');
    expect(res.rules.find((r) => r.name === 'introspection').pass).toBe(true);
    expect(res.rules.find((r) => r.name === 'signature')).toBeUndefined();
  });

  test('opaque token REJECTs when introspection reports inactive', async () => {
    introspection.validateToken.mockResolvedValue({ valid: false, sub: null, scopes: [] });
    const res = await tester.validate('opaque-dead-token');
    expect(res.method).toBe('introspection');
    expect(res.decision).toBe('REJECT');
    expect(res.rules.find((r) => r.name === 'introspection').pass).toBe(false);
  });

  test('opaque token reports unavailable when introspection is not configured', async () => {
    introspection.validateToken.mockResolvedValue({ valid: false, error: 'token_introspection_failed' });
    const res = await tester.validate('opaque-token');
    expect(res.error).toBe('introspection_unavailable');
  });
});

describe('decode', () => {
  test('WOULD_PASS for a valid token (no signature checked)', () => {
    const res = tester.decode(sign(baseClaims()));
    expect(res.decision).toBe('WOULD_PASS');
    expect(res.rules.some((r) => r.name === 'signature')).toBe(false);
  });

  test('WOULD_REJECT for an expired token', () => {
    const res = tester.decode(sign({ ...baseClaims(), exp: Math.floor(Date.now() / 1000) - 60 }));
    expect(res.decision).toBe('WOULD_REJECT');
  });

  test('malformed token returns an error', () => {
    expect(tester.decode('xxx').error).toBe('malformed_token');
  });
});

describe('reveal', () => {
  test('returns the RAW token, its human label, and decoded claims (custody exception)', () => {
    const token = sign(baseClaims());
    const r = tester.reveal(token, 'session:access');
    expect(r.token).toBe(token); // intentionally NOT scrubbed — this panel exists to show it
    expect(r.label).toBe('Session access token');
    expect(r.claims.sub).toBe('user-1');
    expect(r.header.kid).toBe('test-kid');
  });

  test('labels the CC machine token and a pasted token', () => {
    expect(tester.reveal(sign(baseClaims()), 'cc').label).toBe('Client Credentials token');
    expect(tester.reveal(sign(baseClaims()), 'pasted').label).toBe('Pasted JWT');
  });

  test('falls back to a generic label for an unknown source', () => {
    expect(tester.reveal(sign(baseClaims()), 'whatever').label).toBe('Token under test');
  });

  test('malformed token returns an error and no raw token', () => {
    const r = tester.reveal('not-a-jwt', 'pasted');
    expect(r.error).toBe('malformed_token');
    expect(r.token).toBeUndefined();
  });
});

describe('resolveToken', () => {
  test('prefers a pasted raw token', () => {
    const r = tester.resolveToken({ tokenRaw: '  abc.def.ghi  ' }, {});
    expect(r).toEqual({ token: 'abc.def.ghi', source: 'pasted' });
  });

  test('resolves a session token by reference', () => {
    const session = { oauthTokens: { accessToken: 'tok-a', idToken: 'tok-i' } };
    expect(tester.resolveToken({ tokenRef: 'access' }, session).token).toBe('tok-a');
    expect(tester.resolveToken({ tokenRef: 'id' }, session).token).toBe('tok-i');
  });

  test('rejects the _cookie_session stub', () => {
    const session = { oauthTokens: { accessToken: '_cookie_session' } };
    expect(tester.resolveToken({ tokenRef: 'access' }, session).error).toBe('token_not_in_session');
  });

  test('errors when no token is supplied', () => {
    expect(tester.resolveToken({}, {}).error).toBe('missing_token');
  });

  test('errors on an unknown token reference', () => {
    expect(tester.resolveToken({ tokenRef: 'bogus' }, { oauthTokens: {} }).error).toBe('invalid_token_ref');
  });
});

describe('PROBE_WHITELIST', () => {
  test('probe rejects a non-whitelisted target without making a request', async () => {
    const res = await tester.probe('tok', '/api/admin/secret');
    expect(res.error).toBe('invalid_target');
  });
});
