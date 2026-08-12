'use strict';

/**
 * Regression: the boot guard must treat MCP_GW_RESOURCE_URI as an accepted-audience
 * LIST, not a single string.
 *
 * The real gateway (tokenValidator.ts) and the mock authz server (decision.js) both
 * accept a comma-separated list of valid audiences, and docker-compose.yml appends
 * the A2A gateway audience to it — A2A gets its own audience so the nested-`act`
 * composer SPEL only applies to A2A calls (pingoneProvisionService.js). So the live
 * value legitimately looks like:
 *
 *   mcpgateway.ping.demo,https://api.ping.demo:3036/mcp,mcpgateway-a2a.ping.demo
 *
 * Comparing that whole string to the single mcpGateway audience made the guard warn
 * "token validation would 401" on every boot — a false positive that trains operators
 * to ignore a guard whose whole job is catching real audience drift.
 *
 * The invariant is unchanged: the list MUST still contain the mcpGateway audience.
 * Only the comparison is containment instead of equality.
 */

const guard = require('../services/startupConfigGuard');
const scopeTopology = require('../services/scopeTopology');

const KEY = 'MCP_GW_RESOURCE_URI';

describe('startupConfigGuard — MCP gateway audience is a list, and must contain the mcpGateway audience', () => {
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('does not flag the real multi-audience value (mcpGateway + A2A + URI form)', () => {
    const aud = scopeTopology.audiences();
    process.env[KEY] = `${aud.mcpGateway},https://api.ping.demo:3036/mcp,mcpgateway-a2a.ping.demo`;
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY))).toBe(false);
  });

  it('does not flag the bare mcpGateway audience on its own', () => {
    process.env[KEY] = scopeTopology.audiences().mcpGateway;
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY))).toBe(false);
  });

  it('STILL flags a list that omits the mcpGateway audience (guard is not inert)', () => {
    const aud = scopeTopology.audiences();
    // Sanity: these must differ, or the assertion below is vacuous.
    expect(aud.mcpServer).not.toBe(aud.mcpGateway);

    process.env[KEY] = `${aud.mcpServer},mcpgateway-a2a.ping.demo`;
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY))).toBe(true);
  });

  it('STILL flags a single wrong audience', () => {
    process.env[KEY] = 'wrong-audience.example.com';
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY))).toBe(true);
  });
});
