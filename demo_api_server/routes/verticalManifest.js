'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const { verticalManifest } = require('../services/verticalManifest');
const configStore = require('../services/configStore');

const router = express.Router();

const PROTECTED_IDS = new Set(['banking', 'admin-console']);
const ID_REGEX = /^[a-z][a-z0-9-]*$/;

function requireSession(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  next();
}

// Guard for parameterized :id routes — validates req.params.id against ID_REGEX
// before it reaches any path.join / fs call. Express decodes %2F to '/' inside
// req.params.id, so this is the path-traversal boundary, not just a 404 helper.
function requireValidId(req, res, next) {
  if (!ID_REGEX.test(req.params.id || '')) {
    return res.status(400).json({ error: 'invalid id format' });
  }
  next();
}

// ---- Read endpoints ----

router.get('/me', requireSession, (req, res) => {
  const scope = verticalManifest.scope.resolveForRequest(req);
  // Pin the vertical to THIS session on first hydration. Without a pin,
  // activeIdFor() falls back to the process-global forever, so any other
  // session switching verticals (setActive → global + SSE broadcast to every
  // client) yanked this screen to their vertical mid-demo. Pinning once makes
  // the global a first-load default instead of a live channel between sessions.
  // Fire-and-forget: a failed save just means we re-pin on the next /me.
  if (scope && scope.activeId && req.session && !req.session.active_vertical) {
    req.session.active_vertical = scope.activeId;
    if (typeof req.session.save === 'function') req.session.save(() => {});
  }
  // Overlay per-vertical theme-zone overrides (set via /api/admin/vertical-themes).
  // resolveForRequest returns a structuredClone, so mutating cssVars is safe.
  // Blind merge — zone semantics live in the frontend registry (themeZones.js).
  if (scope && scope.pageManifest && scope.activeId) {
    const raw = configStore.get(`vertical_theme_overrides_${scope.activeId}`);
    if (raw) {
      try {
        const overrides = JSON.parse(raw);
        const theme = scope.pageManifest.theme || {};
        scope.pageManifest.theme = {
          ...theme,
          cssVars: { ...(theme.cssVars || {}), ...overrides },
        };
      } catch { /* malformed blob — ignore, serve manifest defaults */ }
    }
  }
  res.json(scope);
});

router.get('/list', (_req, res) => {
  res.json(verticalManifest.list());
});

router.get('/stream', requireSession, (req, res) => {
  verticalManifest.events.onClient(req, res);
  // Don't end — the client keeps it open until they disconnect.
});

/**
 * GET /api/vertical/pipeline
 * Returns the full vertical → chips → tool → scopes mapping for the pipeline
 * visualization on the setup page. Each vertical entry includes:
 *   - id, displayName, theme
 *   - chips: heuristic actions (quick-action buttons the agent shows)
 *   - tools: MCP tool name, required scopes, read/write classification
 */
router.get('/pipeline', requireAdmin, (_req, res) => {
  const verticalsDir = path.join(__dirname, '../config/verticals');
  const fs = require('fs');
  const SKIP = new Set(['admin', 'admin-console', 'banking']);
  const result = [];

  let entries;
  try {
    entries = fs.readdirSync(verticalsDir)
      .filter(id => !SKIP.has(id) && fs.existsSync(path.join(verticalsDir, id, 'index.js')));
  } catch {
    entries = [];
  }

  for (const id of entries) {
    const plugin = verticalManifest.plugins.get(id);
    if (!plugin) continue;

    // Read manifest.json directly — source of displayName, theme, identity
    let manifest = {};
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(verticalsDir, id, 'manifest.json'), 'utf8'));
    } catch { /* no manifest.json */ }

    const toolDefs = plugin.getTools();
    const toolMap = Object.fromEntries(toolDefs.map(t => [t.name, t]));

    // Chips = heuristic actions the agent presents as quick-action buttons
    const heuristics = plugin.getHeuristics() || [];
    const chips = heuristics.map(h => {
      const toolDef = toolMap[h.action];
      return {
        label: h.label || h.action.replace(/_/g, ' '),
        action: h.action,
        scopes: toolDef?.scopes || toolDef?.requiredScopes || ['read'],
        isWrite: (toolDef?.scopes || toolDef?.requiredScopes || []).includes('write'),
        authz: toolDef?.authz || {},
      };
    });

    const tools = toolDefs.map(t => ({
      name: t.name,
      description: t.description || '',
      scopes: t.scopes || t.requiredScopes || [],
      isWrite: (t.scopes || t.requiredScopes || []).includes('write'),
      authz: t.authz || {},
    }));

    result.push({
      id,
      displayName: manifest?.identity?.displayName || id,
      tagline: manifest?.identity?.tagline || '',
      theme: manifest?.theme || {},
      chips,
      tools,
    });
  }

  res.json(result);
});

/**
 * POST /api/vertical/check-chip
 * Calls the Authorization Server with DecisionContext=ChipAuthorization to validate
 * whether the current user's token scopes allow using a specific chip/tool.
 * Used by the pipeline map on the setup page for live PERMIT/DENY badges.
 *
 * Body: { vertical: string, toolName: string }
 * Response: { decision: 'PERMIT'|'DENY', reason?: string }
 */
router.post('/check-chip', requireAdmin, express.json(), async (req, res) => {
  const { vertical, toolName } = req.body || {};
  if (!vertical || !toolName) {
    return res.status(400).json({ error: 'vertical and toolName required' });
  }

  const authzEndpoint = process.env.PINGAUTHORIZE_ENDPOINT;
  const workerId = process.env.PINGAUTHORIZE_WORKER_ID || 'mcp-gateway-policy';
  const p1azEnabled = process.env.MCP_GW_P1AZ_ENABLED === 'true';

  // Contract C4 — omission is not permission. This used to return a local
  // PERMIT, so an unconfigured authorization server rendered every chip as
  // policy-approved. INDETERMINATE says what is true: no decision was made.
  if (!authzEndpoint || !p1azEnabled) {
    return res.json({
      decision: 'INDETERMINATE',
      degraded: true,
      policy_source: 'unconfigured',
      reason: 'Authorization Server not configured (PINGAUTHORIZE_ENDPOINT / MCP_GW_P1AZ_ENABLED) — no decision was evaluated',
    });
  }

  // Extract scopes and the ACTUAL audience from the current user's session token.
  const userToken = req.session?.oauthTokens?.accessToken;
  let tokenScopes = '';
  let tokenAud = null;
  if (userToken) {
    try {
      const claims = JSON.parse(Buffer.from(userToken.split('.')[1], 'base64url').toString());
      tokenScopes = claims.scope || '';
      // C1: TokenAudience is the token's real `aud` (array ⇒ first entry).
      const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
      tokenAud = aud ? String(aud) : null;
    } catch { /* ignore */ }
  }

  // This call used to send NO audience at all, so mock Rule 0b DENYed
  // `invalid_aud` before ChipAuthorization could run. The first fix for that
  // set TokenAudience, TokenAudActual AND McpResourceUri to the expected URI —
  // which re-introduced the tautology contract C1 rule 1 forbids: Rule 0b then
  // passed on a fabricated value, Rule 0b-2 (D-05 anti-bypass) could never flag
  // because the "actual" aud was synthetic, and Rule 0c compared a value to
  // itself. The audience sent is now the one on the presented token.
  //
  // C1 preamble — absent values are omitted, never fabricated. With no readable
  // aud there is nothing honest to send: a DENY produced by the missing input
  // would be reported to the UI as a policy decision. C4 — say that no decision
  // was evaluated instead of manufacturing one.
  if (!tokenAud) {
    return res.json({
      decision: 'INDETERMINATE',
      degraded: true,
      policy_source: 'no-token-audience',
      reason: 'No access token audience on this session — chip authorization cannot be evaluated without the token actual aud',
    });
  }

  // The EXPECTED gateway resource URI (C1 defines McpResourceUri that way),
  // read from the same source the live MCP gate uses so the two cannot drift.
  // Returns '' when nothing is configured — it no longer invents a host
  // (REGRESSION_PLAN §3). With no expected resource there is nothing to compare
  // the token audience against, so no meaningful decision exists to render.
  const expectedResourceUri =
    require('../services/mcpToolAuthorizationService').resolveExpectedMcpResourceUri();
  if (!expectedResourceUri) {
    return res.json({
      decision: 'INDETERMINATE',
      degraded: true,
      policy_source: 'unconfigured',
      reason: 'No expected MCP resource URI configured — chip authorization cannot be evaluated',
    });
  }

  try {
    const axios = require('axios');
    const response = await axios.post(
      `${authzEndpoint}/governance/pap/alpha/policy/${workerId}/decision`,
      {
        parameters: {
          DecisionContext: 'ChipAuthorization',
          ToolName: toolName,
          Vertical: vertical,
          TokenScopes: tokenScopes,
          ClientId: req.user?.sub || '',
          // The token's REAL aud (C1 rule 1) — never the expected URI.
          TokenAudience: tokenAud,
          // C1: same value, retained for mock back-compat.
          TokenAudActual: tokenAud,
          // The EXPECTED resource, independent of the above, so mock Rule 0c is
          // a real comparison rather than a value against itself.
          McpResourceUri: expectedResourceUri,
        },
      },
      { timeout: 3000, headers: { 'Content-Type': 'application/json' } },
    );
    res.json({
      decision: response.data?.decision || 'DENY',
      reason: response.data?.reason,
      decision_id: response.data?.decision_id,
    });
  } catch (err) {
    res.json({ decision: 'DENY', reason: `Authorization Server unavailable: ${err.message}` });
  }
});

// ---- Write endpoints ----
// Specific paths first, parameterized paths last (express routes top-to-bottom).

// Switching the active vertical is open to any authenticated user (not admin-only).
// Session-scoped: the choice is ALWAYS stored on THIS session (req.session.active_vertical)
// so another session switching can't change it. The process-global + SSE broadcast
// (setActive) is admin-only (or body.global=true from an admin) — otherwise a
// CareConnect / retail e2e (or casual end-user switch) left healthcare as the
// first-load default for every new session and the room looked "stuck".
// The id is validated against the loaded set; hidden verticals cannot be activated.
router.post('/active', requireSession, (req, res) => {
  const { id, global: wantGlobal } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  // Shared with the demo-agent `vertical` param — see verticalManifest.activationRefusal.
  const refusal = verticalManifest.activationRefusal(id);
  if (refusal === 'hidden') return res.status(403).json({ error: 'cannot activate hidden vertical' });
  if (refusal === 'unknown') return res.status(404).json({ error: 'unknown id' });
  // Session preference (takes precedence in resolver.activeIdFor / scope / data seeding).
  req.session.active_vertical = id;
  const isAdmin = req.user && req.user.role === 'admin';
  // Only admins move the process-global default (and SSE-broadcast to everyone).
  if (isAdmin || wantGlobal === true) {
    if (wantGlobal === true && !isAdmin) {
      return res.status(403).json({ error: 'admin only for global vertical switch' });
    }
    verticalManifest.resolver.setActive(id);
  }
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'session_save_failed' });
    res.status(204).end();
  });
});

router.put('/:id/user-chips', requireSession, requireValidId, async (req, res) => {
  const { id } = req.params;
  if (!verticalManifest.loader.get(id)) return res.status(404).json({ error: 'unknown id' });
  const { chips } = req.body || {};
  if (!Array.isArray(chips)) return res.status(400).json({ error: 'chips array required' });
  try {
    verticalManifest.resolver.overlay.setField(id, 'dashboard.userChips', chips);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/reset-all', requireAdmin, (_req, res) => {
  for (const id of verticalManifest.store.listOverlayIds()) {
    verticalManifest.resolver.overlay.clearAll(id);
  }
  res.status(204).end();
});

router.post('/snapshot', requireAdmin, (req, res) => {
  const savedAt = verticalManifest.snapshot.save(req.user.id);
  res.json({ savedAt });
});

router.post('/snapshot/restore', requireAdmin, (req, res) => {
  verticalManifest.snapshot.restore(req.user.id);
  res.status(204).end();
});

router.delete('/snapshot', requireAdmin, (req, res) => {
  verticalManifest.snapshot.clear(req.user.id);
  res.status(204).end();
});

router.post('/:sourceId/clone', requireAdmin, (req, res) => {
  const { sourceId } = req.params;
  const { newId, displayName } = req.body || {};
  if (!ID_REGEX.test(sourceId)) return res.status(400).json({ error: 'invalid source id format' });
  if (!newId || !displayName) return res.status(400).json({ error: 'newId and displayName required' });
  if (!ID_REGEX.test(newId)) return res.status(400).json({ error: 'invalid id format' });
  if (verticalManifest.loader.get(newId)) return res.status(409).json({ error: 'id already exists' });
  const source = verticalManifest.loader.get(sourceId);
  if (!source) return res.status(404).json({ error: 'unknown source id' });

  const root = process.env.VERTICAL_SEED_ROOT
    || path.join(__dirname, '..', 'config', 'verticals');
  const newDir = path.join(root, newId);
  fs.mkdirSync(newDir, { recursive: true });

  const newManifest = JSON.parse(JSON.stringify(source.manifest));
  newManifest.id = newId;
  newManifest.identity.displayName = displayName;
  fs.writeFileSync(path.join(newDir, 'manifest.json'), JSON.stringify(newManifest, null, 2));
  fs.writeFileSync(path.join(newDir, 'mock-data.json'), JSON.stringify(source.mockData || {}, null, 2));

  verticalManifest.loader.reload(newId);
  verticalManifest.events.emit('vertical-list-changed', { ids: verticalManifest.list().map((v) => v.id) });
  res.status(201).json({ id: newId, displayName });
});

// Raw seed manifest + current overlay paths — powers the admin editor's
// seed-diffing (so editing a field back to seed clears the override) and the
// override panel. loader.get(id).manifest is the un-merged seed.
router.get('/:id/seed', requireAdmin, requireValidId, (req, res) => {
  const entry = verticalManifest.loader.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'unknown id' });
  res.json({
    seedManifest: entry.manifest,
    overlayPaths: verticalManifest.resolver.overlay.list(req.params.id),
  });
});

router.delete('/:id', requireAdmin, requireValidId, (req, res) => {
  const { id } = req.params;
  if (PROTECTED_IDS.has(id)) return res.status(403).json({ error: 'protected id' });
  if (verticalManifest.resolver.activeId() === id) return res.status(409).json({ error: 'cannot delete active vertical' });
  if (!verticalManifest.loader.get(id)) return res.status(404).json({ error: 'unknown id' });

  const root = process.env.VERTICAL_SEED_ROOT
    || path.join(__dirname, '..', 'config', 'verticals');
  fs.rmSync(path.join(root, id), { recursive: true, force: true });
  verticalManifest.resolver.overlay.clearAll(id);
  verticalManifest.resolver.removeFromCache(id);
  verticalManifest.loader.removeFromCache(id);
  verticalManifest.events.emit('vertical-list-changed', { ids: verticalManifest.list().map((v) => v.id) });
  res.status(204).end();
});

// The editor sends the FULL desired overlay (= diff(seed, edited)) here, so this
// uses replace semantics: the overlay becomes exactly `entries`, and any field
// no longer present is cleared. That's what makes "edit a field back to its seed
// value and Save" remove the override.
router.post('/:id/overlay/batch', requireAdmin, requireValidId, (req, res) => {
  const { id } = req.params;
  const { entries } = req.body || {};
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries array required' });
  if (!verticalManifest.loader.get(id)) return res.status(404).json({ error: 'unknown id' });
  try {
    verticalManifest.resolver.overlay.replaceBatch(id, entries);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/overlay', requireAdmin, requireValidId, (req, res) => {
  const { id } = req.params;
  const { path: fieldPath, value } = req.body || {};
  if (!fieldPath) return res.status(400).json({ error: 'path required' });
  if (!verticalManifest.loader.get(id)) return res.status(404).json({ error: 'unknown id' });
  try {
    verticalManifest.resolver.overlay.setField(id, fieldPath, value);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id/overlay', requireAdmin, requireValidId, (req, res) => {
  const { id } = req.params;
  const { path: fieldPath } = req.body || {};
  if (!verticalManifest.loader.get(id)) return res.status(404).json({ error: 'unknown id' });
  if (fieldPath) {
    verticalManifest.resolver.overlay.clearField(id, fieldPath);
  } else {
    verticalManifest.resolver.overlay.clearAll(id);
  }
  res.status(204).end();
});

// Export the auth middlewares so callers can reuse them without re-declaring.
router.requireSession = requireSession;
router.requireAdmin = requireAdmin;

module.exports = router;
