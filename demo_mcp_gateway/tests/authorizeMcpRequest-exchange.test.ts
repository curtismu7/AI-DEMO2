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

const body = Buffer.from(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'get_my_accounts', arguments: {} },
}));

describe('authorizeMcpRequest — RFC 8693 exchange before forward', () => {
  it('forwards the EXCHANGED token, not the inbound bearer', async () => {
    const forwarded: string[] = [];
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999 }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange: async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }),
    });
    const fakeRes = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;
    await middleware('original-tx-token', body, {} as any, fakeRes, async (t) => { forwarded.push(t); });
    expect(forwarded).toEqual(['exchanged-tok']);
  });

  it('exchanges with the bearer token AND the tool name — per-tool routing picks the backend audience (invest tools need mcp-invest)', async () => {
    const forwarded: string[] = [];
    const exchange = jest.fn(async () => ({ token: 'exchanged-tok', targetAud: 'mcp-olb.ping.demo', cached: false }));
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999 }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange,
    });
    const fakeRes = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;
    await middleware('original-tx-token', body, {} as any, fakeRes, async (t) => { forwarded.push(t); });
    expect(exchange).toHaveBeenCalledWith('original-tx-token', 'get_my_accounts');
  });

  it('fails closed with 502 + token_exchange_failed when exchange throws', async () => {
    const forwarded: string[] = [];
    const chunks: string[] = [];
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999 }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange: async () => { throw new Error('invalid_scope'); },
    });
    const fakeRes = {
      writeHead: jest.fn(),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn(),
    } as any;
    await middleware('original-tx-token', body, {} as any, fakeRes, async (t) => { forwarded.push(t); });
    expect(forwarded).toHaveLength(0);
    expect(fakeRes.writeHead).toHaveBeenCalledWith(502, expect.anything());
    const rpc = JSON.parse(chunks.join(''));
    expect(rpc.error.code).toBe(-32500);
    expect(rpc.error.data.error).toBe('token_exchange_failed');
  });
});
