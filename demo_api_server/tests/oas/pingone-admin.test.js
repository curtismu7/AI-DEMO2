'use strict';

jest.mock('../../services/mcpPingOneHttpAdapter', () => ({
  listTools: jest.fn(),
  callTool: jest.fn(),
}));
jest.mock('../../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  makeRequest: jest.fn(),
}));
const adapter = require('../../services/mcpPingOneHttpAdapter');
const pingOneUserService = require('../../services/pingOneUserService');
const plugin = require('../../config/verticals/pingone-admin/index');

const mcpJson = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
const httpErr = (msg) => Object.assign(new Error(msg), { code: 'pingone_mcp_http_error' });

beforeEach(() => jest.resetAllMocks());

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
    { name: 'createPopulation', description: 'Create a population' },
  ]);
  const { result, render } = await plugin.executeTool('list_pingone_tools', {}, {});
  expect(render).toBe('list_pingone_tools');
  expect(result.tools).toEqual([
    { name: 'listUsers', description: 'List users in the environment' },
    { name: 'createPopulation', description: 'Create a population' },
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
    ['listUsers', 'getUser', 'listPopulations', 'listApplications', 'getEnvironment']
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

test('call_pingone_tool falls back to the direct Management API for a core tool on transport failure', async () => {
  adapter.callTool.mockRejectedValue(httpErr('connect ECONNREFUSED'));
  pingOneUserService.makeRequest.mockResolvedValue({ _embedded: { users: [{ id: 'u1' }] } });
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'listUsers' }, {});
  expect(pingOneUserService.makeRequest).toHaveBeenCalledWith('GET', '/users');
  expect(result.responseSummary).toBe('1 users found');
  expect(result.source).toBe('api — hosted PingOne MCP unavailable, used direct Management API: connect ECONNREFUSED');
});

test('listUsers REST fallback preserves a PingOne SCIM filter', async () => {
  adapter.callTool.mockRejectedValue(httpErr('connect ECONNREFUSED'));
  pingOneUserService.makeRequest.mockResolvedValue({ _embedded: { users: [{ id: 'u1' }] } });

  await plugin.executeTool('call_pingone_tool', {
    name: 'listUsers',
    arguments: { filter: 'username sw "curtis"' },
  }, {});

  expect(pingOneUserService.makeRequest).toHaveBeenCalledWith(
    'GET',
    '/users?filter=username+sw+%22curtis%22',
  );
});

test('call_pingone_tool falls back to labeled mock for known tool when the Management API also fails', async () => {
  adapter.callTool.mockRejectedValue(httpErr('connect ECONNREFUSED'));
  pingOneUserService.makeRequest.mockRejectedValue(new Error('worker creds not configured'));
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'listUsers' }, {});
  expect(result.responseSummary).toBe('3 users found'); // oasDiscovery mock has 3 users
  expect(result.source).toBe('mock — PingOne MCP and Management API both unavailable: connect ECONNREFUSED');
});

test('call_pingone_tool returns labeled unavailable for unknown tool on transport failure', async () => {
  adapter.callTool.mockRejectedValue(httpErr('PingOne MCP HTTP 503'));
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'resetPassword' }, {});
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

test('call_pingone_tool createUser passes through to adapter', async () => {
  adapter.callTool.mockResolvedValue(mcpJson({ id: 'u-9', username: 'demo.user.123456' }));
  const { result } = await plugin.executeTool('call_pingone_tool', { name: 'createUser', arguments: { username: 'test' } }, {});
  expect(adapter.callTool).toHaveBeenCalledWith('createUser', { username: 'test' });
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

describe('heuristics resolve chip phrasing to live tools', () => {
  const resolve = (msg) => plugin.getHeuristics().find((h) => h.re.test(msg));

  test('discovery phrasing maps to list_pingone_tools', () => {
    const h = resolve('Show me the tools available from the PingOne MCP server');
    expect(h.action).toBe('list_pingone_tools');
  });

  test('old OAS demo page phrasing still resolves to discovery', () => {
    const h = resolve('Show me all available PingOne API operations from the OpenAPI spec');
    expect(h.action).toBe('list_pingone_tools');
  });

  test('list users maps to call_pingone_tool listUsers', () => {
    const h = resolve('List the users in my PingOne environment');
    expect(h.action).toBe('call_pingone_tool');
    expect(h.defaultParams).toEqual({ name: 'listUsers' });
  });

  test('create user maps to call_pingone_tool createUser', () => {
    const h = resolve('Create a demo user in my environment');
    expect(h.action).toBe('call_pingone_tool');
    expect(h.defaultParams).toEqual({ name: 'createUser' });
  });

  test('list applications maps to call_pingone_tool listApplications', () => {
    const h = resolve('List the applications registered in my environment');
    expect(h.action).toBe('call_pingone_tool');
    expect(h.defaultParams).toEqual({ name: 'listApplications' });
  });

  test('get environment maps to call_pingone_tool getEnvironment', () => {
    const h = resolve('Get the details of my PingOne environment');
    expect(h.action).toBe('call_pingone_tool');
    expect(h.defaultParams).toEqual({ name: 'getEnvironment' });
  });

  test('list populations maps to call_pingone_tool listPopulations', () => {
    const h = resolve('List the populations in my PingOne environment');
    expect(h.action).toBe('call_pingone_tool');
    expect(h.defaultParams).toEqual({ name: 'listPopulations' });
  });

  // The hosted server exposes no group tool, so group phrasing must NOT pin a
  // hosted tool name — it falls through to the LLM, which reads the live list.
  test('group phrasing pins no hosted tool name', () => {
    const h = resolve('List the groups in my PingOne environment');
    expect(h?.defaultParams).toBeUndefined();
  });
});
