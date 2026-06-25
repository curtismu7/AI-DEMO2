// banking_api_server/routes/mcpToolScopes.js
/**
 * GET /api/mcp/tool-scopes — unauthenticated tool-scope discovery.
 * Returns the canonical list of MCP tools and the OAuth scopes each requires.
 * Used by authorize flows, UI pre-auth components, and tests to determine
 * which scopes to request before calling a given tool.
 */
const express = require('express');
const router = express.Router();
const { listLocalInspectorTools } = require('../services/mcpLocalTools');

router.get('/tool-scopes', (req, res) => {
  try {
    const tools = listLocalInspectorTools();
    const toolScopes = tools.map(t => ({
      name: t.name,
      title: t.title || t.name,
      requiredScopes: t.requiredScopes || [],
      readOnly: t.readOnly ?? true,
    }));
    res.json({ tools: toolScopes });
  } catch (err) {
    console.error('[mcpToolScopes] failed to list tool scopes:', err.message);
    res.status(500).json({ error: 'tool_scope_discovery_failed', message: err.message });
  }
});

/**
 * GET /api/mcp/tool-topology?tool=<name>
 * Returns the scope-topology entry for a single tool.
 * No auth required — topology data is not sensitive.
 */
const SCOPE_TOPOLOGY_TOOLS = (() => {
  try { return require('../../scope-topology.json').tools || {}; }
  catch { return {}; }
})();

router.get('/tool-topology', (req, res) => {
  const { tool } = req.query;
  if (!tool || typeof tool !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'tool query param required' });
  }
  const entry = SCOPE_TOPOLOGY_TOOLS[tool];
  if (!entry) {
    return res.json({ tool, found: false });
  }
  return res.json({
    tool,
    found: true,
    surface: entry.surface || null,
    requiredScopes: entry.requiredScopes || [],
    challengeType: entry.challengeType || null,
    requiresAgentMediation: entry.requiresAgentMediation || false,
    a2aDelegated: entry.a2aDelegated || false,
  });
});

module.exports = router;
