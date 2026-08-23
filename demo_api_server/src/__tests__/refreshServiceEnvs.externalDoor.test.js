/**
 * @file refreshServiceEnvs.externalDoor.test.js
 *
 * scripts/refresh-service-envs.js generates ping-gateway/.env — regenerated on
 * every ./run.sh, so any value not emitted here is silently dropped even if
 * hand-added to the file. It never emitted PG_EXTERNAL_DOOR_RESOURCE_ID or
 * OAUTH_MCP_ISSUER_URI, which 00-mcp-external-door.json's ExternalDoorProtection
 * (McpProtectionFilter) substitutes for its resourceId/authorizationServerUri —
 * unset, the RFC 9728 resource_metadata it publishes falls back to whatever the
 * internal PG_GATEWAY_RESOURCE_ID route claims instead of the external door's
 * own identity.
 *
 * The generator calls main() at require time (it is a CLI), so it cannot be
 * imported and driven in-process — same static-source approach as
 * refreshServiceEnvs.delegationRoute.test.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GENERATOR = path.join(__dirname, '..', '..', 'scripts', 'refresh-service-envs.js');

function pingGatewayEnvBlock() {
  const src = fs.readFileSync(GENERATOR, 'utf8');
  const start = src.indexOf("'ping-gateway', '.env'");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("Wrote ping-gateway/.env", start);
  expect(end).toBeGreaterThan(start);
  return src
    .slice(start, end)
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

describe('refresh-service-envs — ping-gateway/.env external door', () => {
  it('emits PG_EXTERNAL_DOOR_RESOURCE_ID for ExternalDoorProtection.resourceId', () => {
    expect(pingGatewayEnvBlock()).toMatch(/PG_EXTERNAL_DOOR_RESOURCE_ID\s*:/);
  });

  it('emits OAUTH_MCP_ISSUER_URI for ExternalDoorProtection.authorizationServerUri', () => {
    expect(pingGatewayEnvBlock()).toMatch(/OAUTH_MCP_ISSUER_URI\s*:/);
  });

  it('both fall back to the live cmuir-mcp.ping-devops.com identity when unconfigured', () => {
    const block = pingGatewayEnvBlock();
    expect(block).toMatch(/PG_EXTERNAL_DOOR_RESOURCE_ID.*'https:\/\/cmuir-mcp\.ping-devops\.com\/mcp'/);
    expect(block).toMatch(/OAUTH_MCP_ISSUER_URI.*'https:\/\/cmuir-mcp\.ping-devops\.com'/);
  });
});
