'use strict';

/**
 * tokenValidator.ts unknown-kid JWKS refetch guard.
 *
 * A token with an unknown `kid` forces a JWKS refresh. Previously that refresh
 * bypassed the TTL, the rate-cap, AND the in-flight dedupe, so a burst of tokens
 * carrying random kids fanned out to one full JWKS round-trip against PingOne
 * each — a cheap amplification vector. The forced refresh is now rate-capped and
 * shares the in-flight fetch, so a burst collapses to a bounded number of fetches
 * while a genuine key rotation (a new real kid) still refreshes once.
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

describe('validateInboundToken — unknown-kid JWKS refetch is bounded', () => {
  const OLD = { ...process.env };
  let server: http.Server;
  let jwksUrl: string;
  let hits: number;
  let keyA: crypto.KeyPairKeyObjectResult;
  let keyB: crypto.KeyPairKeyObjectResult;
  let jwksKeys: unknown[] = [];

  beforeAll(async () => {
    keyA = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    keyB = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
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
    delete process.env.PINGONE_ISSUER_URI;
    delete process.env.MCP_GW_JWKS_MIN_REFRESH_MS;
    process.env.PINGONE_JWKS_ENDPOINT = jwksUrl;
  });

  const jwkOf = (k: crypto.KeyPairKeyObjectResult, kid: string) =>
    ({ ...k.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' });

  function sign(key: crypto.KeyObject, kid: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const jwt = require('jsonwebtoken');
    return jwt.sign(
      { sub: 'user-1', aud: GW_AUD },
      key.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', expiresIn: '1h', keyid: kid },
    );
  }

  test('a burst of random unknown kids collapses to a bounded number of JWKS fetches', async () => {
    jwksKeys = [jwkOf(keyA, 'kid-a')];
    const { validateInboundToken } = freshValidator();

    // 15 distinct unknown kids, validated sequentially. Each one previously forced
    // its own JWKS fetch; the rate-cap now serves them from the cache after the
    // first population, so the endpoint is hit at most a couple of times.
    for (let i = 0; i < 15; i++) {
      await expect(
        validateInboundToken(sign(keyA.privateKey, `random-kid-${i}`), GW_AUD),
      ).rejects.toThrow(/No matching JWKS key/i);
    }

    expect(hits).toBeLessThanOrEqual(2);
  });

  test('a genuine key rotation (new real kid) still refreshes once and validates', async () => {
    // Rate-cap disabled so the rotation refresh is not deferred — proves the
    // forced-refresh path still reaches the endpoint when a real new kid appears.
    process.env.MCP_GW_JWKS_MIN_REFRESH_MS = '0';
    jwksKeys = [jwkOf(keyA, 'kid-a')];
    const { validateInboundToken } = freshValidator();

    // kid-b not yet published → rejected, cache now holds only kid-a.
    await expect(validateInboundToken(sign(keyB.privateKey, 'kid-b'), GW_AUD))
      .rejects.toThrow(/No matching JWKS key/i);

    // Rotate: publish kid-b. A fresh token with the new kid must refresh and pass.
    jwksKeys = [jwkOf(keyA, 'kid-a'), jwkOf(keyB, 'kid-b')];
    const decoded = await validateInboundToken(sign(keyB.privateKey, 'kid-b'), GW_AUD);
    expect(decoded.sub).toBe('user-1');
  });

  test('concurrent unknown-kid validations share one in-flight fetch', async () => {
    process.env.MCP_GW_JWKS_MIN_REFRESH_MS = '0'; // isolate the dedupe from the rate-cap
    jwksKeys = [jwkOf(keyA, 'kid-a')];
    const { validateInboundToken } = freshValidator();

    // Fire 10 unknown-kid validations concurrently from a cold cache. They must
    // share the in-flight fetch(es) rather than opening one round-trip each.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        validateInboundToken(sign(keyA.privateKey, `burst-kid-${i}`), GW_AUD),
      ),
    );
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(hits).toBeLessThanOrEqual(2);
  });
});
