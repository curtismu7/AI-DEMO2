'use strict';

/**
 * UC16 wiring — authorizeMcpRequestCore.ts:112 called
 *   GatewayTokenPolicy.validate(decoded, config)
 * with no toolName and no decisionContext, so the require-act branch at
 * GatewayTokenPolicy.ts:74-86 could never fire on the HTTP transport. The
 * control existed, was flag-gated, was tested in isolation — and was unreachable
 * in production for every HTTP tool call.
 *
 * These tests drive the PIPELINE (not the static method) so they fail if the two
 * arguments are ever dropped again.
 */

import { runMcpAuthorizationPipeline } from '../src/auth/authorizeMcpRequestCore';
import type { GatewayConfig } from '../src/config';

// An introspection client that always reports the token active — we are testing
// the policy step that runs after it, not introspection itself.
const activeClient: any = {
  introspect: async () => ({ active: true, sub: 'user-123', exp: 9999999999 }),
};

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    requireActForAgentTools: true,
    authorizedActorClientId: '',
    gatewayResourceUri: 'https://mcpgateway.ping.demo',
    mcpOlbResourceUri: 'https://mcp.olb.ping.demo',
    mcpInvestResourceUri: 'https://mcp.invest.ping.demo',
    bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
    ...overrides,
  } as GatewayConfig;
}

/** Unsigned token — the pipeline only jwt.decode()s it (aud/exp already checked upstream). */
function tokenWith(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-123',
    aud: 'https://mcpgateway.ping.demo',
    exp: 9999999999,
    ...claims,
  })).toString('base64url');
  return `${header}.${payload}.`;
}

describe('runMcpAuthorizationPipeline — UC16 reaches the require-act branch', () => {
  test('act-less token for an agent-mediated tool is a policy_violation (missing_act)', async () => {
    const result = await runMcpAuthorizationPipeline(
      tokenWith({}), activeClient, makeConfig(), 'create_transfer', 'McpToolCall',
    );
    expect(result.kind).toBe('policy_violation');
    if (result.kind === 'policy_violation') {
      expect(result.code).toBe('missing_act');
    }
  });

  test('the same token WITH an act claim is authorized', async () => {
    const result = await runMcpAuthorizationPipeline(
      tokenWith({ act: { sub: 'agent-client' } }), activeClient, makeConfig(),
      'create_transfer', 'McpToolCall',
    );
    expect(result.kind).toBe('authorized');
  });

  test('the branch stays flag-gated — REQUIRE_ACT off means no violation', async () => {
    const result = await runMcpAuthorizationPipeline(
      tokenWith({}), activeClient, makeConfig({ requireActForAgentTools: false }),
      'create_transfer', 'McpToolCall',
    );
    expect(result.kind).toBe('authorized');
  });

  test('a non-agent-mediated tool is unaffected', async () => {
    const result = await runMcpAuthorizationPipeline(
      tokenWith({}), activeClient, makeConfig(), 'get_my_accounts', 'McpToolCall',
    );
    expect(result.kind).toBe('authorized');
  });

  test('omitting the two arguments still works (WS callers pass neither)', async () => {
    const result = await runMcpAuthorizationPipeline(tokenWith({}), activeClient, makeConfig());
    expect(result.kind).toBe('authorized');
  });

  test('the actor allow-list is enforced through the pipeline too', async () => {
    const result = await runMcpAuthorizationPipeline(
      tokenWith({ act: { sub: 'impostor' } }), activeClient,
      makeConfig({ authorizedActorClientId: 'the-real-exchanger' }),
      'get_my_accounts', 'McpToolCall',
    );
    expect(result.kind).toBe('policy_violation');
    if (result.kind === 'policy_violation') {
      expect(result.code).toBe('unauthorized_actor');
    }
  });
});
