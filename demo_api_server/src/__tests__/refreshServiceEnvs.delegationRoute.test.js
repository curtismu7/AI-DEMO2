/**
 * @file refreshServiceEnvs.delegationRoute.test.js
 *
 * scripts/refresh-service-envs.js generates ping-gateway/.env. It never emitted
 * DELEGATION_RESOURCE_AUDIENCE or DELEGATION_RESOURCE_SCOPE, which
 * ping-gateway/config/routes/03-mcp-delegation.json substitutes into
 * DelegationProtection's `resourceId` and DelegationResourceServerFilter's
 * `scopes` — an unset env var there resolves to an empty JSON string value,
 * which PingGateway rejects at boot with
 * `JsonValueException: /handler/config/filters/2/config/resourceId: Expecting
 * a value`, so the route never loaded (Gateway still started on its other
 * routes, so this went unnoticed). resourceId must also be an absolute URI —
 * a bare non-URI string NPEs in ResourceId.resourceId() (URI.getScheme() is
 * null without a scheme) — same shape as every other route's
 * PG_GATEWAY_RESOURCE_ID. The route's own comment documents it against a
 * fixed "test" resource/scope, not a real production audience.
 *
 * The generator calls main() at require time (it is a CLI), so it cannot be
 * imported and driven in-process — same static-source approach as
 * refreshServiceEnvs.intentSecret.test.js.
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

describe('refresh-service-envs — ping-gateway/.env delegation route', () => {
  it('emits DELEGATION_RESOURCE_AUDIENCE as an absolute URI (bare "test" NPEs ResourceId.resourceId())', () => {
    expect(pingGatewayEnvBlock()).toMatch(/DELEGATION_RESOURCE_AUDIENCE\s*:\s*'https:\/\/test'/);
  });

  it('emits DELEGATION_RESOURCE_SCOPE so 03-mcp-delegation.json builds', () => {
    expect(pingGatewayEnvBlock()).toMatch(/DELEGATION_RESOURCE_SCOPE\s*:\s*'test'/);
  });
});
