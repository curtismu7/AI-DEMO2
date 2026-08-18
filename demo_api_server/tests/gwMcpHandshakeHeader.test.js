'use strict';
const { _parseGwMcpHandshake } = require('../services/mcpGatewayClient');

// The gateway performs the MCP lifecycle upstream on the gateway path, because
// the BFF is not the MCP client there — it speaks JSON-RPC over HTTP to the
// gateway. X-Gw-Mcp-Handshake is therefore the only way that handshake can reach
// the Token Chain, which previously could only say "not visible from here".
describe('_parseGwMcpHandshake', () => {
  it('parses the handshake the gateway reports', () => {
    const hs = _parseGwMcpHandshake({
      headers: {
        'x-gw-mcp-handshake': JSON.stringify({
          initialize: { status: 200, protocolVersion: '2025-11-25', serverInfo: { name: 'banking-mcp' } },
          initialized: true,
          sessionId: 'sess-1',
        }),
      },
    });
    expect(hs.initialize.protocolVersion).toBe('2025-11-25');
    expect(hs.initialized).toBe(true);
    expect(hs.sessionId).toBe('sess-1');
  });

  it('is null when the gateway did not handshake on this request', () => {
    // A request that reused a session, or a gateway predating the header.
    // Must not throw — the tool call still succeeded.
    expect(_parseGwMcpHandshake({ headers: {} })).toBeNull();
    expect(_parseGwMcpHandshake(null)).toBeNull();
  });

  it('is null rather than throwing on an unparseable header', () => {
    expect(_parseGwMcpHandshake({ headers: { 'x-gw-mcp-handshake': 'not json' } })).toBeNull();
  });
});
