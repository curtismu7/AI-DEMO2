'use strict';

// adminAgentService.js used to send the live PingOne MCP server's raw tool
// catalog (76 tools, ~160KB of JSON schema -- createApplication alone is
// 20.5KB) directly to the LLM. That blows past llama.cpp's 8192-token
// context window before the model even sees the user's message, and
// llama-server's grammar compiler chokes on it ("failed to parse grammar").
// Fix: reuse the small list_pingone_tools/call_pingone_tool wrapper that
// config/verticals/pingone-admin/tools.js already implements (and the
// other pingone-admin agent path already uses successfully) instead of
// exposing the raw catalog directly.

// This repo's global src/__tests__/setup.js calls jest.resetModules() in its
// own afterEach. config/admin/tools.js lazy-requires
// config/verticals/pingone-admin/tools.js (which top-level-requires
// mcpPingOneHttpAdapter) inside each function body, so after a reset that
// chain resolves to a fresh mock instance distinct from one captured at
// file-load time. Fix: re-require the adapter in beforeEach, matching the
// pattern in adminAgentService.llmProvider.test.js.
jest.mock('../services/mcpPingOneHttpAdapter', () => ({
  listTools: jest.fn(),
  callTool: jest.fn(),
}));

const { buildAdminToolSchemas, executeAdminTool } = require('../config/admin/tools');

let adapter;
beforeEach(() => {
  adapter = require('../services/mcpPingOneHttpAdapter');
});

describe('buildAdminToolSchemas', () => {
  test('returns the small wrapper tool set, not the raw MCP catalog', async () => {
    const schemas = await buildAdminToolSchemas();
    const names = schemas.map((t) => t.name).sort();
    expect(names).toEqual(['api_key_demo', 'call_pingone_tool', 'dual_token_demo', 'list_pingone_tools']);
  });

  test('total schema payload stays well under the 8192-token context budget', async () => {
    const schemas = await buildAdminToolSchemas();
    const totalBytes = JSON.stringify(schemas).length;
    // ~4 chars/token is a conservative floor; the old 76-tool catalog was
    // 160,009 bytes. This should be two orders of magnitude smaller.
    expect(totalBytes).toBeLessThan(5000);
  });

  test('every schema is well-formed for LangChain .bindTools()', async () => {
    const schemas = await buildAdminToolSchemas();
    for (const t of schemas) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema).toBeDefined();
      expect(t.inputSchema.type).toBe('object');
    }
  });
});

describe('executeAdminTool', () => {
  beforeEach(() => {
    adapter.listTools.mockReset();
    adapter.callTool.mockReset();
  });

  test('call_pingone_tool dispatches to the live adapter and returns a JSON string', async () => {
    adapter.callTool.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ _embedded: { users: [{ id: 'u1' }] } }) }],
    });
    const raw = await executeAdminTool('call_pingone_tool', { name: 'listUsers', arguments: {} });
    const parsed = JSON.parse(raw);
    expect(parsed.tool).toBe('listUsers');
    expect(parsed.responseSummary).toContain('1 users found');
    // Third arg is the delegated PKCE session — null here because this call
    // supplies no ctx. The hosted server takes that token only; there is no
    // worker-token fallback (services/mcpPingOneHttpAdapter.js).
    expect(adapter.callTool).toHaveBeenCalledWith('listUsers', {}, null);
  });

  test('forwards the session so the adapter can reach the delegated PKCE token', async () => {
    adapter.callTool.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ _embedded: { users: [] } }) }],
    });
    const session = { pingoneMcpAdminToken: { accessToken: 'pkce-token' } };
    await executeAdminTool('call_pingone_tool', { name: 'listUsers', arguments: {} }, { req: { session } });
    expect(adapter.callTool).toHaveBeenCalledWith('listUsers', {}, session);
  });

  test('list_pingone_tools returns the live tool list', async () => {
    adapter.listTools.mockResolvedValue([
      { name: 'listUsers', description: 'List users' },
      { name: 'getEnvironment', description: 'Get environment' },
    ]);
    const raw = await executeAdminTool('list_pingone_tools', {});
    const parsed = JSON.parse(raw);
    expect(parsed.tools.map((t) => t.name)).toEqual(['listUsers', 'getEnvironment']);
  });

  test('unknown tool name resolves with an error payload, not a throw', async () => {
    const raw = await executeAdminTool('not_a_real_tool', {});
    const parsed = JSON.parse(raw);
    expect(parsed.error).toBeDefined();
  });
});
