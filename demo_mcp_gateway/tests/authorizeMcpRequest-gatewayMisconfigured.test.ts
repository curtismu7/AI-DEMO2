'use strict';
import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import type { GatewayConfig } from '../src/config';

const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  pingoneBaseUrl: 'https://auth.pingone.com/test/as',
  pingoneEnvironmentId: 'test-env',
  introspectionEndpoint: '',
  authorizeApplicationId: '',
  authorizeEnvironmentId: '',
} as unknown as GatewayConfig;

function makeRes() {
  const chunks: string[] = [];
  const headCalls: Array<{ status: number; headers: Record<string, string> }> = [];
  return {
    res: {
      writeHead: jest.fn((status: number, headers: Record<string, string>) => { headCalls.push({ status, headers }); }),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn(),
    } as any,
    body: () => JSON.parse(chunks.join('') || '{}'),
    status: () => headCalls[0]?.status,
  };
}

async function run(deps: { introspect: () => Promise<any>; authorize: () => Promise<any>; exchange?: () => Promise<any> }, rpc: object) {
  const middleware = buildAuthorizeMcpRequest(stubConfig, {
    exchange: async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }),
    ...deps,
  } as any);
  const forwarded: string[] = [];
  const { res, body, status } = makeRes();
  const req = { headers: {}, socket: {} } as any;
  await middleware('tok', Buffer.from(JSON.stringify(rpc)), req, res, async (t) => { forwarded.push(t); });
  return { forwarded, body, status };
}

const toolCall = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_my_accounts', arguments: {} } };

describe('authorizeMcpRequest — gateway-vs-policy failure distinction', () => {
  it('introspection_unavailable (transport/auth failure) responds 503 gateway_misconfigured, not 401 login_required', async () => {
    const { status, body, forwarded } = await run({
      introspect: async () => ({ active: false, error: 'upstream_introspection_auth_error' }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
    }, toolCall);

    expect(status()).toBe(503);
    expect(body().error).toBe('gateway_misconfigured');
    expect(body().login_required).toBeUndefined();
    expect(forwarded).toHaveLength(0);
  });

  it('a confirmed inactive token still responds 401 login_required (unchanged)', async () => {
    const { status, body } = await run({
      introspect: async () => ({ active: false }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
    }, toolCall);

    expect(status()).toBe(401);
    expect(body().error).toBe('login_required');
  });

  it('a PingOne user-lookup infra failure (DENY reason=user_lookup_failed) responds 503 gateway_misconfigured, not 403 policy denied', async () => {
    const { status, body, forwarded } = await run({
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read' }),
      authorize: async () => ({ decision: 'DENY' as const, reason: 'user_lookup_failed: unable to verify user status' }),
    }, toolCall);

    expect(status()).toBe(503);
    expect(body().error).toBe('gateway_misconfigured');
    expect(forwarded).toHaveLength(0);
  });

  it('a genuine policy DENY (e.g. unknown tool) still responds 403 policy denied (unchanged)', async () => {
    const { status, body } = await run({
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read' }),
      authorize: async () => ({ decision: 'DENY' as const, reason: 'unknown_tool: no policy for "get_my_accounts"' }),
    }, toolCall);

    expect(status()).toBe(403);
    expect(body().error).not.toBe('gateway_misconfigured');
  });
});
