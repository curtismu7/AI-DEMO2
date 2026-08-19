'use strict';

import { routeTool, backendWsUrl, backendResourceUri } from '../src/router';
import { getScopesForGatewayTool } from '../src/auth/toolScopes';

const cfg: any = {
  mcpResourceServerWsUrl: 'ws://mcp-resource-server:8081',
  mcpOlbWsUrl: 'ws://mcp-server:8080',
  mcpResourceServerResourceUri: 'mcp-resource-server.ping.demo',
  mcpOlbResourceUri: 'mcpserver.ping.demo',
};

// Phase-1 SQLite migration, batch 3 (2026-08-17): retail + sporting-goods.
// Unlike batch 1/2, these needed a payload-shape adapter, not just a rename —
// the SQLite server's get_order/get_gear_order returned {found,order} nested;
// the chip's order_status/gear_order_status expects the order flat, with an
// OPTIONAL orderId defaulting to the most recent order. See
// retailToolHandler.ts / sportingGoodsToolHandler.ts for the adapter.
const TOOLS = ['list_orders', 'order_status', 'list_gear', 'gear_order_status'];

describe('batch-3 tools route to the resource server', () => {
  test.each(TOOLS)('%s routes to the invest backend, not olb', (tool) => {
    expect(routeTool(tool)).toBe('invest');
  });

  test.each(TOOLS)('%s dials the resource server over WebSocket', (tool) => {
    expect(backendWsUrl(routeTool(tool), cfg)).toBe('ws://mcp-resource-server:8081');
  });

  test.each(TOOLS)('%s exchanges for the resource server audience', (tool) => {
    expect(backendResourceUri(routeTool(tool), cfg)).toBe('mcp-resource-server.ping.demo');
  });

  test.each(TOOLS)('%s is gated on plain read, matching scope-topology.json', (tool) => {
    expect(getScopesForGatewayTool(tool)).toEqual(['read']);
  });
});

// The write half (2026-08-19). checkout mutates the very entity list_orders
// returns, so leaving it on the BFF meant a placed order was invisible to the
// next list — TECH_DEBT's seed-store divergence. Routed here for the same
// reason pay_airline_fee is, and gated on write rather than read.
describe('retail checkout — the write half of list_orders', () => {
  test('routes to the resource server, not olb', () => {
    expect(routeTool('checkout')).toBe('invest');
  });

  test('lands on the SAME backend as the reads it must stay consistent with', () => {
    expect(routeTool('checkout')).toBe(routeTool('list_orders'));
    expect(backendWsUrl(routeTool('checkout'), cfg)).toBe(backendWsUrl(routeTool('list_orders'), cfg));
    expect(backendResourceUri(routeTool('checkout'), cfg)).toBe(backendResourceUri(routeTool('list_orders'), cfg));
  });

  test('is gated on write, matching scope-topology.json', () => {
    expect(getScopesForGatewayTool('checkout')).toEqual(['write']);
  });
});
