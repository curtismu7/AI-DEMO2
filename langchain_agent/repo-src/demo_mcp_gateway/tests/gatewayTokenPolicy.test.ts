'use strict';

/**
 * Plan C Part B — GatewayTokenPolicy UC16 tests.
 *
 * Tests: flag OFF = no change; flag ON + no act + agent-mediated = DENY (missing_act);
 * flag ON + act present = PERMIT; flag ON + non-agent-mediated = PERMIT;
 * flag ON + wrong decisionContext = PERMIT; flag ON + no toolName = PERMIT (fail-open).
 * Also verifies pre-existing invariants (missing_sub, invalid_act, bypass_attempt)
 * are unaffected.
 */

import { GatewayTokenPolicy, GatewayTokenPolicyError } from '../src/auth/GatewayTokenPolicy';
import type { DecodedGatewayToken } from '../src/tokenValidator';
import type { GatewayConfig } from '../src/config';

// ── factories ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    requireActForAgentTools: false,
    gatewayResourceUri: 'https://mcpgateway.ping.demo',
    mcpOlbResourceUri: 'https://mcp.olb.ping.demo',
    mcpInvestResourceUri: 'https://mcp.invest.ping.demo',
    bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
    // remaining required fields — dev-safe stubs
    port: 3005,
    host: '0.0.0.0',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    tokenEndpointAuthMethod: 'basic',
    tokenEndpoint: 'https://auth.pingone.com/test/as/token',
    mcpOlbWsUrl: 'ws://localhost:8080',
    mcpInvestWsUrl: 'ws://localhost:8081',
    pingAuthorizeEndpoint: '',
    pingAuthorizeWorkerId: '',
    pingAuthorizeMockBase: undefined,
    p1azEnabled: false,
    hitlServiceUrl: '',
    introspectionEndpoint: '',
    introspectionClientId: '',
    introspectionClientSecret: '',
    devBypass: false,
    mcpServerPassthrough: false,
    demoApiKeyServiceKey: '',
    mortgageServiceBaseUrl: '',
    mortgageServiceApiKey: '',
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
    ...overrides,
  } as DecodedGatewayToken;
}

// ── existing invariants (regression guard) ───────────────────────────────────

describe('GatewayTokenPolicy — pre-existing invariants', () => {
  test('R-1: missing sub -> throws missing_sub', () => {
    const config = makeConfig();
    const token = makeToken({ sub: '' });
    expect(() => GatewayTokenPolicy.validate(token, config)).toThrow(
      expect.objectContaining({ code: 'missing_sub' }),
    );
  });

  test('R-2: act present with empty act.sub -> throws invalid_act', () => {
    const config = makeConfig();
    const token = makeToken({ act: { sub: '' } } as any);
    expect(() => GatewayTokenPolicy.validate(token, config)).toThrow(
      expect.objectContaining({ code: 'invalid_act' }),
    );
  });

  test('R-3: upstream aud in token -> throws bypass_attempt', () => {
    const config = makeConfig();
    // aud includes the OLB resource URI — this is D-05 bypass shape
    const token = makeToken({ aud: ['https://mcpgateway.ping.demo', 'https://mcp.olb.ping.demo'] } as any);
    expect(() => GatewayTokenPolicy.validate(token, config)).toThrow(
      expect.objectContaining({ code: 'bypass_attempt' }),
    );
  });

  test('R-4: valid token, no act, flag OFF -> no throw', () => {
    const config = makeConfig({ requireActForAgentTools: false });
    const token = makeToken(); // no act claim
    expect(() => GatewayTokenPolicy.validate(token, config)).not.toThrow();
  });

  test('R-5: valid token, with act, flag OFF -> no throw', () => {
    const config = makeConfig({ requireActForAgentTools: false });
    const token = makeToken({ act: { sub: 'agent-client-id' } } as any);
    expect(() => GatewayTokenPolicy.validate(token, config)).not.toThrow();
  });
});

// ── UC16 — new checks ────────────────────────────────────────────────────────

describe('GatewayTokenPolicy — UC16 require-act for agent-mediated tools', () => {
  test('UC-1: flag ON + no act + create_transfer (agent-mediated) + McpToolCall -> throws missing_act', () => {
    const config = makeConfig({ requireActForAgentTools: true });
    const token = makeToken(); // no act
    expect(() =>
      GatewayTokenPolicy.validate(token, config, 'create_transfer', 'McpToolCall'),
    ).toThrow(expect.objectContaining({ code: 'missing_act' }));
  });

  test('UC-2: flag ON + act present + create_transfer + McpToolCall -> no throw', () => {
    const config = makeConfig({ requireActForAgentTools: true });
    const token = makeToken({ act: { sub: 'agent-client-id' } } as any);
    expect(() =>
      GatewayTokenPolicy.validate(token, config, 'create_transfer', 'McpToolCall'),
    ).not.toThrow();
  });

  test('UC-3: flag OFF + no act + create_transfer + McpToolCall -> no throw', () => {
    const config = makeConfig({ requireActForAgentTools: false });
    const token = makeToken(); // no act
    expect(() =>
      GatewayTokenPolicy.validate(token, config, 'create_transfer', 'McpToolCall'),
    ).not.toThrow();
  });

  test('UC-4: flag ON + no act + get_my_accounts (NOT agent-mediated) + McpToolCall -> no throw', () => {
    const config = makeConfig({ requireActForAgentTools: true });
    const token = makeToken(); // no act
    expect(() =>
      GatewayTokenPolicy.validate(token, config, 'get_my_accounts', 'McpToolCall'),
    ).not.toThrow();
  });

  test('UC-5: flag ON + no act + create_transfer + McpToolsList (wrong context) -> no throw', () => {
    const config = makeConfig({ requireActForAgentTools: true });
    const token = makeToken(); // no act
    expect(() =>
      GatewayTokenPolicy.validate(token, config, 'create_transfer', 'McpToolsList'),
    ).not.toThrow();
  });

  test('UC-6: flag ON + no act + toolName=undefined (no tool) -> no throw (fail-open)', () => {
    const config = makeConfig({ requireActForAgentTools: true });
    const token = makeToken(); // no act
    expect(() =>
      GatewayTokenPolicy.validate(token, config, undefined, 'McpToolCall'),
    ).not.toThrow();
  });

  test('UC-7: flag ON + no act + unknown_tool (not in scope-topology) -> no throw (fail-open)', () => {
    const config = makeConfig({ requireActForAgentTools: true });
    const token = makeToken(); // no act
    expect(() =>
      GatewayTokenPolicy.validate(token, config, 'no_such_tool_xyz', 'McpToolCall'),
    ).not.toThrow();
  });

  test('UC-1 error message mentions the tool name and act claim', () => {
    const config = makeConfig({ requireActForAgentTools: true });
    const token = makeToken();
    let caught: GatewayTokenPolicyError | undefined;
    try {
      GatewayTokenPolicy.validate(token, config, 'create_transfer', 'McpToolCall');
    } catch (e) {
      caught = e as GatewayTokenPolicyError;
    }
    expect(caught).toBeDefined();
    expect(caught!.code).toBe('missing_act');
    expect(caught!.message).toContain('create_transfer');
    expect(caught!.message).toContain('act claim');
  });

  // act: null edge cases — explicit null must be treated identically to undefined
  test('NULL-1: act:null + flag ON + agent-mediated + McpToolCall -> throws missing_act (no bypass)', () => {
    const config = makeConfig({ requireActForAgentTools: true });
    // Explicit act: null — must be treated as "no act", same as undefined
    const token = makeToken({ act: null } as any);
    expect(() =>
      GatewayTokenPolicy.validate(token, config, 'create_transfer', 'McpToolCall'),
    ).toThrow(expect.objectContaining({ code: 'missing_act' }));
  });

  test('NULL-2: act:null + valid sub -> must not throw invalid_act (null is not a malformed chain)', () => {
    const config = makeConfig({ requireActForAgentTools: false });
    // act: null should not trigger the invalid_act guard (it means "no delegation")
    const token = makeToken({ act: null } as any);
    expect(() =>
      GatewayTokenPolicy.validate(token, config),
    ).not.toThrow();
  });

  test('NULL-3: act:null + flag ON + non-agent-mediated tool -> no throw (fail-open)', () => {
    const config = makeConfig({ requireActForAgentTools: true });
    const token = makeToken({ act: null } as any);
    expect(() =>
      GatewayTokenPolicy.validate(token, config, 'get_my_accounts', 'McpToolCall'),
    ).not.toThrow();
  });
});
