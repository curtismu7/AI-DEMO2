'use strict';
/**
 * Integration smoke: exercises full BFF dispatch without an HTTP server.
 * Chain: verticalDispatch → pingone-admin plugin → mcpPingOneHttpAdapter (mocked)
 */
jest.mock('../../services/mcpPingOneHttpAdapter', () => ({
  listTools: jest.fn(),
  callTool: jest.fn(),
}));
const adapter = require('../../services/mcpPingOneHttpAdapter');
const { verticalManifest } = require('../../services/verticalManifest');
const verticalDispatch = require('../../services/verticalDispatch');

const mcpJson = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

beforeAll(() => { verticalManifest.init(); });
beforeEach(() => jest.resetAllMocks());

describe('pingone-admin vertical dispatch', () => {
  test('list_pingone_tools returns live tools via verticalDispatch', async () => {
    adapter.listTools.mockResolvedValue([{ name: 'listUsers', description: 'List users' }]);
    const result = await verticalDispatch.executeToolFor(
      'pingone-admin', 'list_pingone_tools', {}, { userId: 'test-user' }
    );
    expect(result.render).toBe('list_pingone_tools');
    expect(result.result.tools).toEqual([{ name: 'listUsers', description: 'List users' }]);
    expect(result.result.source).toBe('live — hosted PingOne MCP');
  });

  test('call_pingone_tool listUsers dispatches to the adapter', async () => {
    adapter.callTool.mockResolvedValue(mcpJson({ _embedded: { users: [{ id: 'u1' }] } }));
    const result = await verticalDispatch.executeToolFor(
      'pingone-admin', 'call_pingone_tool', { name: 'listUsers' }, { userId: 'test-user' }
    );
    expect(result.render).toBe('call_pingone_tool');
    expect(result.result.tool).toBe('listUsers');
    expect(result.result.responseSummary).toBe('1 users found');
    expect(result.result.source).toBe('live — hosted PingOne MCP');
  });

  test('adapter failure surfaces labeled mock fallback through dispatch', async () => {
    adapter.callTool.mockRejectedValue(
      Object.assign(new Error('PingOne MCP HTTP 401'), { code: 'pingone_mcp_http_error' })
    );
    const result = await verticalDispatch.executeToolFor(
      'pingone-admin', 'call_pingone_tool', { name: 'listUsers' }, { userId: 'test-user' }
    );
    expect(result.result.source).toBe('mock — PingOne MCP unavailable: PingOne MCP HTTP 401');
  });

  test('new tool names are recognized as plugin tools', () => {
    expect(verticalDispatch.isPluginToolName('list_pingone_tools')).toBe(true);
    expect(verticalDispatch.isPluginToolName('call_pingone_tool')).toBe(true);
  });
});
