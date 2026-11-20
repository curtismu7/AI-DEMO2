import jwt from 'jsonwebtoken';
import { runMcpAuthorizationPipeline } from '../src/auth/authorizeMcpRequestCore';
import { isPrivilegeBridgeDiscovery, markPrivilegeBridgeDiscovery } from '../src/auth/privilegeBridge';
import type { GatewayIntrospectionClient } from '../src/auth/GatewayIntrospectionClient';
import type { GatewayConfig } from '../src/config';

// The gateway's own client-credentials token, as PingOne issues it: it names the
// client and carries no `sub`.
function machineToken(claims: Record<string, unknown> = {}): string {
  return jwt.sign(
    { client_id: 'gw-client-1', aud: ['mcpgateway.ping.demo'], scope: 'mcp:invoke', ...claims },
    'test-secret',
  );
}

const activeIntrospection = {
  introspect: async () => ({ active: true }),
} as unknown as GatewayIntrospectionClient;

const config = {} as GatewayConfig;

describe('runMcpAuthorizationPipeline — Privilege bridge discovery with a machine token', () => {
  test('without the discovery option a token with no sub is still refused', async () => {
    const result = await runMcpAuthorizationPipeline(machineToken(), activeIntrospection, config);
    expect(result.kind).toBe('policy_violation');
    if (result.kind === 'policy_violation') {
      expect(result.message).toBe('Empty or missing token payload');
      expect(result.code).toBe('invalid_token');
    }
  });

  test('with the discovery option the client_id becomes the subject', async () => {
    const result = await runMcpAuthorizationPipeline(
      machineToken(), activeIntrospection, config, undefined, undefined, { bridgeDiscovery: true },
    );
    expect(result.kind).toBe('authorized');
    if (result.kind === 'authorized') {
      expect(result.decoded.sub).toBe('gw-client-1');
    }
  });

  test('the option does not rescue a token that names no client either', async () => {
    const noClient = jwt.sign({ aud: ['mcpgateway.ping.demo'] }, 'test-secret');
    const result = await runMcpAuthorizationPipeline(
      noClient, activeIntrospection, config, undefined, undefined, { bridgeDiscovery: true },
    );
    expect(result.kind).toBe('policy_violation');
  });

  test('a blank client_id is not accepted as a subject', async () => {
    const result = await runMcpAuthorizationPipeline(
      machineToken({ client_id: '   ' }), activeIntrospection, config, undefined, undefined, { bridgeDiscovery: true },
    );
    expect(result.kind).toBe('policy_violation');
  });

  test('a token that already has a sub keeps it', async () => {
    const result = await runMcpAuthorizationPipeline(
      machineToken({ sub: 'user-42' }), activeIntrospection, config, undefined, undefined, { bridgeDiscovery: true },
    );
    expect(result.kind).toBe('authorized');
    if (result.kind === 'authorized') {
      expect(result.decoded.sub).toBe('user-42');
    }
  });

  test('the identity policy still runs: a malformed act chain is refused even with the option', async () => {
    const result = await runMcpAuthorizationPipeline(
      machineToken({ act: { sub: '  ' } }), activeIntrospection, config, undefined, undefined, { bridgeDiscovery: true },
    );
    expect(result.kind).toBe('policy_violation');
    if (result.kind === 'policy_violation') {
      expect(result.code).toBe('invalid_act');
    }
  });

  test('introspection still runs first: an inactive token is refused even with the option', async () => {
    const inactive = { introspect: async () => ({ active: false }) } as unknown as GatewayIntrospectionClient;
    const result = await runMcpAuthorizationPipeline(
      machineToken(), inactive, config, undefined, undefined, { bridgeDiscovery: true },
    );
    expect(result.kind).toBe('introspection_failed');
  });
});

describe('privilege bridge discovery mark', () => {
  test('a request is not marked until GatewayServer marks it', () => {
    expect(isPrivilegeBridgeDiscovery({})).toBe(false);
    expect(isPrivilegeBridgeDiscovery(null)).toBe(false);
    expect(isPrivilegeBridgeDiscovery(undefined)).toBe(false);
  });

  test('marking one request does not mark another', () => {
    const marked = {};
    const other = {};
    markPrivilegeBridgeDiscovery(marked);
    expect(isPrivilegeBridgeDiscovery(marked)).toBe(true);
    expect(isPrivilegeBridgeDiscovery(other)).toBe(false);
  });
});
