'use strict';

/**
 * UC16 chokepoint test — guardToolCall in pingAuthorizeGuard.ts.
 *
 * Verifies that the REAL per-tool-call entry point enforces the impersonation
 * block, not just the static GatewayTokenPolicy.validate() method in isolation.
 *
 * Background: authorizeMcpRequestCore.ts calls GatewayTokenPolicy.validate()
 * with only 2 args (toolName is unknown at token-validation time), so the UC16
 * branch inside GatewayTokenPolicy was unreachable in production. The fix
 * relocates the check to guardToolCall, which has both toolName and the decoded
 * token in scope and runs once per tool call.
 *
 * These tests exercise the real chokepoint function with mocked axios so they
 * run without a live Authorization Server.
 */

import axios from 'axios';
import { guardToolCall } from '../src/pingAuthorizeGuard';
import type { GatewayConfig } from '../src/config';
import type { DecodedGatewayToken } from '../src/tokenValidator';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ── factories ─────────────────────────────────────────────────────────────────

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
    scope: 'read write transfer',
    ...overrides,
  } as DecodedGatewayToken;
}

// ── UC16 chokepoint tests ─────────────────────────────────────────────────────

describe('guardToolCall — UC16 impersonation block (real chokepoint)', () => {
  beforeEach(() => mockedAxios.post.mockReset());

  it('DENY: flag ON + agent-mediated tool (create_transfer) + no act claim', async () => {
    const config = makeConfig({ requireActForAgentTools: true });
    const decoded = makeToken(); // no act
    // axios.post should NOT be called — the UC16 block fires before the AS call
    const result = await guardToolCall('create_transfer', decoded, config);
    expect(result.permitted).toBe(false);
    expect(result.reason).toMatch(/impersonation_blocked/);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('PERMIT path reaches AS: flag ON + agent-mediated tool + act present', async () => {
    const config = makeConfig({ requireActForAgentTools: true });
    const decoded = makeToken({ act: { sub: 'agent-client-id' } } as Partial<DecodedGatewayToken>);
    mockedAxios.post.mockResolvedValue({ data: { decision: 'PERMIT' } } as never);
    const result = await guardToolCall('create_transfer', decoded, config);
    expect(result.permitted).toBe(true);
    // axios.post WAS called — UC16 passed, AS made the final decision
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('PERMIT: flag OFF + agent-mediated tool + no act — UC16 inert, AS decides', async () => {
    const config = makeConfig({ requireActForAgentTools: false });
    const decoded = makeToken(); // no act
    mockedAxios.post.mockResolvedValue({ data: { decision: 'PERMIT' } } as never);
    const result = await guardToolCall('create_transfer', decoded, config);
    expect(result.permitted).toBe(true);
    // Flag OFF → UC16 skipped; AS call proceeds normally
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('PERMIT: flag ON + non-agent-mediated tool + no act — not a mediated tool, AS decides', async () => {
    const config = makeConfig({ requireActForAgentTools: true });
    const decoded = makeToken(); // no act
    mockedAxios.post.mockResolvedValue({ data: { decision: 'PERMIT' } } as never);
    // get_my_accounts is NOT flagged requiresAgentMediation in scope-topology.json
    const result = await guardToolCall('get_my_accounts', decoded, config);
    expect(result.permitted).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});
