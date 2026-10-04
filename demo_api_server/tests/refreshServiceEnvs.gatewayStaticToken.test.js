/**
 * scripts/refresh-service-envs.js writes demo_mcp_resource_server/.env WHOLESALE,
 * and k8s/create-secrets.sh builds mcp-resource-server-secrets from that file. A
 * Privilege gateway static token added by hand would be deleted by the next
 * refresh, and the gateway's calls would start failing with no diff to explain it.
 * These pin that the generator carries the token and its scopes forward — and
 * that it never invents a token, because the feature is opt-in.
 *
 * The generator runs main() at require time, so assertions are made against its
 * source with `//` comments stripped (same approach as the sibling
 * refreshServiceEnvs.*.test.js files).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GENERATOR = path.join(__dirname, '..', 'scripts', 'refresh-service-envs.js');
const TOKEN = 'MCP_RESOURCE_SERVER_GATEWAY_STATIC_TOKEN';
const SCOPES = 'MCP_RESOURCE_SERVER_GATEWAY_STATIC_SCOPES';

const code = fs.readFileSync(GENERATOR, 'utf8')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

function resourceServerEnvBlock() {
  const start = code.indexOf("'demo_mcp_resource_server', '.env'), {");
  expect(start).toBeGreaterThan(-1);
  const end = code.indexOf('This is the Invest MCP resource server', start);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end);
}

describe('refresh-service-envs: Privilege gateway static token', () => {
  it('writes the token and its scopes into the resource server env', () => {
    const block = resourceServerEnvBlock();
    expect(block).toContain(`${TOKEN}: gatewayStaticToken`);
    expect(block).toContain(`${SCOPES}:`);
  });

  it('only writes them when a token exists', () => {
    expect(resourceServerEnvBlock()).toMatch(/\.\.\.\(gatewayStaticToken \? \{/);
  });

  it('carries the existing value forward and never mints one', () => {
    const decl = code.slice(code.indexOf('const gatewayStaticToken ='), code.indexOf('const gatewayStaticScopes ='));
    expect(decl).toContain(`existingResourceEnv.${TOKEN}`);
    expect(decl).not.toMatch(/randomBytes/);
  });

  it('reads the token from the vault first', () => {
    expect(code).toMatch(new RegExp(`loadVaultSecrets\\(\\[[^\\]]*'${TOKEN}'`));
  });

  it('writes scopes comma-separated so the value is never quoted', () => {
    expect(resourceServerEnvBlock()).toMatch(/join\(','\)/);
  });
});
