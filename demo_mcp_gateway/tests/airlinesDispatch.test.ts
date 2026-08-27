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

// ── PingGateway parity ───────────────────────────────────────────────────────
// router.ts is NOT what dispatches on the live stack. When PingGateway is the
// gateway (ROUTING pingGateway=1 locally; demo_mcp_gateway is scaled to 0
// replicas on the SE cluster) this Groovy filter routes every tool call, and a
// tool missing from ITS list falls through to the OLB chain where the BFF's
// airlines plugin disowns it -- "no handler for <tool>" -- with the P1AZ
// decision reading PERMIT, because dispatch happens after authorization.
//
// That has now been found live twice: pay_airline_fee + three others on
// 2026-08-24, then get_loyalty_status + redeem_miles on 2026-08-26. Each time
// one copy of the list was fixed and the others were left to be rediscovered.
// This block holds the Groovy to the same derived source as the router, so a
// new handler cannot be added to one and forgotten in the other.
describe('PingGateway invest-dispatch mirrors the handler set', () => {
  const GROOVY_SRC = join(
    __dirname, '..', '..', 'ping-gateway', 'scripts', 'groovy', 'invest-dispatch.groovy',
  );

  function groovyBlock(name: string): string[] {
    const src = readFileSync(GROOVY_SRC, 'utf8');
    const re = new RegExp(`def ${name} = \\[([\\s\\S]*?)\\]`);
    const block = src.match(re);
    if (!block) throw new Error(`${name} not found in ${GROOVY_SRC}`);
    return [...block[1].matchAll(/'([a-z0-9_]+)'|^\s*([a-z0-9_]+)\s*:/gm)]
      .map((m) => m[1] || m[2])
      .filter(Boolean);
  }

  const routed = groovyBlock('INVEST_BACKEND_TOOLS');
  const scoped = groovyBlock('SCOPE_FOR_TOOL');

  // A regex that stops matching would reduce both to zero and pass vacuously.
  test('parsed both Groovy maps (vacuity guard)', () => {
    expect(routed.length).toBeGreaterThanOrEqual(11);
    expect(scoped.length).toBeGreaterThanOrEqual(11);
  });

  test.each(AIRLINES_TOOLS)('%s is in INVEST_BACKEND_TOOLS', (tool) => {
    expect(routed).toContain(tool);
  });

  // A routed tool with no scope entry requests the wrong backend token and the
  // resource server answers -32005 -- a different symptom, same root cause.
  test.each(AIRLINES_TOOLS)('%s has a SCOPE_FOR_TOOL entry', (tool) => {
    expect(scoped).toContain(tool);
  });
});
