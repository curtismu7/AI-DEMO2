'use strict';

import { readFileSync } from 'fs';
import { join } from 'path';
import { routeTool, backendWsUrl, backendResourceUri } from '../src/router';
import { getScopesForGatewayTool } from '../src/auth/toolScopes';

// Derived, not hand-listed. This file used to name three tools; the router's own
// set was missing two OTHERS (get_loyalty_status, redeem_miles), so a subset
// list could never see the gap. Read the resource server's exported set — the
// only place that knows which airlines tools actually have a handler — and hold
// the router to it.
const HANDLER_SRC = join(
  __dirname, '..', '..', 'demo_mcp_resource_server', 'src', 'tools', 'airlinesToolHandler.ts',
);

function handlerToolNames(): string[] {
  const src = readFileSync(HANDLER_SRC, 'utf8');
  const block = src.match(/export const AIRLINES_TOOL_NAMES = new Set\(\[([\s\S]*?)\]\)/);
  if (!block) throw new Error(`AIRLINES_TOOL_NAMES not found in ${HANDLER_SRC}`);
  return [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

const AIRLINES_TOOLS = handlerToolNames();

const cfg: any = {
  mcpResourceServerWsUrl: 'ws://mcp-resource-server:8081',
  mcpOlbWsUrl: 'ws://mcp-server:8080',
  mcpResourceServerResourceUri: 'mcp-resource-server.ping.demo',
  mcpOlbResourceUri: 'mcpserver.ping.demo',
};

// The airlines tools are served from the resource server's own SQLite database.
// If they fell through routeTool's default they would go to 'olb' (the banking
// MCP server), which does not know them — the failure surfaces as
// "Unknown tool", far from the cause.
describe('airlines tools route to the resource server', () => {
  // A regex that stops matching would silently reduce this to zero cases.
  test('derived the handler tool list (vacuity guard)', () => {
    expect(AIRLINES_TOOLS.length).toBeGreaterThanOrEqual(9);
    expect(AIRLINES_TOOLS).toContain('redeem_miles');
  });

  test.each(AIRLINES_TOOLS)('%s routes to the invest backend, not olb', (tool) => {
    expect(routeTool(tool)).toBe('invest');
  });

  test.each(AIRLINES_TOOLS)('%s dials the resource server over WebSocket', (tool) => {
    expect(backendWsUrl(routeTool(tool), cfg)).toBe('ws://mcp-resource-server:8081');
  });

  test.each(AIRLINES_TOOLS)('%s exchanges for the resource server audience', (tool) => {
    expect(backendResourceUri(routeTool(tool), cfg)).toBe('mcp-resource-server.ping.demo');
  });

  // sensitive_passenger_record is excluded, and deliberately not "fixed" here:
  // its scope-topology entry is requiredScopes ["read"] + a2aDelegatedScope
  // "pnr:read" + a2aDelegated + requiresAgentMediation + challengeType consent.
  // Its gate is the delegated scope and the mediation requirement, not the base
  // scope, so holding it to airlines:read would assert the wrong contract.
  // Broadening this list from three tools to the handler's nine surfaced it;
  // changing a live PDP scope requirement is not a drive-by, so it is left as
  // found. See TECH_DEBT.
  const SCOPE_GATED = AIRLINES_TOOLS.filter((t) => t !== 'sensitive_passenger_record');

  test.each(SCOPE_GATED)('%s is gated on airlines:read', (tool) => {
    expect(getScopesForGatewayTool(tool)).toContain('airlines:read');
  });

  test('the invest tools are unaffected', () => {
    expect(routeTool('get_portfolio_summary')).toBe('invest');
    expect(getScopesForGatewayTool('get_portfolio_summary')).toContain('invest:read');
  });
});
