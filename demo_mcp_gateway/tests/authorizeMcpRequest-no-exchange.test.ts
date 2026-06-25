'use strict';

import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import type { GatewayConfig } from '../src/config';

// Minimal config stub — only fields used by the middleware
const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  pingoneBaseUrl: 'https://auth.pingone.com/test/as',
  pingoneEnvironmentId: 'test-env',
  introspectionEndpoint: '',
  authorizeApplicationId: '',
  authorizeEnvironmentId: '',
} as unknown as GatewayConfig;

describe('authorizeMcpRequest — no exchange', () => {
  it('forwards the original bearer token unchanged (no re-exchange)', async () => {
    const forwardedTokens: string[] = [];

    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999 }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
    });

    const bearerToken = 'original-tx-token';
    const body = Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_my_accounts', arguments: {} },
    }));

    const fakeRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
      setHeader: jest.fn(),
    } as any;

    await middleware(bearerToken, body, {} as any, fakeRes, async (token) => {
      forwardedTokens.push(token);
    });

    expect(forwardedTokens).toHaveLength(1);
    expect(forwardedTokens[0]).toBe(bearerToken);
    expect(fakeRes.writeHead).not.toHaveBeenCalled();
  });
});
