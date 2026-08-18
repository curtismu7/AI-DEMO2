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
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read' }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange: async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }),
    });
    const fakeRes = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;
    await middleware('original-tx-token', body, {} as any, fakeRes, async (t) => { forwarded.push(t); });
    expect(forwarded).toEqual(['exchanged-tok']);
  });

  it('exchanges with the bearer token AND the tool name — per-tool routing picks the backend audience (invest tools need mcp-resource-server)', async () => {
    const forwarded: string[] = [];
    const exchange = jest.fn(async () => ({ token: 'exchanged-tok', targetAud: 'mcp-olb.ping.demo', cached: false }));
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read' }),
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
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read' }),
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

  it('records backend routing + exchange audience in the audit trail header', async () => {
    const fakeRes = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read' }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange: async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }),
    });
    await middleware('original-tx-token', body, {} as any, fakeRes, async () => {});
    const headerCalls = fakeRes.setHeader.mock.calls.filter((c: any[]) => c[0] === 'X-Gw-Audit-Trail');
    const lastTrail = JSON.parse(headerCalls[headerCalls.length - 1][1]);
    expect(lastTrail.backend).toEqual({ target: 'olb', audience: 'mcpserver.ping.demo', cached: false, exchanged: true });
  });

  it('records exchange failure in the backend audit trail before failing closed', async () => {
    const fakeRes = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read' }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange: async () => { throw new Error('invalid_scope'); },
    });
    await middleware('original-tx-token', body, {} as any, fakeRes, async () => {});
    const headerCalls = fakeRes.setHeader.mock.calls.filter((c: any[]) => c[0] === 'X-Gw-Audit-Trail');
    const lastTrail = JSON.parse(headerCalls[headerCalls.length - 1][1]);
    expect(lastTrail.backend).toEqual({ target: 'olb', audience: null, exchanged: false, error: 'invalid_scope' });
  });

  // An empty caller∩backend scope intersection makes the exchange go out
  // scope-less; PingOne answers `invalid_scope: May not request scopes for
  // multiple resources`, naming neither set. The gateway maps that into a clear
  // scope-mismatch reason so the caller learns the real cause from the RESPONSE.
  // A JWT carrying only purchase:read — the real shape of the failing token; olb
  // accepts 27 scopes, none of them that one.
  const purchaseReadToken = [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'u1', scope: 'purchase:read' })).toString('base64url'),
    '',
  ].join('.');
  const multiResourceRejection = new Error(
    'RFC 8693 exchange to backend=olb (resource=mcpserver.ping.demo) rejected with ' +
    'HTTP 400 — invalid_scope: May not request scopes for multiple resources',
  );

  it('maps an empty-scope-intersection rejection into a caller-facing scope-mismatch reason naming BOTH scope sets', async () => {
    const forwarded: string[] = [];
    const chunks: string[] = [];
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read' }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange: async () => { throw multiResourceRejection; },
    });
    const fakeRes = {
      writeHead: jest.fn(),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn(),
    } as any;
    await middleware(purchaseReadToken, body, {} as any, fakeRes, async (t) => { forwarded.push(t); });

    expect(forwarded).toHaveLength(0); // still fails closed — nothing forwarded
    const rpc = JSON.parse(chunks.join(''));
    expect(rpc.error.code).toBe(-32500);
    // Preserved discriminator so downstream token_exchange_failed handling is unchanged.
    expect(rpc.error.data.error).toBe('token_exchange_failed');
    // New structured scope-mismatch reason, naming BOTH sets.
    expect(rpc.error.data.reason).toBe('scope_mismatch');
    expect(rpc.error.data.backend).toBe('olb');
    expect(rpc.error.data.subject_scopes).toEqual(['purchase:read']); // caller's scopes
    expect(rpc.error.data.backend_scopes).toContain('read');           // backend's accepted set
    expect(rpc.error.data.backend_scopes).not.toContain('purchase:read');
    expect(rpc.error.message).toContain('purchase:read');
    expect(rpc.error.message).toContain('read');
    expect(rpc.error.message).toMatch(/scope mismatch/i);
  });

  it('leaves a generic exchange failure as token_exchange_failed with no scope_mismatch reason', async () => {
    const chunks: string[] = [];
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read' }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange: async () => { throw new Error('invalid_scope'); },
    });
    const fakeRes = {
      writeHead: jest.fn(),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn(),
    } as any;
    await middleware(purchaseReadToken, body, {} as any, fakeRes, async () => {});
    const rpc = JSON.parse(chunks.join(''));
    expect(rpc.error.data.error).toBe('token_exchange_failed');
    expect(rpc.error.data.reason).toBeUndefined();
  });
});
