'use strict';

/**
 * RFC 6750 §3.1 / RFC 9449: every other 401 in this file builds a full
 * auth-param WWW-Authenticate value (realm, resource_metadata, error,
 * error_description) — see line 414/481/497/976/1001/1034/1067. The two
 * DPoP-required 401s wrote a bare 'WWW-Authenticate': 'DPoP' with nothing
 * else, flagged as a gap in the MCP spec-compliance audit.
 */

import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import type { GatewayConfig } from '../src/config';

const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  introspectionEndpoint: '',
} as unknown as GatewayConfig;

function makeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const headCalls: Array<{ status: number; headers: Record<string, string> }> = [];
  return {
    res: {
      writeHead: jest.fn((status: number, hdrs: Record<string, string>) => { headCalls.push({ status, headers: hdrs }); }),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn((k: string, v: string) => { headers[k] = v; }),
    } as any,
    body: () => JSON.parse(chunks.join('') || '{}'),
    wwwAuthenticate: () => headCalls[0]?.headers?.['WWW-Authenticate'],
  };
}

async function runWith(reqHeaders: Record<string, string>) {
  const middleware = buildAuthorizeMcpRequest(stubConfig, {
    introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'write' }),
    authorize: async () => ({ decision: 'PERMIT', policySource: 'p1az' }),
    exchange: async () => ({ token: 'x', targetAud: 'mcpserver.ping.demo', cached: false }),
  } as any);
  const harness = makeRes();
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_withdrawal', arguments: { from_account_id: 'a1', amount: 100 } } };
  await middleware('tok', Buffer.from(JSON.stringify(rpc)),
    { headers: reqHeaders, socket: {} } as any, harness.res, async () => {});
  return harness;
}

describe('WWW-Authenticate on DPoP 401s carries the full auth-param set', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  test('unbound token (no cnf.jkt) — same realm/resource_metadata/error shape as every other 401', async () => {
    process.env.REQUIRE_DPOP_PROOF = 'true';
    const { body, wwwAuthenticate } = await runWith({});
    expect(body().error).toBe('invalid_dpop_proof');
    const h = wwwAuthenticate();
    expect(h).toMatch(/^DPoP /);
    expect(h).toMatch(/realm="PingOne"/);
    expect(h).toMatch(/resource_metadata="/);
    expect(h).toMatch(/error="invalid_dpop_proof"/);
  });

  test('bound token with a proof that fails verification — same full shape', async () => {
    process.env.REQUIRE_DPOP_PROOF = 'true';
    process.env.ALLOW_UNSIGNED_TRAT_CONTEXT = 'true';
    const { body, wwwAuthenticate } = await runWith({
      'x-trat-context': JSON.stringify({ cnf: { jkt: 'thumb123' } }),
      dpop: 'not-a-real-proof',
    });
    expect(body().error).toBe('invalid_dpop_proof');
    const h = wwwAuthenticate();
    expect(h).toMatch(/^DPoP /);
    expect(h).toMatch(/realm="PingOne"/);
    expect(h).toMatch(/resource_metadata="/);
    expect(h).toMatch(/error="invalid_dpop_proof"/);
  });
});
