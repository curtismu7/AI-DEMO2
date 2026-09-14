'use strict';

/**
 * RFC 9449 §7: a token bound to a DPoP key (cnf.jkt) must come with a valid,
 * unreplayed proof. The gateway used to fail closed only when REQUIRE_DPOP_PROOF
 * was set; otherwise it logged a missing, forged or replayed proof and let the
 * bound token through. Bound tokens now fail closed regardless of the flag, and
 * unbound tokens are unchanged.
 */

import * as crypto from 'crypto';
import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import { jwkThumbprint } from '../src/dpopVerify';
import type { GatewayConfig } from '../src/config';

const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  introspectionEndpoint: '',
} as unknown as GatewayConfig;

const BEARER = 'tok';

// Minimal ES256 DPoP proof signer, as in dpopVerify.test.ts.
function makeKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicJwk = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string };
  return { privateKey, publicJwk, jkt: jwkThumbprint(publicJwk) };
}
function signProof(key: ReturnType<typeof makeKey>): string {
  const b64url = (v: crypto.BinaryLike) => Buffer.from(v as Buffer).toString('base64url');
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk };
  const payload = {
    htu: 'https://gateway.ping.demo/mcp',
    htm: 'POST',
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    ath: crypto.createHash('sha256').update(BEARER).digest('base64url'),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(sig)}`;
}

async function runWith(reqHeaders: Record<string, string>) {
  const headCalls: Array<{ status: number; headers: Record<string, string> }> = [];
  const res = {
    writeHead: jest.fn((status: number, hdrs: Record<string, string>) => { headCalls.push({ status, headers: hdrs }); }),
    end: jest.fn(),
    setHeader: jest.fn(),
  } as any;
  const middleware = buildAuthorizeMcpRequest(stubConfig, {
    introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'write' }),
    authorize: async () => ({ decision: 'PERMIT', policySource: 'p1az' }),
    exchange: async () => ({ token: 'x', targetAud: 'mcpserver.ping.demo', cached: false }),
  } as any);
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_my_accounts', arguments: {} } };
  await middleware(BEARER, Buffer.from(JSON.stringify(rpc)), { headers: reqHeaders, socket: {} } as any, res, async () => {});
  const dpopRefusal = headCalls.find((c) => c.status === 401 && /invalid_dpop_proof/.test(c.headers?.['WWW-Authenticate'] || ''));
  return { refused: Boolean(dpopRefusal), challenge: dpopRefusal?.headers?.['WWW-Authenticate'] || '' };
}

const bound = (jkt: string) => ({ 'x-trat-context': JSON.stringify({ cnf: { jkt } }) });

describe('DPoP enforcement for key-bound tokens (REQUIRE_DPOP_PROOF unset)', () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    delete process.env.REQUIRE_DPOP_PROOF;
    process.env.ALLOW_UNSIGNED_TRAT_CONTEXT = 'true';
  });
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  test('a bound token whose proof fails verification is refused', async () => {
    const r = await runWith({ ...bound('thumb123'), dpop: 'not-a-real-proof' });
    expect(r.refused).toBe(true);
  });

  test('a bound token with no proof is refused', async () => {
    const r = await runWith(bound('thumb123'));
    expect(r.refused).toBe(true);
  });

  test('a bound token with a valid proof is not refused for DPoP', async () => {
    const key = makeKey();
    const r = await runWith({ ...bound(key.jkt), dpop: signProof(key) });
    expect(r.refused).toBe(false);
  });

  test('replaying the same valid proof is refused as a jti replay', async () => {
    const key = makeKey();
    const proof = signProof(key);
    const first = await runWith({ ...bound(key.jkt), dpop: proof });
    const replay = await runWith({ ...bound(key.jkt), dpop: proof });
    expect(first.refused).toBe(false);
    expect(replay.refused).toBe(true);
    expect(replay.challenge).toMatch(/jti replay/);
  });

  test('an unbound token without a proof is unaffected', async () => {
    const r = await runWith({});
    expect(r.refused).toBe(false);
  });
});
