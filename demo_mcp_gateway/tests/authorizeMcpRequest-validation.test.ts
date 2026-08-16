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

const deps = {
  introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read' }),
  authorize: async () => ({ decision: 'PERMIT' as const }),
  // Step 4 now performs an RFC 8693 exchange before forwarding — stub it so
  // the forward path is reachable without a real token endpoint.
  exchange: async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }),
};

function makeRes() {
  const chunks: string[] = [];
  return {
    res: {
      writeHead: jest.fn(),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn(),
    } as any,
    body: () => JSON.parse(chunks.join('') || '{}'),
  };
}

async function run(rpc: object) {
  const middleware = buildAuthorizeMcpRequest(stubConfig, deps);
  const forwarded: string[] = [];
  const { res, body } = makeRes();
  await middleware('tok', Buffer.from(JSON.stringify(rpc)), {} as any, res, async (t) => { forwarded.push(t); });
  return { forwarded, res, body };
}

describe('authorizeMcpRequest — request validation', () => {
  it('rejects unknown methods with -32601 and does not forward', async () => {
    const { forwarded, body } = await run({ jsonrpc: '2.0', id: 1, method: 'nonexistent/method' });
    expect(forwarded).toHaveLength(0);
    expect(body().error.code).toBe(-32601);
  });
  it('rejects schema-violating tool args with -32602 and does not forward', async () => {
    const { forwarded, body } = await run({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'special_offers', arguments: { bogus: true } },
    });
    expect(forwarded).toHaveLength(0);
    expect(body().error.code).toBe(-32602);
  });
  it('rejects unknown tools with -32602 (fail closed)', async () => {
    const { forwarded, body } = await run({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'not_a_tool', arguments: {} },
    });
    expect(forwarded).toHaveLength(0);
    expect(body().error.code).toBe(-32602);
  });
  it('forwards valid tools/call untouched by validation', async () => {
    const { forwarded } = await run({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'get_my_accounts', arguments: {} },
    });
    // Forwarded with the exchanged token (RFC 8693), not the inbound bearer.
    expect(forwarded).toEqual(['exchanged-tok']);
  });
});
