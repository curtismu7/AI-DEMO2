'use strict';

/**
 * Guards that startupConfigGuard validates the RFC 8693 two-exchange final
 * audience (PINGONE_RESOURCE_TWO_EXCHANGE_URI) against scope-topology.json's
 * mcpGateway audience — so a drifted two-exchange URI fails loudly at boot
 * instead of surfacing as a silent 401 on the first delegated tool call.
 */

const guard = require('../../services/startupConfigGuard');
const scopeTopology = require('../../services/scopeTopology');

const KEY = 'PINGONE_RESOURCE_TWO_EXCHANGE_URI';

describe('startupConfigGuard — two-exchange audience checked against the SoT', () => {
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('flags a two-exchange URI that does not match the scope-topology mcpGateway audience', () => {
    process.env[KEY] = 'wrong.example.com';
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY) && i.includes('mcpGateway'))).toBe(true);
  });

  it('does not flag when the two-exchange URI equals the SoT mcpGateway audience', () => {
    process.env[KEY] = scopeTopology.audiences().mcpGateway;
    const issues = guard.collectIssues();
    expect(issues.some((i) => i.includes(KEY))).toBe(false);
  });
});
