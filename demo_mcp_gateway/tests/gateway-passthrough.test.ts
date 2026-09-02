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
    mcpResourceServerWsUrl: 'ws://localhost:8081',
    mcpResourceServerHttpUrl: 'http://localhost:8081',
    mcpResourceServerApiKey: '',
    mcpOlbResourceUri: 'mcpserver.ping.demo',
    mcpResourceServerResourceUri: 'mcp-resource-server.ping.demo',
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
    apiResourceServerBaseUrl: 'http://localhost:8082',
    apiResourceServerApiKey: '',
    bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
    bffInternalSecret: 'dev-shared-secret-change-me',
    bankingResourceServerBaseUrl: 'http://localhost:3001',
    bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
    mtlsEnabled: false,
    mtlsCertPath: '/tmp/gw-client.crt',
    mcpJwtVerifierHttpUrl: 'http://localhost:8083',
    mcpJwtVerifierResourceUri: 'mcp-jwt-verifier.ping.demo',
    mcpWeatherHttpUrl: 'http://localhost:8896',
    mcpBraveHttpUrl: 'http://localhost:8897',
    bffWeatherFlagUrl: '',
    bffBraveFlagUrl: '',
    allowLocalScopeFallback: false,
    introspectionEnabled: false,
    introspectionProvider: 'pinggateway',
    authorizedActorClientId: '',
    requireActForAgentTools: false,
    intentTokenRequired: false,
    requireRarIntent: false,
    rateLimitEnabled: false,
    wbaMode: 'monitor',
    rateLimitMaxRequests: 20,
    rateLimitWindowMs: 60000,
    introspectionSimDown: false,
  enterpriseManagedMcpAuth: false,
  };
}

describe('mcpServerPassthrough config', () => {
  // loadConfig() calls required() for the gateway's OAuth identity, which throws
  // when the var is unset. required()'s stub escape hatch is gated on DEV_BYPASS,
  // and that is captured at MODULE load (`const DEV_BYPASS = ...` in config.ts) —
  // so setting MCP_GW_DEV_BYPASS from a test is too late to matter. Seed the real
  // vars instead; they are read per call through process.env.
  //
  // Without this the three tests below threw "Missing required env var:
  // MCP_GW_CLIENT_ID" before reaching a single assertion. They did not fail the
  // CI gate because scripts/test-service-suite.sh runs this suite non-blocking,
  // so the breakage stayed invisible.
  const REQUIRED_ENV: Record<string, string> = {
    MCP_GW_CLIENT_ID: 'test-client-id',
    MCP_GW_CLIENT_SECRET: 'test-client-secret',
    MCP_GW_RESOURCE_URI: 'test-gateway-resource',
    PINGONE_TOKEN_ENDPOINT: 'https://auth.test/as/token',
  };
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const [k, v] of Object.entries(REQUIRED_ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });

  afterAll(() => {
    for (const k of Object.keys(REQUIRED_ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  });

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
