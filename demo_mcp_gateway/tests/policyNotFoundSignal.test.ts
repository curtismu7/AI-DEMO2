'use strict';

/**
 * Policy-drift signal on the gateway path.
 *
 * When a tool exists in code but the authorization policy (or the mock rule
 * store / scope topology) has no matching policy for it, the mock authz returns
 * DENY with a drift reason ('unknown_tool: no policy defined'). The gateway must
 * PRESERVE that reason (not flatten it) and classify it as policy-not-found, so
 * the tools/call handler surfaces 'policy_not_found' instead of the misleading
 * 'insufficient_scope' that sends operators to chase token scopes.
 */

import axios from 'axios';
import { guardToolCall, isPolicyNotFoundReason } from '../src/pingAuthorizeGuard';
import type { GatewayConfig } from '../src/config';
import type { DecodedGatewayToken } from '../src/tokenValidator';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    requireActForAgentTools: false,
    gatewayResourceUri: 'https://mcpgateway.ping.demo',
    p1azEnabled: true,
    pingAuthorizeEndpoint: 'http://localhost:9999',
    pingAuthorizeWorkerId: 'test-policy',
    pingAuthorizeMockBase: undefined,
    bffInternalSecret: 'test-secret-that-is-long-enough-to-pass',
    ...overrides,
  } as GatewayConfig;
}

function makeToken(overrides: Partial<DecodedGatewayToken> = {}): DecodedGatewayToken {
  return {
    sub: 'user-123',
    aud: 'https://mcpgateway.ping.demo',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    scope: 'read write',
    ...overrides,
  } as DecodedGatewayToken;
}

describe('isPolicyNotFoundReason', () => {
  it('matches drift reasons (mock unknown_tool / NOT_APPLICABLE / policy_not_found)', () => {
    expect(isPolicyNotFoundReason('unknown_tool: no policy defined for tool foo')).toBe(true);
    expect(isPolicyNotFoundReason('no matching policy')).toBe(true);
    expect(isPolicyNotFoundReason('NOT_APPLICABLE')).toBe(true);
    expect(isPolicyNotFoundReason('policy_not_found')).toBe(true);
  });

  it('does NOT match genuine scope/other denials', () => {
    expect(isPolicyNotFoundReason('insufficient_scope: missing write')).toBe(false);
    expect(isPolicyNotFoundReason('PingAuthorize decision: DENY')).toBe(false);
    expect(isPolicyNotFoundReason('Authorization check unavailable')).toBe(false);
    expect(isPolicyNotFoundReason(undefined)).toBe(false);
    expect(isPolicyNotFoundReason('')).toBe(false);
  });
});

describe('guardToolCall preserves the engine DENY reason (not flattened)', () => {
  beforeEach(() => mockedAxios.post.mockReset());

  it('surfaces the mock drift reason so the handler can classify policy-not-found', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { decision: 'DENY', reason: 'unknown_tool: no policy defined for tool wire_transfer' },
    } as never);

    const result = await guardToolCall('wire_transfer', makeToken(), makeConfig());

    expect(result.permitted).toBe(false);
    expect(result.reason).toBe('unknown_tool: no policy defined for tool wire_transfer');
    expect(isPolicyNotFoundReason(result.reason)).toBe(true);
  });

  it('a genuine scope DENY reason is preserved but NOT classified as policy-not-found', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { decision: 'DENY', reason: 'insufficient_scope: missing write' },
    } as never);

    const result = await guardToolCall('create_transfer', makeToken(), makeConfig());

    expect(result.permitted).toBe(false);
    expect(isPolicyNotFoundReason(result.reason)).toBe(false);
  });

  it('falls back to a generic reason when the engine gives none', async () => {
    mockedAxios.post.mockResolvedValue({ data: { decision: 'DENY' } } as never);
    const result = await guardToolCall('create_transfer', makeToken(), makeConfig());
    expect(result.reason).toBe('PingAuthorize decision: DENY');
  });
});
