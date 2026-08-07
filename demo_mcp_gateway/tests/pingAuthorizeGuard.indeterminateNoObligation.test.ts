'use strict';

/**
 * guardToolCall — WS-path parity with PingOneAuthorizeClient's HTTP path
 * (see tests/authorizeObligations.test.ts).
 *
 * An INDETERMINATE decision with NO classifiable obligation is not a
 * legitimate step-up/consent ask — it means the PDP could not produce a real
 * verdict (no rule fired, an unrecognized statement code, or absent
 * statements). That is a policy engine fault, not a business decision: it
 * must resolve to a concrete PERMIT/DENY instead of masquerading as a HITL
 * challenge the agent would then loop on forever.
 */

import axios from 'axios';
import { guardToolCall } from '../src/pingAuthorizeGuard';
import type { GatewayConfig } from '../src/config';
import type { DecodedGatewayToken } from '../src/tokenValidator';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    requireActForAgentTools: false,
    gatewayResourceUri: 'https://mcpgateway.ping.demo',
    mcpOlbResourceUri: 'https://mcp.olb.ping.demo',
    mcpResourceServerResourceUri: 'https://mcp.invest.ping.demo',
    bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
    p1azEnabled: true,
    pingAuthorizeEndpoint: 'http://localhost:9999',
    pingAuthorizeWorkerId: 'test-policy',
    pingAuthorizeMockBase: undefined,
    port: 3005,
    host: '0.0.0.0',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    tokenEndpointAuthMethod: 'basic',
    tokenEndpoint: 'https://auth.pingone.com/test/as/token',
    mcpOlbWsUrl: 'ws://localhost:8080',
    mcpResourceServerWsUrl: 'ws://localhost:8081',
    hitlServiceUrl: '',
    introspectionEndpoint: '',
    introspectionClientId: '',
    introspectionClientSecret: '',
    devBypass: false,
    mcpServerPassthrough: false,
    demoApiKeyServiceKey: '',
    apiResourceServerBaseUrl: '',
    apiResourceServerApiKey: '',
    bffInternalIdTokenUrl: '',
    bffInternalSecret: 'test-secret-that-is-long-enough-to-pass',
    bankingResourceServerBaseUrl: '',
    mtlsEnabled: false,
    mtlsCertPath: '',
    authorizedActorClientId: '',
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

describe('guardToolCall — INDETERMINATE with no obligation', () => {
  beforeEach(() => mockedAxios.post.mockReset());

  it('still permits a real HITL/step-up obligation (unchanged)', async () => {
    const config = makeConfig();
    mockedAxios.post.mockResolvedValue({
      data: { decision: 'INDETERMINATE', reason: 'STEP_UP', statements: [{ code: 'step-up-required' }] },
    } as never);
    const result = await guardToolCall('create_transfer', makeToken(), config);
    expect(result.permitted).toBe(false);
    expect(result.obligation).toBe('stepUp');
  });

  it('resolves to DENY (fail closed) when INDETERMINATE carries no statements', async () => {
    // P1AZ "could not evaluate" = missing operand or no rule fired.
    // Fail-closed: unknown outcome must never widen access.
    const config = makeConfig();
    mockedAxios.post.mockResolvedValue({
      data: { decision: 'INDETERMINATE', reason: 'policy could not evaluate' },
    } as never);
    const result = await guardToolCall('get_my_accounts', makeToken(), config);
    expect(result.permitted).toBe(false);
    expect(result.obligation).toBeUndefined();
  });

  it('resolves to DENY when INDETERMINATE statements do not classify to a known obligation', async () => {
    // Unrecognised statement code = PDP gave an answer we cannot parse.
    // Fail-closed: ambiguous ≠ permitted.
    const config = makeConfig();
    mockedAxios.post.mockResolvedValue({
      data: { decision: 'INDETERMINATE', reason: 'n/a', statements: [{ code: 'unrelated-statement' }] },
    } as never);
    const result = await guardToolCall('get_my_accounts', makeToken(), config);
    expect(result.permitted).toBe(false);
  });

  it('resolves to DENY when INDETERMINATE carries an explicit deny reason', async () => {
    const config = makeConfig();
    mockedAxios.post.mockResolvedValue({
      data: { decision: 'INDETERMINATE', reason: 'deny: policy engine could not confirm eligibility' },
    } as never);
    const result = await guardToolCall('get_my_accounts', makeToken(), config);
    expect(result.permitted).toBe(false);
  });
});
