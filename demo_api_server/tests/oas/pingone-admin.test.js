'use strict';

jest.mock('../../services/mcpPingOneHttpAdapter', () => ({
  listTools: jest.fn(),
  callTool: jest.fn(),
}));
const adapter = require('../../services/mcpPingOneHttpAdapter');
const plugin = require('../../config/verticals/pingone-admin/index');

const mcpJson = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
const httpErr = (msg) => Object.assign(new Error(msg), { code: 'pingone_mcp_http_error' });

beforeEach(() => jest.clearAllMocks());

test('plugin exports required interface', () => {
  expect(typeof plugin.getManifest).toBe('function');
  expect(typeof plugin.getTools).toBe('function');
  expect(typeof plugin.getHeuristics).toBe('function');
  expect(typeof plugin.getSystemPrompt).toBe('function');
  expect(typeof plugin.executeTool).toBe('function');
  expect(typeof plugin.getAuthz).toBe('function');
});

test('getTools returns list_pingone_tools and call_pingone_tool with read scope', () => {
  const tools = plugin.getTools();
  const names = tools.map((t) => t.name);
  expect(names).toContain('list_pingone_tools');
  expect(names).toContain('call_pingone_tool');
  expect(names).not.toContain('discover_oas_operations');
  expect(names).not.toContain('call_pingone_operation');
  tools.forEach((t) => expect(t.scopes).toEqual(['read']));
});

test('list_pingone_tools returns live tool list with source: live', async () => {
  adapter.listTools.mockResolvedValue([
    { name: 'listUsers', description: 'List users in the environment' },
    { name: 'createGroup', description: 'Create a group' },
  ]);
  const { result, render } = await plugin.executeTool('list_pingone_tools', {}, {});
  expect(render).toBe('list_pingone_tools');
  expect(result.tools).toEqual([
    { name: 'listUsers', description: 'List users in the environment' },
    { name: 'createGroup', description: 'Create a group' },
  ]);
  expect(result.source).toBe('live — hosted PingOne MCP');
});

test('list_pingone_tools filter matches name or description', async () => {
  adapter.listTools.mockResolvedValue([
    { name: 'listUsers', description: 'List users' },
    { name: 'getEnvironment', description: 'Environment details' },
  ]);
  const { result } = await plugin.executeTool('list_pingone_tools', { filter: 'user' }, {});
  expect(result.tools).toHaveLength(1);
  expect(result.tools[0].name).toBe('listUsers');
});

test('list_pingone_tools falls back to labeled core list on adapter failure', async () => {
  adapter.listTools.mockRejectedValue(httpErr('PingOne MCP HTTP 401'));
  const { result, render } = await plugin.executeTool('list_pingone_tools', {}, {});
  expect(render).toBe('list_pingone_tools');
  expect(result.tools.map((t) => t.name)).toEqual(
    ['listUsers', 'getUser', 'createUser', 'listApplications', 'getEnvironment']
  );
  expect(result.source).toBe('mock — PingOne MCP unavailable: PingOne MCP HTTP 401');
});

test('call_pingone_tool listUsers parses MCP envelope and summarizes live data', async () => {
  adapter.callTool.mockResolvedValue(mcpJson({ _embedded: { users: [{ id: 'u1' }, { id: 'u2' }] } }));
  const { result, render } = await plugin.executeTool('call_pingone_tool', { name: 'listUsers' }, {});
  expect(render).toBe('call_pingone_tool');
  expect(adapter.callTool).toHaveBeenCalledWith('listUsers', {});
  expect(result.tool).toBe('listUsers');
  expect(result.responseSummary).toBe('2 users found');
  expect(result.source).toBe('live — hosted PingOne MCP');
});

test('call_pingone_tool tolerates non-JSON text content', async () => {
  adapter.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'plain status message' }] });
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'getEnvironment' }, {});
  expect(result.responseSummary).toContain('plain status message');
  expect(result.source).toBe('live — hosted PingOne MCP');
});

test('call_pingone_tool falls back to labeled mock for known tool on transport failure', async () => {
  adapter.callTool.mockRejectedValue(httpErr('connect ECONNREFUSED'));
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'listUsers' }, {});
  expect(result.responseSummary).toBe('3 users found'); // oasDiscovery mock has 3 users
  expect(result.source).toBe('mock — PingOne MCP unavailable: connect ECONNREFUSED');
});

test('call_pingone_tool returns labeled unavailable for unknown tool on transport failure', async () => {
  adapter.callTool.mockRejectedValue(httpErr('PingOne MCP HTTP 503'));
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'listGroups' }, {});
  expect(result.responseSummary).toMatch(/unavailable/i);
  expect(result.source).toBe('mock — PingOne MCP unavailable: PingOne MCP HTTP 503');
});

test('call_pingone_tool renders a JSON-RPC (validation) error as a live response', async () => {
  const rpcErr = Object.assign(new Error('INVALID_DATA: username required'), { code: 'pingone_mcp_rpc_error' });
  adapter.callTool.mockRejectedValue(rpcErr);
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'createUser', arguments: { username: 'x' } }, {});
  expect(result.responseSummary).toContain('INVALID_DATA');
  expect(result.source).toBe('live — hosted PingOne MCP');
});

test('call_pingone_tool createUser fills defaults and resolves default population when required', async () => {
  adapter.listTools.mockResolvedValue([
    { name: 'createUser', description: '', inputSchema: { type: 'object', required: ['username', 'populationId'] } },
  ]);
  adapter.callTool.mockImplementation((name) => {
    if (name === 'listPopulations') {
      return Promise.resolve(mcpJson({ _embedded: { populations: [{ id: 'pop-1', default: true }] } }));
    }
    return Promise.resolve(mcpJson({ id: 'u-9', username: 'demo.user.123456' }));
  });
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'createUser' }, {});
  const createCall = adapter.callTool.mock.calls.find(([n]) => n === 'createUser');
  expect(createCall[1].username).toMatch(/^demo\.user\.\d+$/);
  expect(createCall[1].email).toMatch(/^demo\.user\.\d+@example\.com$/);
  expect(createCall[1].populationId).toBe('pop-1');
  expect(result.source).toBe('live — hosted PingOne MCP');
});

test('call_pingone_tool without name returns error', async () => {
  const { result } = await plugin.executeTool('call_pingone_tool', {}, {});
  expect(result.error).toMatch(/name/i);
});

test('unknown vertical tool name returns error', async () => {
  const { result } = await plugin.executeTool('unknown_tool', {}, {});
  expect(result.error).toBeDefined();
});
