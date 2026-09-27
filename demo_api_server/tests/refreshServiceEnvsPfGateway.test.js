'use strict';

const { buildPingGatewayPfExchangeEnv, buildOauthMcpPfStep9Env } = require('../scripts/refresh-service-envs');

test('PingGateway gets PF exchange credentials and the issuer-matching endpoint host', () => {
  expect(buildPingGatewayPfExchangeEnv({
    PF_ISSUER: 'https://local.ping-devops.com:9031',
    PF_TOKEN_ENDPOINT: 'https://pingfederate:9031/as/token.oauth2',
    PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID: 'ai-demo-pf-standard-mcp-exchanger',
    PF_STANDARD_TOKEN_EXCHANGE_CLIENT_SECRET: 'pf-standard-exchange-secret',
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
    PG_OLB_SCOPE_PF: 'read write',
    PF_MCP_ACTOR_CLIENT_ID: 'ai-demo-pf-mcp-service-actor',
    PF_MCP_ACTOR_CLIENT_SECRET: 'pf-mcp-service-actor-secret',
    PF_MCP_ACTOR_AUTH_METHOD: 'basic',
    PF_MCP_ACTOR_SCOPE: 'mcp:invoke',
  });
});

test('PingOne-only configuration leaves the PingGateway PF branch disabled', () => {
  expect(buildPingGatewayPfExchangeEnv({})).toEqual({
    PF_ISSUER_URI: '',
    PF_JWKS_URI: '',
    PF_TOKEN_ENDPOINT: '',
    PF_TE_CLIENT_ID: '',
    PF_TE_CLIENT_SECRET: '',
    PG_OLB_SCOPE_PF: 'read write',
    PF_MCP_ACTOR_CLIENT_ID: '',
    PF_MCP_ACTOR_CLIENT_SECRET: '',
    PF_MCP_ACTOR_AUTH_METHOD: 'basic',
    PF_MCP_ACTOR_SCOPE: 'mcp:invoke',
  });
});

test('PingGateway rewrites a configured PF JWKS URL to the issuer TLS host', () => {
  expect(buildPingGatewayPfExchangeEnv({
    PF_ISSUER_URI: 'https://local.ping-devops.com:9031',
    PF_JWKS_URI: 'https://pingfederate:9031/pf/JWKS',
  }).PF_JWKS_URI).toBe('https://local.ping-devops.com:9031/pf/JWKS');
});

test('oauth-mcp receives issuer-host PF Step 9 configuration and reuses the protected MCP actor secret', () => {
  const issuer = 'https://local.ping-devops.com:9999';
  expect(buildOauthMcpPfStep9Env({
    PF_ISSUER: issuer,
    PF_TOKEN_ENDPOINT: 'https://pingfederate:9999/as/token.oauth2',
    PF_MCP_SERVICE_ACTOR_CLIENT_ID: 'ai-demo-pf-standard-mcp-actor',
    PF_MCP_SERVICE_ACTOR_TOKEN_ENDPOINT_AUTH_METHOD: 'basic',
    PF_STANDARD_MCP_ACTOR_SCOPE: 'mcp:invoke',
  }, {
    PF_MCP_SERVICE_ACTOR_CLIENT_SECRET: 'vault-managed-pf-actor-secret',
  })).toEqual({
    PF_ISSUER_URI: issuer,
    PF_TOKEN_ENDPOINT: `${issuer}/as/token.oauth2`,
    PF_MCP_SERVICE_ACTOR_CLIENT_ID: 'ai-demo-pf-standard-mcp-actor',
    PF_MCP_SERVICE_ACTOR_CLIENT_SECRET: 'vault-managed-pf-actor-secret',
    PF_MCP_SERVICE_ACTOR_TOKEN_ENDPOINT_AUTH_METHOD: 'basic',
    PF_STANDARD_MCP_ACTOR_SCOPE: 'mcp:invoke',
  });
});
