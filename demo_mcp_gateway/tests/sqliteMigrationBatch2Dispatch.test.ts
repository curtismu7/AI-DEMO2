'use strict';

import { routeTool, backendWsUrl, backendResourceUri } from '../src/router';
import { getScopesForGatewayTool } from '../src/auth/toolScopes';

const cfg: any = {
  mcpResourceServerWsUrl: 'ws://mcp-resource-server:8081',
  mcpOlbWsUrl: 'ws://mcp-server:8080',
  mcpResourceServerResourceUri: 'mcp-resource-server.ping.demo',
  mcpOlbResourceUri: 'mcpserver.ping.demo',
};

// Phase-1 SQLite migration, batch 2 (2026-08-17): government, manufacturing,
// university (renamed, same pattern as healthcare's view_records), plus
// workforce and abercrombie-fitch (same-name shadow — the SQLite tool name
// already matched the chip's, it just needed a router.ts entry).
const RENAMED_TOOLS = ['view_permits', 'view_work_orders', 'view_courses'];
const SHADOWED_TOOLS = ['list_expenses', 'list_anf_orders'];
const ALL_TOOLS = [...RENAMED_TOOLS, ...SHADOWED_TOOLS];

describe('batch-2 tools route to the resource server', () => {
  test.each(ALL_TOOLS)('%s routes to the invest backend, not olb', (tool) => {
    expect(routeTool(tool)).toBe('invest');
  });

  test.each(ALL_TOOLS)('%s dials the resource server over WebSocket', (tool) => {
    expect(backendWsUrl(routeTool(tool), cfg)).toBe('ws://mcp-resource-server:8081');
  });

  test.each(ALL_TOOLS)('%s exchanges for the resource server audience', (tool) => {
    expect(backendResourceUri(routeTool(tool), cfg)).toBe('mcp-resource-server.ping.demo');
  });

  test.each(ALL_TOOLS)('%s is gated on plain read, matching scope-topology.json', (tool) => {
    expect(getScopesForGatewayTool(tool)).toEqual(['read']);
  });

  test.each(['get_permit', 'get_work_order', 'get_course', 'get_expense', 'get_anf_order'])(
    '%s (no chip caller) is deliberately NOT routed here',
    (tool) => {
      expect(routeTool(tool)).toBe('olb');
    },
  );
});
