'use strict';

/**
 * adminConfig-ratelimit.test.ts — UC18 runtime rate-limit toggle via POST /admin/config.
 */

import { applyAdminConfigUpdate } from '../src/adminConfig';
import type { GatewayConfig } from '../src/config';

function freshConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    tokenEndpointAuthMethod: 'basic',
    tokenEndpoint: 'https://auth.example.com/token',
    gatewayResourceUri: 'https://mcp-gateway.example.com',
    mcpOlbWsUrl: 'ws://localhost:8080',
    mcpInvestWsUrl: 'ws://localhost:8081',
    mcpOlbResourceUri: 'https://mcp-olb.example.com',
    mcpInvestResourceUri: 'https://mcp-invest.example.com',
    pingAuthorizeEndpoint: '',
    pingAuthorizeWorkerId: '',
    p1azEnabled: false,
    hitlServiceUrl: '',
    introspectionEndpoint: '',
    devBypass: false,
    rateLimitEnabled: false,
    rateLimitMaxRequests: 20,
    rateLimitWindowMs: 60000,
    demoApiKeyServiceKey: 'demo-api-key-0000',
    mortgageServiceBaseUrl: 'http://localhost:8082',
    mortgageServiceApiKey: 'demo-mortgage-key-0000',
    bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
    bffInternalSecret: 'dev-shared-secret-change-me',
    bankingResourceServerBaseUrl: 'http://localhost:3001',
    bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
  } as GatewayConfig;
}

describe('applyAdminConfigUpdate — UC18 rate-limit fields', () => {
  it('{ rateLimitEnabled: true } stores a boolean true', () => {
    const config = freshConfig();
    const r = applyAdminConfigUpdate(config, { rateLimitEnabled: true }, 'development');
    expect(r.status).toBe(200);
    expect(config.rateLimitEnabled).toBe(true);
  });

  it('{ rateLimitEnabled: "true" } is rejected with 400', () => {
    const config = freshConfig();
    const r = applyAdminConfigUpdate(config, { rateLimitEnabled: 'true' }, 'development');
    expect(r.status).toBe(400);
    expect(config.rateLimitEnabled).toBe(false);
  });

  it('accepts positive rateLimitMaxRequests and rateLimitWindowMs', () => {
    const config = freshConfig();
    const r = applyAdminConfigUpdate(config, {
      rateLimitMaxRequests: 3,
      rateLimitWindowMs: 10000,
    }, 'development');
    expect(r.status).toBe(200);
    expect(config.rateLimitMaxRequests).toBe(3);
    expect(config.rateLimitWindowMs).toBe(10000);
  });

  it('rejects non-positive rateLimitMaxRequests', () => {
    const config = freshConfig();
    const r = applyAdminConfigUpdate(config, { rateLimitMaxRequests: 0 }, 'development');
    expect(r.status).toBe(400);
    expect(config.rateLimitMaxRequests).toBe(20);
  });
});
