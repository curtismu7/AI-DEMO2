'use strict';

/**
 * UC29 — OAuth introspection outage, fail closed (demo sim hook).
 *
 * The Demo Agent Gateway validates inbound tokens by JWKS signature
 * (GW_INTROSPECTION_ENABLED=false — see docker-compose.yml for why introspection
 * cannot work on a multi-issuer gateway). The validation BACKEND on this path is
 * therefore the JWKS endpoint, so the outage sim must arm a JWKS-unreachable
 * state and the gateway must fail CLOSED with 503 — the same shape the
 * introspection path already returns (authorizeMcpRequestCore
 * `introspection_unavailable` → 503 gateway_misconfigured).
 *
 * A transport failure reaching the JWKS endpoint already throws
 * TokenValidationError('jwks_fetch_failed'); the sim hook reuses that code so
 * status mapping stays in one place. 503 (validation backend unreachable) is
 * distinct from 401 (credential rejected) — an outage is not a bad token.
 */

import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const GW_AUD = 'mcpgateway.ping.demo';

function freshValidator() {
  let mod!: typeof import('../src/tokenValidator');
  jest.isolateModules(() => {
    mod = require('../src/tokenValidator');
  });
  return mod;
}

describe('validateInboundToken — JWKS outage sim (UC29) fails closed', () => {
  const OLD = { ...process.env };
  let server: http.Server;
  let jwksUrl: string;
  let hits: number;
  let keyA: crypto.KeyPairKeyObjectResult;
  let jwksKeys: unknown[] = [];

  beforeAll(async () => {
    keyA = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    server = http.createServer((_req, res) => {
      hits += 1;
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
    hits = 0;
    delete process.env.STRICT_AUTH;
    process.env.PINGONE_JWKS_ENDPOINT = jwksUrl;
  });

  afterEach(() => {
    // Always disarm — an armed sim left on would block every later test.
    freshValidator().setJwksSimDown(false);
  });

  const jwkOf = (k: crypto.KeyPairKeyObjectResult, kid: string) =>
    ({ ...k.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' });

  function sign(key: crypto.KeyObject, kid: string): string {
    const jwt = require('jsonwebtoken');
    return jwt.sign(
      { sub: 'user-1', aud: GW_AUD },
      key.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', expiresIn: '1h', keyid: kid },
    );
  }

  test('armed: validation refuses with jwks_fetch_failed before any JWKS fetch', async () => {
    jwksKeys = [jwkOf(keyA, 'kid-a')];
    const { validateInboundToken, setJwksSimDown } = freshValidator();

    // Sanity: the same token validates while disarmed — proves the rejection
    // below is the sim arm, not a broken key set.
    const ok = await validateInboundToken(sign(keyA.privateKey, 'kid-a'), GW_AUD);
    expect(ok.sub).toBe('user-1');

    setJwksSimDown(true);
    hits = 0;
    await expect(validateInboundToken(sign(keyA.privateKey, 'kid-a'), GW_AUD))
      .rejects.toMatchObject({ code: 'jwks_fetch_failed' });
    // Fails closed BEFORE the fetch — the outage is simulated, not just flaky.
    expect(hits).toBe(0);
  });

  test('disarm restores normal validation', async () => {
    jwksKeys = [jwkOf(keyA, 'kid-a')];
    const { validateInboundToken, setJwksSimDown } = freshValidator();

    setJwksSimDown(true);
    await expect(validateInboundToken(sign(keyA.privateKey, 'kid-a'), GW_AUD))
      .rejects.toMatchObject({ code: 'jwks_fetch_failed' });

    setJwksSimDown(false);
    const ok = await validateInboundToken(sign(keyA.privateKey, 'kid-a'), GW_AUD);
    expect(ok.sub).toBe('user-1');
  });
});

describe('validationErrorHttpStatus — outage vs credential failures', () => {
  test('jwks_fetch_failed (validation backend unreachable) maps to 503', () => {
    const { TokenValidationError, validationErrorHttpStatus } = freshValidator();
    const err = new TokenValidationError('JWKS unreachable', 'jwks_fetch_failed');
    expect(validationErrorHttpStatus(err)).toBe(503);
  });

  test('credential failures (invalid/expired/missing token) stay 401', () => {
    const { TokenValidationError, validationErrorHttpStatus } = freshValidator();
    for (const code of ['invalid_token', 'expired_token', 'missing_token', 'token_not_yet_valid']) {
      expect(validationErrorHttpStatus(new TokenValidationError('x', code))).toBe(401);
    }
  });

  test('unknown code falls back to 401 (never leak 5xx semantics to a bad credential)', () => {
    const { TokenValidationError, validationErrorHttpStatus } = freshValidator();
    expect(validationErrorHttpStatus(new TokenValidationError('x', 'something_new'))).toBe(401);
  });
});
