'use strict';

import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import type { GatewayConfig } from '../src/config';

const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  pingoneBaseUrl: 'https://auth.pingone.com/test/as',
  pingoneEnvironmentId: 'test-env',
  introspectionEndpoint: '',
} as unknown as GatewayConfig;

describe('authorizeMcpRequest — audit trail carries P1AZ metadata', () => {
  it('serializes decisionId/policyVersion/engine/attributes into X-Gw-Audit-Trail', async () => {
    const headers: Record<string, string> = {};
    const fakeRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
      setHeader: jest.fn((k: string, v: string) => { headers[k] = v; }),
      statusCode: 200,
    } as any;

    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999 }),
      authorize: async () => ({
        decision: 'PERMIT' as const,
        decisionId: 'dec-xyz',
        policyVersion: 'mock-v1',
        engine: 'mock' as const,
        sentParameters: { ToolName: 'get_my_accounts', ClientId: 'u1' },
      }),
    });

    const body = Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_my_accounts', arguments: {} },
    }));

    await middleware('tx-token', body, {} as any, fakeRes, async () => {});

    expect(headers['X-Gw-Audit-Trail']).toBeDefined();
    const trail = JSON.parse(headers['X-Gw-Audit-Trail']);
    expect(trail.authorize.decision).toBe('PERMIT');
    expect(trail.authorize.decisionId).toBe('dec-xyz');
    expect(trail.authorize.policyVersion).toBe('mock-v1');
    expect(trail.authorize.engine).toBe('mock');
    expect(trail.authorize.attributes.ToolName).toBe('get_my_accounts');
  });
});