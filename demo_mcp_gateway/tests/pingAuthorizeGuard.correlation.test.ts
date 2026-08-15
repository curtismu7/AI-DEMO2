'use strict';

/**
 * Item 3 (correlation propagation): the gateway must forward the request's
 * correlation id to the Authorization Server so the AS decision logs line up
 * with the gateway + BFF logs for the same request. Both guard entry points
 * (tools/list and tools/call) share authzHeaders(), which reads the id from the
 * correlation ALS context.
 */

import axios from 'axios';
import { guardToolsList, guardToolCall } from '../src/pingAuthorizeGuard';
import { runWithCorrelation } from '../src/correlationContext';
import type { GatewayConfig } from '../src/config';
import type { DecodedGatewayToken } from '../src/tokenValidator';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const config = {
  p1azEnabled: true,
  pingAuthorizeEndpoint: 'http://localhost:9999',
  pingAuthorizeWorkerId: 'policy-1',
  gatewayResourceUri: 'mcpgateway.ping.demo',
} as unknown as GatewayConfig;

const decoded = {
  sub: 'demoUser',
  // view_records' plain requiredScopes is ['read'] (scope-topology.json); 'records:read'
  // is the healthcare A2A least-privilege scope, kept alongside for fixture realism —
  // this test asserts correlation-id forwarding, not scope semantics.
  scope: 'records:read read',
  act: { sub: 'agent-1' },
} as unknown as DecodedGatewayToken;

function lastHeaders(): Record<string, string> {
  return (mockedAxios.post.mock.calls[0][2] as { headers: Record<string, string> }).headers;
}

describe('pingAuthorizeGuard — correlation id forwarded to the Authorization Server', () => {
  beforeEach(() => mockedAxios.post.mockReset());

  it('sends X-Correlation-ID on the tools/list decision call', async () => {
    mockedAxios.post.mockResolvedValue({ data: { decision: 'PERMIT', advice: [] } } as never);
    await runWithCorrelation('cid-list-123', () =>
      guardToolsList(decoded, config, 'healthcare', ['view_records']),
    );
    expect(lastHeaders()['X-Correlation-ID']).toBe('cid-list-123');
    expect(lastHeaders()['Content-Type']).toBe('application/json');
  });

  it('sends X-Correlation-ID on the tools/call decision call', async () => {
    mockedAxios.post.mockResolvedValue({ data: { decision: 'PERMIT' } } as never);
    await runWithCorrelation('cid-call-456', () =>
      guardToolCall('view_records', decoded, config),
    );
    expect(lastHeaders()['X-Correlation-ID']).toBe('cid-call-456');
  });

  it('omits X-Correlation-ID when no correlation context is active', async () => {
    mockedAxios.post.mockResolvedValue({ data: { decision: 'PERMIT', advice: [] } } as never);
    await guardToolsList(decoded, config, 'healthcare', ['view_records']);
    expect(lastHeaders()['X-Correlation-ID']).toBeUndefined();
    expect(lastHeaders()['Content-Type']).toBe('application/json');
  });
});
