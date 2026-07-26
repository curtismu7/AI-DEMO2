'use strict';

/**
 * Every vertical plugin action tool must be executable via executeBffTool → MCP,
 * not "Unknown tool" from the LangChain-only registry.
 */
const verticalDispatch = require('../../services/verticalDispatch');
const { verticalManifest } = require('../../services/verticalManifest');

jest.mock('../../utils/mcpToolRegistry', () => ({
  callMcpToolInternal: jest.fn(async () =>
    JSON.stringify({ success: true, render: 'test', data: {} }),
  ),
  createMcpToolRegistry: jest.fn(() => []),
}));

jest.mock('../../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(async () => ({
    token: 'tok',
    tokenEvents: [],
  })),
}));

const { executeBffTool } = require('../../services/bffMcpToolExecutor');

describe('bffMcpToolExecutor — all plugin tools', () => {
  verticalManifest.init();
  const toolNames = [];
  for (const v of verticalManifest.listAll()) {
    const id = v.id;
    if (id === 'banking') continue;
    const p = verticalDispatch.resolvePlugin(id);
    if (p && typeof p.getTools === 'function') {
      for (const t of p.getTools()) toolNames.push({ id, name: t.name });
    }
  }
  const adminOverlay = verticalDispatch.resolvePlugin('admin');
  if (adminOverlay && typeof adminOverlay.getTools === 'function') {
    for (const t of adminOverlay.getTools()) toolNames.push({ id: 'admin-overlay', name: t.name });
  }

  it('collects tools from every non-banking vertical plugin', () => {
    expect(toolNames.length).toBeGreaterThan(10);
    expect(toolNames.some((t) => t.id === 'healthcare' && t.name === 'view_coverage')).toBe(true);
    expect(toolNames.some((t) => t.name === 'lookup_customer')).toBe(true);
  });

  it.each(toolNames.map((t) => [t.id, t.name]))(
    '%s/%s is recognized and does not return Unknown tool',
    async (verticalId, name) => {
      expect(verticalDispatch.isPluginToolName(name)).toBe(true);
      const raw = await executeBffTool({
        name,
        args: {},
        userId: 'u1',
        userToken: 'user-tok',
        sessionId: 'sess',
        tokenEvents: [],
      });
      // Guard the DISPATCH-level rejection only (bffMcpToolExecutor emits
      // `Unknown tool: ${name}` for an unrecognized tool). Some teaching tools
      // (oauth-teaching/*) legitimately embed "Unknown tool: <other-tool>" in
      // their narrative output, so match this tool's own name, not the phrase.
      expect(String(raw)).not.toMatch(new RegExp(`Unknown tool: ${name}`));
    },
  );
});
