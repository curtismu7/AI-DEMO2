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
jest.mock('../../config/resourceAudience', () => ({
  getBffResourceAudience: () => 'https://banking.example/rs',
  getInFlowResourceAudience: () => 'mcpgateway.ping.demo',
}));

jest.mock('../../services/agentTokenCache', () => ({
  get: jest.fn(() => null),
  set: jest.fn(),
}));

jest.mock('../../services/agentMcpTokenService', () => {
  const actual = jest.requireActual('../../services/agentMcpTokenService');
  return {
    ...actual,
    resolveMcpAccessTokenWithEvents: jest.fn(),
  };
});

// Mock configStore so any transitive read is inert (the service no longer reads it directly).
jest.mock('../../services/configStore', () => ({ getEffective: () => undefined }));

// Issuer resolution for the `iss` policy rule (RFC 7519 §4.1.1). Mocked so the
// rule is deterministic — with the configStore mock above, the real resolver
// would report "not configured" and fail every decision.
const TEST_ISSUER = 'https://auth.pingone.com/env-123/as';
jest.mock('../../services/oauthEndpointResolver', () => ({
  getIssuer: () => 'https://auth.pingone.com/env-123/as',
}));

// Mock jwksService — getPublicKey returns our test public key.
jest.mock('../../services/jwksService', () => ({ getPublicKey: jest.fn() }));

// Mock the RFC 7662 introspection service used for opaque (non-JWT) tokens.
jest.mock('../../services/tokenIntrospectionService', () => ({ validateToken: jest.fn() }));

const jwksService = require('../../services/jwksService');
const introspection = require('../../services/tokenIntrospectionService');
const agentTokenCache = require('../../services/agentTokenCache');
const agentMcpTokenService = require('../../services/agentMcpTokenService');
const tester = require('../../services/resourceServerTesterService');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function sign(claims, opts = {}) {
  return jwt.sign(claims, privateKey, { algorithm: 'RS256', keyid: 'test-kid', ...opts });
}

const baseClaims = () => ({
  sub: 'user-1',
  aud: TARGET_AUD,
  iss: TEST_ISSUER,
  scope: 'openid read',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
});

beforeEach(() => {
  jwksService.getPublicKey.mockResolvedValue({ keyObject: publicKey, alg: 'RS256' });
  introspection.validateToken.mockReset();
  agentTokenCache.get.mockReset().mockReturnValue(null);
  agentTokenCache.set.mockReset();
  agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockReset();
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

  // iss — RFC 7519 §4.1.1. Its own rule row, not folded into `signature`: a
  // correctly-signed token from the wrong issuer must read as an issuer
  // failure, not a broken signature.
  test('REJECT for a wrong-issuer token, and the signature rule still passes', async () => {
    const res = await tester.validate(sign({ ...baseClaims(), iss: 'https://evil.example/as' }));
    expect(res.decision).toBe('REJECT');
    expect(res.rules.find((r) => r.name === 'iss').pass).toBe(false);
    expect(res.rules.find((r) => r.name === 'signature').pass).toBe(true);
  });

  test('REJECT for a token with no iss claim', async () => {
    const claims = baseClaims();
    delete claims.iss;
    const res = await tester.validate(sign(claims));
    expect(res.decision).toBe('REJECT');
    expect(res.rules.find((r) => r.name === 'iss').pass).toBe(false);
  });

  test('the iss rule passes for a correctly-issued token', async () => {
    const res = await tester.validate(sign(baseClaims()));
    expect(res.rules.find((r) => r.name === 'iss').pass).toBe(true);
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

  test('resolves mcp from the newest non-expired agentTokens cache entry', () => {
    const session = {
      agentTokens: {
        'banking::mcp:invoke': {
          access_token: 'tok-old',
          expires_at: Date.now() + 60_000,
        },
        'banking::mcp:invoke openid': {
          access_token: 'tok-new',
          expires_at: Date.now() + 120_000,
        },
      },
    };
    const r = tester.resolveToken({ tokenRef: 'mcp' }, session);
    expect(r).toEqual({ token: 'tok-new', source: 'session:mcp' });
  });

  test('mcp without cache returns mcp_token_not_cached (mint path is async)', () => {
    expect(tester.resolveToken({ tokenRef: 'mcp' }, {}).error).toBe('mcp_token_not_cached');
  });
});

describe('resolveTokenAsync', () => {
  const sessionReq = (session) => ({ session });

  test('pasted token still wins without minting', async () => {
    const r = await tester.resolveTokenAsync(
      { tokenRaw: 'pasted.jwt.here', tokenRef: 'mcp' },
      sessionReq({ oauthTokens: { accessToken: 'sess' } }),
    );
    expect(r).toEqual({ token: 'pasted.jwt.here', source: 'pasted' });
    expect(agentMcpTokenService.resolveMcpAccessTokenWithEvents).not.toHaveBeenCalled();
  });

  test('uses newest agentTokens cache without minting', async () => {
    const session = {
      oauthTokens: { accessToken: 'sess' },
      agentTokens: {
        a: { access_token: 'cached-mcp', expires_at: Date.now() + 60_000 },
      },
    };
    const r = await tester.resolveTokenAsync({ tokenRef: 'mcp' }, sessionReq(session));
    expect(r).toEqual({ token: 'cached-mcp', source: 'session:mcp' });
    expect(agentMcpTokenService.resolveMcpAccessTokenWithEvents).not.toHaveBeenCalled();
  });

  test('mints via RFC 8693 when cache empty and caches result', async () => {
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({
      token: ' minted-tok ',
      expires_in: 1800,
    });
    const session = { oauthTokens: { accessToken: 'sess-at' }, activeVertical: 'banking' };
    const req = sessionReq(session);
    const r = await tester.resolveTokenAsync({ tokenRef: 'mcp' }, req);
    expect(r).toEqual({ token: 'minted-tok', source: 'session:mcp' });
    expect(agentTokenCache.set).toHaveBeenCalledWith(
      session,
      'banking',
      ['mcp:invoke', 'openid', 'profile'],
      { access_token: 'minted-tok', expires_in: 1800 },
    );
  });

  test('returns token_not_in_session when subject AT missing', async () => {
    const r = await tester.resolveTokenAsync({ tokenRef: 'mcp' }, sessionReq({}));
    expect(r.error).toBe('token_not_in_session');
    expect(agentMcpTokenService.resolveMcpAccessTokenWithEvents).not.toHaveBeenCalled();
  });

  test('returns token_not_in_session when mint reports need_auth', async () => {
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({ need_auth: true });
    const r = await tester.resolveTokenAsync(
      { tokenRef: 'mcp' },
      sessionReq({ oauthTokens: { accessToken: 'sess-at' } }),
    );
    expect(r.error).toBe('token_not_in_session');
    expect(agentTokenCache.set).not.toHaveBeenCalled();
  });

  test('returns mcp_token_mint_failed when mint returns empty token', async () => {
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({ token: '   ' });
    const r = await tester.resolveTokenAsync(
      { tokenRef: 'mcp' },
      sessionReq({ oauthTokens: { accessToken: 'sess-at' } }),
    );
    expect(r.error).toBe('mcp_token_mint_failed');
  });

  test('returns mcp_token_mint_failed when mint throws', async () => {
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockRejectedValue(new Error('exchange down'));
    const r = await tester.resolveTokenAsync(
      { tokenRef: 'mcp' },
      sessionReq({ oauthTokens: { accessToken: 'sess-at' } }),
    );
    expect(r.error).toBe('mcp_token_mint_failed');
  });

  test('prefers agentTokenCache.get after agentTokens miss', async () => {
    agentTokenCache.get.mockReturnValue({ access_token: 'from-cache-svc' });
    const r = await tester.resolveTokenAsync(
      { tokenRef: 'mcp' },
      sessionReq({ oauthTokens: { accessToken: 'sess-at' } }),
    );
    expect(r).toEqual({ token: 'from-cache-svc', source: 'session:mcp' });
    expect(agentMcpTokenService.resolveMcpAccessTokenWithEvents).not.toHaveBeenCalled();
  });
});

describe('inflow profile', () => {
  test('PERMIT when aud and mcp:invoke match the gateway RS', async () => {
    const claims = {
      ...baseClaims(),
      aud: 'mcpgateway.ping.demo',
      scope: 'openid mcp:invoke',
    };
    const res = await tester.validate(sign(claims), 'inflow');
    expect(res.decision).toBe('PERMIT');
    expect(res.rules.find((r) => r.name === 'aud').pass).toBe(true);
    expect(res.rules.find((r) => r.name === 'scope').pass).toBe(true);
  });

  test('REJECT login-audience token against inflow policy', async () => {
    const res = await tester.validate(sign(baseClaims()), 'inflow');
    expect(res.decision).toBe('REJECT');
    expect(res.rules.find((r) => r.name === 'aud').pass).toBe(false);
  });

  test('PROBE_WHITELIST includes Path B identity', () => {
    expect(tester.PROBE_WHITELIST).toContain('/api/resource-server/identity');
  });
});

describe('PROBE_WHITELIST', () => {
  test('probe rejects a non-whitelisted target without making a request', async () => {
    const res = await tester.probe('tok', '/api/admin/secret');
    expect(res.error).toBe('invalid_target');
  });
});
