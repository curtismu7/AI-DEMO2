'use strict';

/**
 * F7 — token validation parity with ping-gateway/scripts/groovy/jwks-token-validation.groovy:156-181.
 * The Node gateway checked only `exp` and `aud`; the IG path also enforces `iss` and `nbf`.
 * A token accepted by one gateway must not be rejected by the other.
 *
 * F5 — fail-open: "no JWKS configured + STRICT_AUTH!=='true'" used to mean jwt.decode with
 * ZERO signature verification. That degraded mode now requires an explicit opt-in.
 *
 * Also covers the kid-less-token key-selection bug (tokenValidator.ts:181): a token with no
 * `kid` header must NOT be verified against ks[0] when the JWKS carries more than one key.
 */

import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const GW_AUD = 'mcpgateway.ping.demo';

/** Unsigned (alg:none) token — only usable on the decode-only path. */
function makeUnsignedToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-1',
    aud: GW_AUD,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })).toString('base64url');
  return `${header}.${payload}.`;
}

/**
 * Re-require the module so the process-level JWKS cache does not leak between
 * tests (the cache is keyed by nothing but time, so a second endpoint would
 * otherwise be served the first test's keys).
 */
function freshValidator() {
  let mod!: typeof import('../src/tokenValidator');
  jest.isolateModules(() => {
    mod = require('../src/tokenValidator');
  });
  return mod;
}

describe('validateInboundToken — F5 unverified-token opt-in', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    delete process.env.PINGONE_JWKS_ENDPOINT;
    delete process.env.STRICT_AUTH;
    delete process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS;
    delete process.env.PINGONE_ISSUER_URI;
  });
  afterAll(() => { process.env = OLD; });

  test('refuses to validate when no JWKS is configured and the opt-in is absent', async () => {
    const { validateInboundToken, TokenValidationError } = freshValidator();
    await expect(validateInboundToken(makeUnsignedToken({}), GW_AUD))
      .rejects.toThrow(/signature verification/i);
    await expect(validateInboundToken(makeUnsignedToken({}), GW_AUD))
      .rejects.toBeInstanceOf(TokenValidationError);
  });

  test('accepts decode-only when MCP_GW_ALLOW_UNVERIFIED_TOKENS=true', async () => {
    process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
    const { validateInboundToken } = freshValidator();
    const decoded = await validateInboundToken(makeUnsignedToken({}), GW_AUD);
    expect(decoded.sub).toBe('user-1');
  });

  test('STRICT_AUTH=true still refuses even with the opt-in set', async () => {
    process.env.STRICT_AUTH = 'true';
    process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
    const { validateInboundToken } = freshValidator();
    await expect(validateInboundToken(makeUnsignedToken({}), GW_AUD))
      .rejects.toThrow(/PINGONE_JWKS_ENDPOINT not configured/);
  });
});

describe('validateInboundToken — F7 iss / nbf parity with the IG JWKS filter', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    delete process.env.PINGONE_JWKS_ENDPOINT;
    delete process.env.STRICT_AUTH;
    delete process.env.PINGONE_ISSUER_URI;
    process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
  });
  afterAll(() => { process.env = OLD; });

  test('rejects a token whose iss does not match PINGONE_ISSUER_URI', async () => {
    process.env.PINGONE_ISSUER_URI = 'https://auth.pingone.com/env-1/as';
    const { validateInboundToken } = freshValidator();
    await expect(
      validateInboundToken(makeUnsignedToken({ iss: 'https://evil.example/as' }), GW_AUD),
    ).rejects.toThrow(/issuer/i);
  });

  test('accepts a token whose iss matches PINGONE_ISSUER_URI', async () => {
    process.env.PINGONE_ISSUER_URI = 'https://auth.pingone.com/env-1/as';
    const { validateInboundToken } = freshValidator();
    const decoded = await validateInboundToken(
      makeUnsignedToken({ iss: 'https://auth.pingone.com/env-1/as' }), GW_AUD,
    );
    expect(decoded.sub).toBe('user-1');
  });

  test('rejects a token that carries NO iss when PINGONE_ISSUER_URI is configured', async () => {
    process.env.PINGONE_ISSUER_URI = 'https://auth.pingone.com/env-1/as';
    const { validateInboundToken } = freshValidator();
    await expect(validateInboundToken(makeUnsignedToken({}), GW_AUD)).rejects.toThrow(/issuer/i);
  });

  test('skips the iss check when PINGONE_ISSUER_URI is not configured', async () => {
    const { validateInboundToken } = freshValidator();
    const decoded = await validateInboundToken(
      makeUnsignedToken({ iss: 'https://anything.example/as' }), GW_AUD,
    );
    expect(decoded.sub).toBe('user-1');
  });

  test('rejects a token whose nbf is in the future beyond the clock skew', async () => {
    const { validateInboundToken } = freshValidator();
    const nbf = Math.floor(Date.now() / 1000) + 600;
    await expect(validateInboundToken(makeUnsignedToken({ nbf }), GW_AUD))
      .rejects.toThrow(/not yet valid/i);
  });

  test('accepts a token whose nbf is within the 30s clock skew', async () => {
    const { validateInboundToken } = freshValidator();
    const nbf = Math.floor(Date.now() / 1000) + 10;
    const decoded = await validateInboundToken(makeUnsignedToken({ nbf }), GW_AUD);
    expect(decoded.sub).toBe('user-1');
  });
});

describe('validateInboundToken — iat max-age (mirrors decision.js Rule 0d)', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    delete process.env.PINGONE_JWKS_ENDPOINT;
    delete process.env.STRICT_AUTH;
    delete process.env.PINGONE_ISSUER_URI;
    delete process.env.MCP_GW_IAT_MAX_AGE_SECONDS;
    process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
  });
  afterAll(() => { process.env = OLD; });

  test('rejects a token whose iat is in the future beyond 30s skew', async () => {
    const { validateInboundToken } = freshValidator();
    const iat = Math.floor(Date.now() / 1000) + 600;
    await expect(validateInboundToken(makeUnsignedToken({ iat }), GW_AUD))
      .rejects.toThrow(/issued in the future/i);
  });

  test('rejects a token older than the default 7200s max age', async () => {
    const { validateInboundToken } = freshValidator();
    const iat = Math.floor(Date.now() / 1000) - 7300;
    await expect(validateInboundToken(makeUnsignedToken({ iat }), GW_AUD))
      .rejects.toThrow(/too old/i);
  });

  test('accepts a token within the default max age', async () => {
    const { validateInboundToken } = freshValidator();
    const iat = Math.floor(Date.now() / 1000) - 100;
    const decoded = await validateInboundToken(makeUnsignedToken({ iat }), GW_AUD);
    expect(decoded.sub).toBe('user-1');
  });

  test('honors MCP_GW_IAT_MAX_AGE_SECONDS override', async () => {
    process.env.MCP_GW_IAT_MAX_AGE_SECONDS = '60';
    const { validateInboundToken } = freshValidator();
    const iat = Math.floor(Date.now() / 1000) - 120;
    await expect(validateInboundToken(makeUnsignedToken({ iat }), GW_AUD))
      .rejects.toThrow(/too old/i);
  });

  test('skips the check when the token carries no iat', async () => {
    const { validateInboundToken } = freshValidator();
    const decoded = await validateInboundToken(makeUnsignedToken({}), GW_AUD);
    expect(decoded.sub).toBe('user-1');
  });
});

describe('validateInboundToken — kid-less token key selection (tokenValidator.ts:181)', () => {
  const OLD = { ...process.env };
  let server: http.Server;
  let jwksUrl: string;
  let keyA: crypto.KeyPairKeyObjectResult;
  let keyB: crypto.KeyPairKeyObjectResult;
  let jwksKeys: unknown[] = [];

  beforeAll(async () => {
    keyA = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    keyB = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: jwksKeys }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    jwksUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = OLD;
  });

  beforeEach(() => {
    delete process.env.STRICT_AUTH;
    delete process.env.PINGONE_ISSUER_URI;
    process.env.PINGONE_JWKS_ENDPOINT = jwksUrl;
  });

  const jwkOf = (k: crypto.KeyPairKeyObjectResult, kid: string) =>
    ({ ...k.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' });

  /** Sign with jsonwebtoken, optionally omitting the kid header. */
  function sign(key: crypto.KeyObject, kid?: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const jwt = require('jsonwebtoken');
    return jwt.sign(
      { sub: 'user-1', aud: GW_AUD },
      key.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', expiresIn: '1h', ...(kid ? { keyid: kid } : {}) },
    );
  }

  test('fails closed for a kid-less token when the JWKS carries more than one key', async () => {
    jwksKeys = [jwkOf(keyA, 'kid-a'), jwkOf(keyB, 'kid-b')];
    const { validateInboundToken } = freshValidator();
    await expect(validateInboundToken(sign(keyA.privateKey), GW_AUD))
      .rejects.toThrow(/kid/i);
  });

  test('accepts a kid-less token when the JWKS carries exactly one key (unambiguous)', async () => {
    jwksKeys = [jwkOf(keyA, 'kid-a')];
    const { validateInboundToken } = freshValidator();
    const decoded = await validateInboundToken(sign(keyA.privateKey), GW_AUD);
    expect(decoded.sub).toBe('user-1');
  });

  test('still selects by kid when the token carries one', async () => {
    jwksKeys = [jwkOf(keyA, 'kid-a'), jwkOf(keyB, 'kid-b')];
    const { validateInboundToken } = freshValidator();
    const decoded = await validateInboundToken(sign(keyB.privateKey, 'kid-b'), GW_AUD);
    expect(decoded.sub).toBe('user-1');
  });
});
