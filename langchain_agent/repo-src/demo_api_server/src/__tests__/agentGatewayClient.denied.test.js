/**
 * agentGatewayClient — discovery through the WS gateway path with permitted +
 * scope-denied merge. The gateway returns permitted tools in result.tools and
 * scope-denied tools in result._meta.deniedTools; the BFF flattens them into one
 * list with a `permitted` flag + `deniedReason` so the UI can grey denied chips.
 *
 * NOTE: setup.js runs jest.resetModules() before each test, so modules are
 * require()'d INSIDE each test to share the current (post-reset) registry —
 * otherwise the SUT's lazy require resolves a different mock instance.
 */

jest.mock('../../services/mcpWebSocketClient', () => ({ mcpListTools: jest.fn(), getMcpGatewayWsUrl: jest.fn(() => 'ws://mcp-gateway:3005') }));
jest.mock('../../services/configStore', () => ({ getEffective: () => 'ws://gateway:8080' }));

describe('normalizeGatewayTools', () => {
  it('flattens permitted tools[] + _meta.deniedTools into one list with flags', () => {
    const { normalizeGatewayTools } = require('../../services/agentGatewayClient');
    const result = {
      tools: [{ name: 'view_records', description: 'r', requiredScopes: ['records:read'], vertical: 'healthcare' }],
      _meta: { deniedTools: [{ name: 'book_appointment', description: 'w', requiredScopes: ['write'], vertical: 'healthcare', deniedReason: 'insufficient_scope: requires write' }] },
    };
    const tools = normalizeGatewayTools(result);
    const byName = Object.fromEntries(tools.map(t => [t.name, t]));
    expect(byName.view_records.permitted).toBe(true);
    expect(byName.view_records.deniedReason).toBeUndefined();
    expect(byName.book_appointment.permitted).toBe(false);
    expect(byName.book_appointment.deniedReason).toMatch(/write/);
  });

  it('handles a result with no _meta (all permitted)', () => {
    const { normalizeGatewayTools } = require('../../services/agentGatewayClient');
    const tools = normalizeGatewayTools({ tools: [{ name: 'list_orders' }] });
    expect(tools).toHaveLength(1);
    expect(tools[0].permitted).toBe(true);
  });
});

describe('listAvailableTools', () => {
  it('calls the WS gateway path with the per-call vertical and returns the merged list', async () => {
    const { mcpListTools } = require('../../services/mcpWebSocketClient');
    const { listAvailableTools } = require('../../services/agentGatewayClient');
    mcpListTools.mockResolvedValue({
      tools: [{ name: 'view_records' }],
      _meta: { deniedTools: [{ name: 'book_appointment', deniedReason: 'requires write' }] },
    });
    const out = await listAvailableTools({}, 'agent-token', { vertical: 'healthcare', userSub: 'u1' });
    // vertical threaded into mcpListTools opts (4th arg); correlationId undefined
    expect(mcpListTools).toHaveBeenCalledWith('agent-token', 'u1', undefined, { vertical: 'healthcare', serverUrl: 'ws://mcp-gateway:3005' });
    const names = out.tools.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['view_records', 'book_appointment']));
    expect(out.tools.find(t => t.name === 'book_appointment').permitted).toBe(false);
  });
});
