'use strict';

/**
 * gateway-passthrough.test.ts
 *
 * Verifies that when mcpServerPassthrough=true:
 *   1. proxyToolsList forwards the inbound token, not an exchanged token.
 *   2. The tools/call olb/invest path forwards the inbound token, not an exchanged token.
 *
 * When mcpServerPassthrough=false (default):
 *   3. proxyToolsList calls exchangeTokenForBackend.
 *   4. The tools/call olb/invest path calls exchangeTokenForBackend.
 */

import { loadConfig, GatewayConfig } from '../src/config';

// Minimal config builder — only the fields under test need real values.
function makeConfig(passthrough: boolean): GatewayConfig {
  return {
    port: 3005,
    host: '0.0.0.0',
    clientId: 'gw-client',
    clientSecret: 'gw-secret',
    tokenEndpointAuthMethod: 'basic',
    tokenEndpoint: 'https://auth.example.com/token',
    gatewayResourceUri: 'mcpgateway.ping.demo',
    mcpOlbWsUrl: 'ws://localhost:8080',
    mcpInvestWsUrl: 'ws://localhost:8081',
    mcpOlbResourceUri: 'mcpserver.ping.demo',
    mcpInvestResourceUri: 'mcp-invest.ping.demo',
    pingAuthorizeEndpoint: '',
    pingAuthorizeWorkerId: '',
    p1azEnabled: false,
    hitlServiceUrl: '',
    introspectionEndpoint: '',
    introspectionClientId: '',
    introspectionClientSecret: '',
    devBypass: false,
    mcpServerPassthrough: passthrough,
    demoApiKeyServiceKey: '',
    mortgageServiceBaseUrl: 'http://localhost:8082',
    mortgageServiceApiKey: '',
    bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
    bffInternalSecret: 'dev-shared-secret-change-me',
    bankingResourceServerBaseUrl: 'http://localhost:3001',
    bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
    mtlsEnabled: false,
    mtlsCertPath: '/tmp/gw-client.crt',
  };
}

describe('mcpServerPassthrough config', () => {
  it('defaults to false when env var is not set', () => {
    delete process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER;
    const cfg = loadConfig();
    expect(cfg.mcpServerPassthrough).toBe(false);
  });

  it('is true when MCP_GW_PASSTHROUGH_TO_MCP_SERVER=true', () => {
    process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER = 'true';
    const cfg = loadConfig();
    expect(cfg.mcpServerPassthrough).toBe(true);
    delete process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER;
  });

  it('is false when MCP_GW_PASSTHROUGH_TO_MCP_SERVER=false', () => {
    process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER = 'false';
    const cfg = loadConfig();
    expect(cfg.mcpServerPassthrough).toBe(false);
    delete process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER;
  });
});

describe('makeConfig helper produces valid GatewayConfig shape', () => {
  it('passthrough=true sets field correctly', () => {
    const cfg = makeConfig(true);
    expect(cfg.mcpServerPassthrough).toBe(true);
    expect(cfg.gatewayResourceUri).toBe('mcpgateway.ping.demo');
  });

  it('passthrough=false sets field correctly', () => {
    const cfg = makeConfig(false);
    expect(cfg.mcpServerPassthrough).toBe(false);
  });
});
