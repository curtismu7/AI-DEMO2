'use strict';

jest.mock('../src/pingAuthorizeGuard', () => ({
  ...jest.requireActual('../src/pingAuthorizeGuard'),
  guardToolsList: jest.fn(),
}));

import { GatewayServer } from '../src/server/GatewayServer';
import { guardToolsList } from '../src/pingAuthorizeGuard';
import type { DecodedGatewayToken } from '../src/tokenValidator';
import type { GatewayConfig } from '../src/config';

const guard = guardToolsList as jest.MockedFunction<typeof guardToolsList>;

// governHttpToolsList only needs `this.config`; build a bare instance instead of
// opening a server.
function gatewayInstance(): any {
  const gw = Object.create(GatewayServer.prototype);
  gw.config = {} as GatewayConfig;
  return gw;
}

const decoded = { sub: 'gw-client-1', aud: 'mcpgateway.ping.demo', exp: 9999999999 } as DecodedGatewayToken;

const upstreamList = Buffer.from(JSON.stringify({
  jsonrpc: '2.0',
  id: 7,
  result: { tools: [{ name: 'get_my_accounts' }, { name: 'transfer_funds' }, { name: 'list_entitlements' }] },
}));

describe('governHttpToolsList — Privilege bridge discovery', () => {
  beforeEach(() => guard.mockReset());

  it('relays the upstream catalogue unchanged for a bridge discovery probe, without asking the PDP', async () => {
    guard.mockResolvedValue({ permitted: false, reason: 'PingAuthorize decision: DENY' } as any);
    const out = await gatewayInstance().governHttpToolsList(upstreamList, 'application/json', decoded, undefined, true);
    expect(out).toBeNull(); // null = relay the original body
    expect(guard).not.toHaveBeenCalled();
  });

  it('still fails closed for any other caller when the PDP denies', async () => {
    guard.mockResolvedValue({ permitted: false, reason: 'PingAuthorize decision: DENY' } as any);
    const out = await gatewayInstance().governHttpToolsList(upstreamList, 'application/json', decoded, undefined, false);
    expect(guard).toHaveBeenCalledTimes(1);
    const body = JSON.parse((out as Buffer).toString('utf-8'));
    expect(body.error.code).toBe(-32403);
    expect(body.error.message).toBe('PingAuthorize decision: DENY');
  });

  it('still filters the list per caller when the PDP names denied tools', async () => {
    guard.mockResolvedValue({
      permitted: true,
      deniedTools: [{ name: 'transfer_funds', reason: 'scope' }],
    } as any);
    const out = await gatewayInstance().governHttpToolsList(upstreamList, 'application/json', decoded);
    expect(guard).toHaveBeenCalledTimes(1);
    const body = JSON.parse((out as Buffer).toString('utf-8'));
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(['get_my_accounts', 'list_entitlements']);
  });
});
