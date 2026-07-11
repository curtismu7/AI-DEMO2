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

// Build tool→verticals map using verticalManifest.plugins — the SoT for all vertical tools.
// plugins.get(id) lazy-loads each vertical's index.js from disk (no pre-init needed).
// Most tool names belong to exactly one vertical, but some are SHARED across several
// (e.g. deposit/withdraw across banking+investment; view_billing across healthcare+
// university; api_key_demo/dual_token_demo across all). Keep EVERY owner so a shared
// name can be disambiguated by the caller's active vertical at call time — a plain
// name→id map let an arbitrary readdir winner run (e.g. a healthcare view_billing
// executing university's implementation and returning tuition data).
const TOOL_VERTICALS_MAP = (() => {
  const map = {};
  const verticalsDir = require('path').join(__dirname, '../config/verticals');
  for (const id of require('fs').readdirSync(verticalsDir)) {
    const plugin = verticalManifest.plugins.get(id);
    if (!plugin) continue;
    for (const t of plugin.getTools()) {
      if (t && t.name) (map[t.name] = map[t.name] || []).push(id);
    }
  }
  return map;
})();

/**
 * Resolve which vertical's implementation runs for a tool call.
 *  - unique name  → its owning vertical (independent of active_vertical)
 *  - shared name  → the caller's active vertical (falls back to the first owner)
 *  - body.vertical hint wins when it legitimately owns the tool (forward-compat:
 *    the MCP relay may pass the gateway's AllowedVertical here)
 *  - unknown name → active vertical, else banking
 */
function resolveVertical(name, req) {
  const owners = TOOL_VERTICALS_MAP[name] || [];
  const active = configStore.getEffective('active_vertical');
  const hint = typeof req.body?.vertical === 'string' ? req.body.vertical : null;
  if (hint && owners.includes(hint)) return hint;
  if (owners.length === 1) return owners[0];
  if (owners.length > 1) return (active && owners.includes(active)) ? active : owners[0];
  return active || 'banking';
}

router.post('/vertical-tool', authenticateToken, express.json(), async (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store' });

  const { name, args } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'invalid_body', message: 'name (tool) is required' });
  }

  // Derive the vertical from the tool name, disambiguating shared names by the
  // caller's active vertical (see resolveVertical).
  const activeVertical = resolveVertical(name, req);
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
