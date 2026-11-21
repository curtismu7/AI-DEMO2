'use strict';
import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import { markPrivilegeBridgeDiscovery } from '../src/auth/privilegeBridge';
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

const listBody = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
const callBody = Buffer.from(JSON.stringify({
  jsonrpc: '2.0', id: 2, method: 'tools/call',
  params: { name: 'get_my_accounts', arguments: {} },
}));

const fakeRes = () => ({ writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() }) as any;
const introspect = async () => ({ active: true, sub: 'gw-client-1', exp: 9999999999, scope: 'mcp:invoke' });

function lastAuditTrail(res: any) {
  const calls = res.setHeader.mock.calls.filter((c: any[]) => c[0] === 'X-Gw-Audit-Trail');
  return JSON.parse(calls[calls.length - 1][1]);
}

describe('authorizeMcpRequest — Privilege bridge discovery skips the PDP user lookup', () => {
  it('a marked tools/list is permitted without consulting the PDP, and says the gateway decided alone', async () => {
    const authorize = jest.fn(async () => ({ decision: 'DENY' as const, reason: 'unknown_sub: user not found in identity provider' }));
    const forwarded: string[] = [];
    const req = {} as any;
    markPrivilegeBridgeDiscovery(req);
    const res = fakeRes();
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect,
      authorize,
      exchange: async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }),
    });
    await middleware('machine-token', listBody, req, res, async (t) => { forwarded.push(t); });
    expect(authorize).not.toHaveBeenCalled();
    expect(forwarded).toEqual(['exchanged-tok']);
    const trail = lastAuditTrail(res);
    expect(trail.authorize.decision).toBe('PERMIT');
    expect(trail.authorize.policySource).toBe('local-fallback');
    expect(trail.authorize.degraded).toBe(true);
    expect(trail.authorize.reason).toMatch(/privilege bridge discovery/);
  });

  it('an unmarked tools/list still goes to the PDP, and a DENY is still a 403', async () => {
    const authorize = jest.fn(async () => ({ decision: 'DENY' as const, reason: 'unknown_sub: user not found in identity provider' }));
    const forwarded: string[] = [];
    const res = fakeRes();
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect,
      authorize,
      exchange: async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }),
    });
    await middleware('some-token', listBody, {} as any, res, async (t) => { forwarded.push(t); });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(forwarded).toHaveLength(0);
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.anything());
  });

  it('a marked tools/call is NOT bypassed: the mark never covers a call', async () => {
    const authorize = jest.fn(async () => ({ decision: 'DENY' as const, reason: 'denied by policy' }));
    const forwarded: string[] = [];
    const req = {} as any;
    markPrivilegeBridgeDiscovery(req);
    const res = fakeRes();
    // A scope the tool needs, so the gateway's own scope backstop passes and the
    // PDP is the stage that decides.
    const callIntrospect = async () => ({ active: true, sub: 'gw-client-1', exp: 9999999999, scope: 'accounts:read' });
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: callIntrospect,
      authorize,
      exchange: async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }),
    });
    await middleware('machine-token', callBody, req, res, async (t) => { forwarded.push(t); });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(forwarded).toHaveLength(0);
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.anything());
  });

  it('a marked request still fails closed when the exchange fails', async () => {
    const forwarded: string[] = [];
    const req = {} as any;
    markPrivilegeBridgeDiscovery(req);
    const res = fakeRes();
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect,
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange: async () => { throw new Error('invalid_scope'); },
    });
    await middleware('machine-token', listBody, req, res, async (t) => { forwarded.push(t); });
    expect(forwarded).toHaveLength(0);
    expect(res.writeHead).toHaveBeenCalledWith(502, expect.anything());
  });
});
