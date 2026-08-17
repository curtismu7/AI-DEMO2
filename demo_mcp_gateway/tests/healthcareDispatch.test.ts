'use strict';

import { routeTool, backendWsUrl, backendResourceUri } from '../src/router';
import { getScopesForGatewayTool } from '../src/auth/toolScopes';

const cfg: any = {
  mcpResourceServerWsUrl: 'ws://mcp-resource-server:8081',
  mcpOlbWsUrl: 'ws://mcp-server:8080',
  mcpResourceServerResourceUri: 'mcp-resource-server.ping.demo',
  mcpOlbResourceUri: 'mcpserver.ping.demo',
};

// Phase-1 SQLite migration pilot: view_records is the SAME tool name the BFF's
// seed-backed handler used. Without an explicit routeTool() entry it falls
// through to 'olb' and the SQLite backend is unreachable — same shadowing bug
// found in retail/workforce/abercrombie-fitch during the 2026-08-17 audit.
describe('healthcare view_records routes to the resource server', () => {
  test('routes to the invest backend, not olb', () => {
    expect(routeTool('view_records')).toBe('invest');
  });

  test('dials the resource server over WebSocket', () => {
    expect(backendWsUrl(routeTool('view_records'), cfg)).toBe('ws://mcp-resource-server:8081');
  });

  test('exchanges for the resource server audience', () => {
    expect(backendResourceUri(routeTool('view_records'), cfg)).toBe('mcp-resource-server.ping.demo');
  });

  test('is gated on plain read, matching scope-topology.json (no vertical scope invented)', () => {
    expect(getScopesForGatewayTool('view_records')).toEqual(['read']);
  });

  test('get_patient_record (no chip caller) is deliberately NOT routed here', () => {
    expect(routeTool('get_patient_record')).toBe('olb');
  });
});
