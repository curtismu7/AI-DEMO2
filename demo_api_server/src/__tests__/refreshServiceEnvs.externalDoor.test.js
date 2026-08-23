/**
 * @file refreshServiceEnvs.externalDoor.test.js
 *
 * scripts/refresh-service-envs.js generates ping-gateway/.env — regenerated on
 * every ./run.sh, so any value not emitted here is silently dropped even if
 * hand-added to the file. It never emitted OAUTH_MCP_ISSUER_URI, which
 * ping-gateway/scripts/groovy/external-door-401-metadata.groovy reads to build
 * the RFC 9728 resource_metadata hint on the external door's 401 challenge —
 * unset, the door advertises no hint at all and OAuth-discovery MCP clients
 * (e.g. LM Studio) have nothing pointing them at the real
 * /.well-known/oauth-protected-resource document.
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
  it('emits OAUTH_MCP_ISSUER_URI for external-door-401-metadata.groovy', () => {
    expect(pingGatewayEnvBlock()).toMatch(/OAUTH_MCP_ISSUER_URI\s*:/);
  });

  it('falls back to the live cmuir-mcp.ping-devops.com identity when unconfigured', () => {
    expect(pingGatewayEnvBlock()).toMatch(/OAUTH_MCP_ISSUER_URI.*'https:\/\/cmuir-mcp\.ping-devops\.com'/);
  });
});
