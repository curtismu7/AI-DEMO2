'use strict';
/**
 * POST /api/path/vertical-tool — MCP-server callback for vertical action tools.
 *
 * Part of "route vertical tools through the full MCP pipeline" (see
 * docs/specs/SPEC-vertical-tools-through-mcp.md). The MCP server, after a
 * tools/call for a vertical tool, calls back here with the delegated agent
 * Bearer (RFC 8693 act token) — exactly as BankingAPIClient calls /api/accounts/my
 * for banking data. This endpoint runs the SAME in-process vertical tool logic
 * (verticalDispatch.executeToolFor) that the legacy path used, so tool behavior
 * has a single source of truth in config/verticals/<id>/tools.js.
 *
 * Token custody: the Bearer never reaches the browser; the MCP server holds it.
 * Authorization: NOT decided here — PingAuthorize at the gateway already made the
 * PERMIT/HITL decision before this call (tools are pure PEPs, spec §7 decision 3).
 * This endpoint only executes and returns data.
 */
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const configStore = require('../services/configStore');
const verticalDispatch = require('../services/verticalDispatch');
const { verticalManifest } = require('../services/verticalManifest');
const { scrubRawJwts } = require('../services/jwtScrubber');

// Build tool→vertical map using verticalManifest.plugins — the SoT for all vertical tools.
// plugins.get(id) lazy-loads each vertical's index.js from disk (no pre-init needed).
// Each tool name belongs to exactly one vertical. Derived at module-load time so the
// route never depends on the global active_vertical configStore setting.
const TOOL_VERTICAL_MAP = (() => {
  const map = {};
  const verticalsDir = require('path').join(__dirname, '../config/verticals');
  for (const id of require('fs').readdirSync(verticalsDir)) {
    const plugin = verticalManifest.plugins.get(id);
    if (!plugin) continue;
    for (const t of plugin.getTools()) {
      if (t && t.name) map[t.name] = id;
    }
  }
  return map;
})();

router.post('/vertical-tool', authenticateToken, express.json(), async (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store' });

  const { name, args } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'invalid_body', message: 'name (tool) is required' });
  }

  // Derive vertical from tool name — each tool belongs to exactly one vertical.
  // Fall back to global active_vertical only if the tool isn't in any manifest.
  const activeVertical = TOOL_VERTICAL_MAP[name] || configStore.getEffective('active_vertical') || 'banking';
  const userId = req.user && req.user.id;
  const isAdmin = req.user && req.user.role === 'admin';

  try {
    const out = await verticalDispatch.executeToolFor(
      activeVertical,
      name,
      args || {},
      { userId, userToken: null, req, tokenEvents: [], sessionId: req.session?.id || '', isAdmin },
      () => ({ result: { error: `no handler for ${name}` }, render: 'text' }),
    );
    // { result, render } — surface both so the caller can rebuild verticalResult.
    return res.json(scrubRawJwts({ ok: !out?.result?.error, ...out }));
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'vertical_tool_failed', message: err.message });
  }
});

module.exports = router;
