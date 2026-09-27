'use strict';

const fs = require('fs');
const path = require('path');

const GENERATOR = path.join(__dirname, '..', 'scripts', 'refresh-service-envs.js');

function pingGatewayEnvBlock() {
  const source = fs.readFileSync(GENERATOR, 'utf8');
  const start = source.indexOf("'ping-gateway', '.env'");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('Wrote ping-gateway/.env', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function expectBlockMatch(block, pattern) {
  expect(pattern.test(block)).toBe(true);
}

function expectBlockNotMatch(block, pattern) {
  expect(pattern.test(block)).toBe(false);
}

describe('refresh-service-envs — PingGateway PF Exchange #3 configuration', () => {
  test('generates the PF issuer, endpoint, and dedicated exchanger credentials from BFF settings', () => {
    const block = pingGatewayEnvBlock();

    expectBlockMatch(block, /PF_ISSUER_URI\s*:\s*fb\('PF_ISSUER'\)\s*\|\|\s*fb\('PF_ISSUER_URI'\)/);
    expectBlockMatch(block, /PF_TOKEN_ENDPOINT\s*:\s*fb\('PF_TOKEN_ENDPOINT'\)/);
    expectBlockMatch(block, /PF_TE_CLIENT_ID\s*:\s*fb\('PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID'\)/);
    expectBlockMatch(block, /PF_TE_CLIENT_SECRET\s*:\s*fb\('PF_STANDARD_TOKEN_EXCHANGE_CLIENT_SECRET'\)/);
    expectBlockMatch(block, /PF_TE_AUTH_METHOD\s*:\s*fb\('PF_STANDARD_TOKEN_EXCHANGE_TOKEN_ENDPOINT_AUTH_METHOD'\)\s*\|\|\s*'basic'/);
  });

  test('does not substitute PingOne exchanger credentials when PF credentials are absent', () => {
    const block = pingGatewayEnvBlock();
    const clientId = block.match(/PF_TE_CLIENT_ID\s*:[^\n]*/)?.[0] || '';
    const clientSecret = block.match(/PF_TE_CLIENT_SECRET\s*:[^\n]*/)?.[0] || '';

    expectBlockNotMatch(clientId, /mcpGateway|mcpExchanger|PINGONE_TOKEN_EXCHANGER/);
    expectBlockNotMatch(clientSecret, /mcpGateway|mcpExchanger|PINGONE_TOKEN_EXCHANGER/);
  });
});
