'use strict';

/**
 * adminConfig-safeview.test.ts — IN-01 regression test.
 *
 * GET /admin/config and the POST echo both project the live GatewayConfig
 * through the single `adminConfigSafeView` projection. This test locks the
 * invariant that the projection never exposes a secret field, so a future
 * allowed-key addition cannot silently leak credentials through either path.
 */

import { adminConfigSafeView } from '../src/adminConfig';
import type { GatewayConfig } from '../src/config';

const SECRET_KEYS = [
  'clientSecret',
  'bffInternalSecret',
  'demoApiKeyServiceKey',
  'apiResourceServerApiKey',
] as const;

function freshConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    clientId: 'test-client-id',
    clientSecret: 'SUPER-SECRET-client',
    tokenEndpointAuthMethod: 'basic',
    tokenEndpoint: 'https://auth.example.com/token',
    gatewayResourceUri: 'https://mcp-gateway.example.com',
    mcpOlbWsUrl: 'ws://localhost:8080',
    mcpResourceServerWsUrl: 'ws://localhost:8081',
    mcpOlbResourceUri: 'https://mcp-olb.example.com',
    mcpResourceServerResourceUri: 'https://mcp-resource-server.example.com',
    pingAuthorizeEndpoint: '',
    pingAuthorizeWorkerId: '',
    p1azEnabled: false,
    hitlServiceUrl: '',
    introspectionEndpoint: '',
    devBypass: false,
    demoApiKeyServiceKey: 'SUPER-SECRET-demo-key',
    apiResourceServerBaseUrl: 'http://localhost:8082',
    apiResourceServerApiKey: 'SUPER-SECRET-mortgage-key',
    bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
    bffInternalSecret: 'SUPER-SECRET-bff',
    bankingResourceServerBaseUrl: 'http://localhost:3001',
    bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
  } as GatewayConfig;
}

describe('adminConfigSafeView — IN-01 secret-leak guard', () => {
  it('does not expose any secret field as a key', () => {
    const safe = adminConfigSafeView(freshConfig());
    for (const k of SECRET_KEYS) {
      expect(Object.keys(safe)).not.toContain(k);
    }
  });

  it('does not contain any secret VALUE anywhere in the projection', () => {
    const safe = adminConfigSafeView(freshConfig());
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain('SUPER-SECRET');
  });

  it('still exposes the intended non-secret routing fields', () => {
    const safe = adminConfigSafeView(freshConfig());
    expect(safe.gatewayResourceUri).toBe('https://mcp-gateway.example.com');
    expect(safe.mcpOlbWsUrl).toBe('ws://localhost:8080');
    expect(safe.devBypass).toBe(false);
  });

  it('exposes the non-secret Phase 266/267 HTTP backend routes for the topology view', () => {
    const safe = adminConfigSafeView(freshConfig());
    expect(safe.apiResourceServerBaseUrl).toBe('http://localhost:8082');
    expect(safe.bankingResourceServerBaseUrl).toBe('http://localhost:3001');
    expect(safe.bankingResourceServerResourceUri).toBe('https://banking-resource-server.ping.demo');
  });
});
