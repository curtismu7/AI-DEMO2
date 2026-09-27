'use strict';

const { buildPingGatewayPfExchangeEnv } = require('../scripts/refresh-service-envs');

test('PingGateway gets PF exchange credentials and the issuer-matching endpoint host', () => {
  expect(buildPingGatewayPfExchangeEnv({
    PF_ISSUER: 'https://local.ping-devops.com:9031',
    PF_TOKEN_ENDPOINT: 'https://pingfederate:9031/as/token.oauth2',
    PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID: 'ai-demo-pf-standard-mcp-exchanger',
    PF_STANDARD_TOKEN_EXCHANGE_CLIENT_SECRET: 'pf-standard-exchange-secret',
  })).toEqual({
    PF_ISSUER_URI: 'https://local.ping-devops.com:9031',
    PF_JWKS_URI: 'https://local.ping-devops.com:9031/pf/JWKS',
    PF_TOKEN_ENDPOINT: 'https://local.ping-devops.com:9031/as/token.oauth2',
    PF_TE_CLIENT_ID: 'ai-demo-pf-standard-mcp-exchanger',
    PF_TE_CLIENT_SECRET: 'pf-standard-exchange-secret',
    PG_OLB_SCOPE_PF: 'read write',
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
  });
});

test('PingGateway rewrites a configured PF JWKS URL to the issuer TLS host', () => {
  expect(buildPingGatewayPfExchangeEnv({
    PF_ISSUER_URI: 'https://local.ping-devops.com:9031',
    PF_JWKS_URI: 'https://pingfederate:9031/pf/JWKS',
  }).PF_JWKS_URI).toBe('https://local.ping-devops.com:9031/pf/JWKS');
});
