'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildPingGatewayPfExchangeEnv,
  buildOauthMcpPfStep9Env,
} = require('../scripts/refresh-service-envs');

const GENERATOR = path.join(__dirname, '..', 'scripts', 'refresh-service-envs.js');

test('PingGateway gets issuer-host PF Exchange #3 settings and actor credentials', () => {
  expect(buildPingGatewayPfExchangeEnv({
    PF_ISSUER: 'https://local.ping-devops.com:9031',
    PF_TOKEN_ENDPOINT: 'https://pingfederate:9031/as/token.oauth2',
    PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID: 'ai-demo-pf-standard-mcp-exchanger',
    PF_STANDARD_TOKEN_EXCHANGE_CLIENT_SECRET: 'pf-standard-exchange-secret',
    PF_STANDARD_TOKEN_EXCHANGE_TOKEN_ENDPOINT_AUTH_METHOD: 'BASIC',
    PF_MCP_SERVICE_ACTOR_CLIENT_ID: 'ai-demo-pf-mcp-service-actor',
    PF_MCP_SERVICE_ACTOR_CLIENT_SECRET: 'pf-mcp-service-actor-secret',
    PF_MCP_SERVICE_ACTOR_TOKEN_ENDPOINT_AUTH_METHOD: 'basic',
    PF_STANDARD_MCP_ACTOR_SCOPE: 'mcp:invoke',
  })).toEqual({
    PF_ISSUER_URI: 'https://local.ping-devops.com:9031',
    PF_JWKS_URI: 'https://local.ping-devops.com:9031/pf/JWKS',
    PF_TOKEN_ENDPOINT: 'https://local.ping-devops.com:9031/as/token.oauth2',
    PF_TE_CLIENT_ID: 'ai-demo-pf-standard-mcp-exchanger',
    PF_TE_CLIENT_SECRET: 'pf-standard-exchange-secret',
    PF_TE_AUTH_METHOD: 'basic',
    PG_OLB_SCOPE_PF: 'read write transfer accounts:read',
    PF_MCP_ACTOR_CLIENT_ID: 'ai-demo-pf-mcp-service-actor',
    PF_MCP_ACTOR_CLIENT_SECRET: 'pf-mcp-service-actor-secret',
    PF_MCP_ACTOR_AUTH_METHOD: 'basic',
    PF_MCP_ACTOR_SCOPE: 'mcp:invoke',
  });
});

test('PingOne-only configuration leaves PF routing disabled without credential fallback', () => {
  expect(buildPingGatewayPfExchangeEnv({})).toEqual({
    PF_ISSUER_URI: '',
    PF_JWKS_URI: '',
    PF_TOKEN_ENDPOINT: '',
    PF_TE_CLIENT_ID: '',
    PF_TE_CLIENT_SECRET: '',
    PF_TE_AUTH_METHOD: 'basic',
    PG_OLB_SCOPE_PF: 'read write transfer accounts:read',
    PF_MCP_ACTOR_CLIENT_ID: '',
    PF_MCP_ACTOR_CLIENT_SECRET: '',
    PF_MCP_ACTOR_AUTH_METHOD: 'basic',
    PF_MCP_ACTOR_SCOPE: 'mcp:invoke',
  });
});

test('preserves the configured PF token endpoint auth method', () => {
  expect(buildPingGatewayPfExchangeEnv({
    PF_STANDARD_TOKEN_EXCHANGE_TOKEN_ENDPOINT_AUTH_METHOD: 'CLIENT_SECRET_POST',
  }).PF_TE_AUTH_METHOD).toBe('client_secret_post');
});

test('rewrites configured PF JWKS URL to the issuer TLS host', () => {
  expect(buildPingGatewayPfExchangeEnv({
    PF_ISSUER_URI: 'https://local.ping-devops.com:9031',
    PF_JWKS_URI: 'https://pingfederate:9031/pf/JWKS',
  }).PF_JWKS_URI).toBe('https://local.ping-devops.com:9031/pf/JWKS');
});

test('oauth-mcp gets issuer-host PF Step 9 settings and the vault-managed actor secret', () => {
  const issuer = 'https://local.ping-devops.com:9999';
  expect(buildOauthMcpPfStep9Env({
    PF_ISSUER: issuer,
    PF_TOKEN_ENDPOINT: 'https://pingfederate:9999/as/token.oauth2',
    PF_JWKS_URI: 'https://pingfederate:9999/pf/JWKS',
    PF_MCP_SERVICE_ACTOR_CLIENT_ID: 'ai-demo-pf-standard-mcp-actor',
    PF_MCP_SERVICE_ACTOR_TOKEN_ENDPOINT_AUTH_METHOD: 'basic',
    PF_STANDARD_MCP_ACTOR_SCOPE: 'mcp:invoke',
  }, {
    PF_MCP_SERVICE_ACTOR_CLIENT_SECRET: 'vault-managed-pf-actor-secret',
  })).toEqual({
    PF_ISSUER_URI: issuer,
    PF_JWKS_URI: `${issuer}/pf/JWKS`,
    PF_TOKEN_ENDPOINT: `${issuer}/as/token.oauth2`,
    PF_MCP_SERVICE_ACTOR_CLIENT_ID: 'ai-demo-pf-standard-mcp-actor',
    PF_MCP_SERVICE_ACTOR_CLIENT_SECRET: 'vault-managed-pf-actor-secret',
    PF_MCP_SERVICE_ACTOR_TOKEN_ENDPOINT_AUTH_METHOD: 'basic',
    PF_STANDARD_MCP_ACTOR_SCOPE: 'mcp:invoke',
  });
});

test('emits the shared PF environment builder for PingGateway without PingOne credential fallbacks', () => {
  const source = fs.readFileSync(GENERATOR, 'utf8');
  const start = source.indexOf("writeEnvFile(path.join(ROOT, 'ping-gateway', '.env')");
  const end = source.indexOf("console.log('[refresh-envs] Wrote ping-gateway/.env')", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = source.slice(start, end);

  expect(block).toContain('...buildPingGatewayPfExchangeEnv(apiVars)');
  expect(source).toMatch(/PF_TE_CLIENT_ID:\s*apiVars\.PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID\s*\|\|\s*''/);
  expect(source).toMatch(/PF_TE_CLIENT_SECRET:\s*apiVars\.PF_STANDARD_TOKEN_EXCHANGE_CLIENT_SECRET\s*\|\|\s*''/);
  expect(source).not.toMatch(/PF_TE_CLIENT_(?:ID|SECRET):[^\n]*(?:mcpGateway|mcpExchanger|PINGONE_TOKEN_EXCHANGER)/);
});
