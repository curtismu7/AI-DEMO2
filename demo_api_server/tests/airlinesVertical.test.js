'use strict';

/**
 * The airlines vertical is the first one whose data lives in a database owned by
 * demo_mcp_resource_server rather than in a local seed store. These assertions
 * pin the wiring that makes that true — each one guards a failure that would
 * otherwise show up as an empty chip or a confusing "Unknown tool".
 */

const path = require('path');
const NOT_MY_TOOL = Symbol.for('verticalDispatch.NOT_MY_TOOL');

const scopeTopology = require('../services/scopeTopology');
const plugin = require('../config/verticals/airlines');
const manifest = require('../config/verticals/airlines/manifest.json');

const AIRLINES_TOOLS = [
  'get_airline_bookings',      // plain read — ungated
  'cancel_airline_reservation', // Phase 2 write — step-up (MFA)
  'sensitive_airline_bookings', // Phase 2 sensitive read — HITL consent
  'get_flight_status',
  'check_seat_availability',
];

describe('airlines vertical', () => {
  test('satisfies the plugin contract', () => {
    const { validatePlugin } = require('../services/verticalManifest/pluginContract');
    expect(validatePlugin('airlines', plugin)).toEqual({ ok: true, errors: [] });
  });

  test('declares the three resource-server tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(AIRLINES_TOOLS));
  });

  // The whole point of the vertical: it must NOT answer these locally, or the
  // chip would render a seed value and the SQLite database would never be read.
  test.each(AIRLINES_TOOLS)('%s is handed to the MCP executor, not answered locally', async (name) => {
    await expect(plugin.executeTool(name, {}, {})).resolves.toBe(NOT_MY_TOOL);
  });

  test('has no local data store', () => {
    expect(plugin.getDataStore().get('any-user')).toEqual({});
  });

  test('every chip tool is declared in scope-topology and routed at the gateway', () => {
    const chipTools = manifest.dashboard.chips10.map((c) => c.tool);
    expect(chipTools).toEqual(AIRLINES_TOOLS);
    for (const tool of chipTools) {
      // The Phase-2 sensitive read carries sensitive:read ON TOP of airlines:read —
      // that extra scope is what separates it from the ungated lookup, so assert
      // airlines:read is present rather than that it is the only scope.
      expect(scopeTopology.toolScopes(tool)).toContain('airlines:read');
      expect(scopeTopology.toolSurface(tool)).toBe('gateway');
    }
    expect(scopeTopology.toolScopes('sensitive_airline_bookings')).toContain('sensitive:read');
  });

  // featureScope is the only scope config/oauthUser.js appends to the user's
  // /authorize request. Without it the user token never carries airlines:read
  // and the RFC 8693 intersection drops it before the resource server is called.
  test('featureScope puts airlines:read on the user token', () => {
    expect(manifest.scopes.featureScope).toBe('airlines:read');
  });

  test('the agent token requests airlines:read for this vertical', () => {
    const { verticalManifest } = require('../services/verticalManifest');
    verticalManifest.init();
    const { resolveAgentScopes } = require('../services/agentScopes');
    expect(resolveAgentScopes('airlines', false)).toContain('airlines:read');
  });

  test('pay_airline_fee is gateway-surfaced and scoped like the cancel write', () => {
    expect(scopeTopology.toolScopes('pay_airline_fee')).toEqual(['airlines:read', 'airlines:write']);
    expect(scopeTopology.toolSurface('pay_airline_fee')).toBe('gateway');
  });

  // The amount ladder must decide the outcome, not a pinned challengeType.
  // large_trade pins step_up unconditionally, which would render UC6's $2500
  // DENY and UC8's $300 HITL both as step-up.
  test('pay_airline_fee pins no challengeType', () => {
    const topology = require('../../scope-topology.json');
    expect(topology.tools.pay_airline_fee.challengeType).toBeUndefined();
  });

  test('the resource server declares the same tools and scope', () => {
    const toolsPath = path.join(__dirname, '..', '..', 'demo_mcp_resource_server', 'src', 'tools', 'airlinesTools.ts');
    const src = require('fs').readFileSync(toolsPath, 'utf8');
    for (const name of AIRLINES_TOOLS) expect(src).toContain(`name: '${name}'`);
    expect(src).toContain("requiredScopes: ['airlines:read']");
  });
});
