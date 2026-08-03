'use strict';
/**
 * Ghost-tool guard for the pingone-admin vertical.
 *
 * A chip that pins a hosted PingOne MCP tool name is only honest if that name
 * actually resolves at execution. Two independent things can make it a ghost:
 *
 *   1. The hosted server does not expose the tool  -> the live path returns a
 *      JSON-RPC error labelled `source: live`.
 *   2. oasDiscovery has no mock payload for it     -> the offline fallback
 *      returns `{ error: 'unknown operationId: ...' }` labelled `source: mock`.
 *
 * `listGroups` was both at once (WIP bundle e4558fb8 substituted it for
 * `createUser`), so the "List Groups" chip could never produce a group list on
 * either path. These assertions fail if that class of defect returns.
 *
 * On the catalog: demo_api_ui/public/pingone-mcp-tools.html is a point-in-time
 * capture (2026-07-02, env 01d89b06) and the hosted tool surface is gated by the
 * worker app's admin roles, so it is strong evidence rather than proof. If
 * PingOne exposes a new tool that the demo legitimately wants to pin, re-capture
 * the catalog page in the same commit — do not delete this assertion.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../services/mcpPingOneHttpAdapter', () => ({
  listTools: jest.fn(),
  callTool: jest.fn(),
}));
const adapter = require('../../services/mcpPingOneHttpAdapter');
const plugin = require('../../config/verticals/pingone-admin/index');
const { getMockResponse } = require('../../services/oasDiscovery');

const CATALOG_PATH = path.join(__dirname, '../../../demo_api_ui/public/pingone-mcp-tools.html');

// Tool-name cells are `<td><code>NAME</code></td>`. Descriptions that mention a
// field inline (`... the <code>trigger</code> field`) do not match, and removed
// tools carry `<code class="removed">` so they stay excluded.
function catalogToolNames() {
  const html = fs.readFileSync(CATALOG_PATH, 'utf8');
  const names = new Set();
  for (const m of html.matchAll(/<td><code>([^<]+)<\/code><\/td>/g)) names.add(m[1]);
  return names;
}

// CORE_TOOLS is module-private; read it through the production path that
// exposes it — the labelled mock fallback of list_pingone_tools.
async function coreToolNames() {
  adapter.listTools.mockRejectedValue(
    Object.assign(new Error('offline'), { code: 'pingone_mcp_http_error' })
  );
  const { result } = await plugin.executeTool('list_pingone_tools', {}, {});
  expect(result.source).toMatch(/^mock —/);
  return result.tools.map((t) => t.name);
}

const pinnedToolNames = () =>
  plugin
    .getHeuristics()
    .map((h) => h.defaultParams && h.defaultParams.name)
    .filter(Boolean);

beforeEach(() => jest.resetAllMocks());

describe('pingone-admin pins no ghost hosted-MCP tools', () => {
  test('the catalog parses to a plausible tool set (guards the regex itself)', () => {
    const names = catalogToolNames();
    // Anchors: if parsing silently breaks, this fails instead of vacuously
    // passing every membership assertion below.
    for (const anchor of ['listUsers', 'createUser', 'listApplications', 'getEnvironment', 'listPopulations']) {
      expect(names.has(anchor)).toBe(true);
    }
    expect(names.size).toBeGreaterThan(60);
  });

  test('the captured catalog exposes no group tool', () => {
    const groupish = [...catalogToolNames()].filter((n) => /group/i.test(n));
    expect(groupish).toEqual([]);
  });

  test('every heuristic-pinned tool name exists in the captured catalog', () => {
    const catalog = catalogToolNames();
    const missing = pinnedToolNames().filter((n) => !catalog.has(n));
    expect(missing).toEqual([]);
  });

  test('every CORE_TOOLS name has a real mock payload, not an error object', async () => {
    const broken = [];
    for (const name of await coreToolNames()) {
      const resp = getMockResponse(name, {});
      if (resp && resp.error) broken.push(name);
    }
    expect(broken).toEqual([]);
  });

  test('every CORE_TOOLS name also exists in the captured catalog', async () => {
    const catalog = catalogToolNames();
    const missing = (await coreToolNames()).filter((n) => !catalog.has(n));
    expect(missing).toEqual([]);
  });
});
