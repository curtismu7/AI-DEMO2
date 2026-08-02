'use strict';

import { routeTool, backendWsUrl, backendResourceUri } from '../src/router';
import { getScopesForGatewayTool } from '../src/auth/toolScopes';

const AIRLINES_TOOLS = ['get_airline_bookings', 'get_flight_status', 'check_seat_availability'];

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
  test.each(AIRLINES_TOOLS)('%s routes to the invest backend, not olb', (tool) => {
    expect(routeTool(tool)).toBe('invest');
  });

  test.each(AIRLINES_TOOLS)('%s dials the resource server over WebSocket', (tool) => {
    expect(backendWsUrl(routeTool(tool), cfg)).toBe('ws://mcp-resource-server:8081');
  });

  test.each(AIRLINES_TOOLS)('%s exchanges for the resource server audience', (tool) => {
    expect(backendResourceUri(routeTool(tool), cfg)).toBe('mcp-resource-server.ping.demo');
  });

  test.each(AIRLINES_TOOLS)('%s is gated on airlines:read', (tool) => {
    expect(getScopesForGatewayTool(tool)).toContain('airlines:read');
  });

  test('the invest tools are unaffected', () => {
    expect(routeTool('get_portfolio_summary')).toBe('invest');
    expect(getScopesForGatewayTool('get_portfolio_summary')).toContain('invest:read');
  });
});
