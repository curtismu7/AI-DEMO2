'use strict';

/**
 * Step 3.7 — native ID-JAG tokens skip the RFC 8693 backend re-exchange.
 *
 * A native-ID-JAG-redeemed bearer is already audienced at the target backend
 * (oauth-mcp mints it that way — no gateway-mediated exchange in that model).
 * Sending it as Step 4's subject_token to PingOne's real exchanger fails
 * closed ("Cannot parse token claims for request param 'subject_token'"):
 * PingOne cannot parse a token it never signed. This forwards it unchanged
 * instead, same posture as the pre-existing weather/brave showcase bypass —
 * gated on the token's own aud already matching the resolved backend so this
 * can never widen what GatewayTokenPolicy's D-05 exemption already verified.
 */
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
  mcpOlbResourceUri: 'mcpserver.ping.demo',
} as unknown as GatewayConfig;

const ID_JAG_ISSUER = 'https://localhost:8080';

const body = Buffer.from(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'get_my_accounts', arguments: {} },
}));

describe('authorizeMcpRequest — native ID-JAG skips backend re-exchange', () => {
  it('forwards the ORIGINAL bearer unchanged when iss is the ID-JAG issuer and aud already matches the backend', async () => {
    const forwarded: string[] = [];
    const exchange = jest.fn();
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read', aud: 'mcpserver.ping.demo', iss: ID_JAG_ISSUER }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange,
    });
    const fakeRes = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;
    await middleware('id-jag-bearer', body, {} as any, fakeRes, async (t) => { forwarded.push(t); });
    expect(forwarded).toEqual(['id-jag-bearer']);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('still exchanges normally for a PingOne-issued token (unaffected)', async () => {
    const forwarded: string[] = [];
    const exchange = jest.fn(async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }));
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read', aud: 'https://gateway.ping.demo', iss: 'https://auth.pingone.com/env/as' }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange,
    });
    const fakeRes = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;
    await middleware('pingone-bearer', body, {} as any, fakeRes, async (t) => { forwarded.push(t); });
    expect(exchange).toHaveBeenCalledWith('pingone-bearer', 'get_my_accounts');
    expect(forwarded).toEqual(['exchanged-tok']);
  });

  it('still exchanges when iss is the ID-JAG issuer but aud does NOT yet match the resolved backend (not a shortcut for a mismatched token)', async () => {
    const forwarded: string[] = [];
    const exchange = jest.fn(async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }));
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read', aud: 'https://gateway.ping.demo', iss: ID_JAG_ISSUER }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange,
    });
    const fakeRes = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;
    await middleware('id-jag-bearer-wrong-aud', body, {} as any, fakeRes, async (t) => { forwarded.push(t); });
    expect(exchange).toHaveBeenCalled();
    expect(forwarded).toEqual(['exchanged-tok']);
  });

  it('records exchanged:false in the audit trail when the ID-JAG shortcut fires', async () => {
    const fakeRes = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'read', aud: 'mcpserver.ping.demo', iss: ID_JAG_ISSUER }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange: jest.fn(),
    });
    await middleware('id-jag-bearer', body, {} as any, fakeRes, async () => {});
    const headerCalls = fakeRes.setHeader.mock.calls.filter((c: any[]) => c[0] === 'X-Gw-Audit-Trail');
    const lastTrail = JSON.parse(headerCalls[headerCalls.length - 1][1]);
    expect(lastTrail.backend).toEqual({ target: 'olb', audience: 'mcpserver.ping.demo', cached: false, exchanged: false });
  });
});
