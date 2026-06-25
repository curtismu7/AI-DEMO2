// banking_api_server/routes/bankingAgentNl.js
/**
 * POST /api/demo-agent/nl — natural language → education or banking intent.
 * Authenticated users get role context. Anonymous calls are allowed (marketing agent UX):
 * the SPA routes education + NL hints without PingOne; banking execution still requires sign-in client-side.
 * LLM: heuristic first, then Helix or LM Studio for unrecognized input.
 */
'use strict';

const crypto = require('crypto');
const express = require('express');
const { parseNaturalLanguage } = require('../services/geminiNlIntent');
const { guardPromptInput } = require('../services/promptGuard');
const { parseVerticalParam } = require('../services/nlIntentParser');
const reportStore = require('../services/lmdb/reportStore.lmdb');
const { verticalManifest } = require('../services/verticalManifest');

const router = express.Router();

// The PingOne sub from the session's access token — the SAME identity
// /agent/invoke records under (via authenticateToken → decoded.sub). Using it
// keeps a single turn's /nl and /agent/invoke records under one userId so the
// store can de-dupe them. session.user can be a minimal restored object without
// oauthId/sub, so the token is the reliable source.
function subFromSessionToken(req) {
  try {
    const at = req.session?.oauthTokens?.accessToken;
    if (!at || at === '_cookie_session') return null;
    const parts = at.split('.');
    if (parts.length !== 3) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims.sub || null;
  } catch (_e) {
    return null;
  }
}

// Record a past-report entry for an executed agent action. /nl is the one entry
// point every vertical's chat turn passes through, so recording here (gated to
// results that carry an action — not education/none turns) captures runs
// uniformly across ALL verticals. The store de-dupes turns that also reach
// /agent/invoke, so this never double-counts.
function recordRunFromNl(req, message, result, vertical) {
  try {
    const action =
      result?.kind === 'banking' ? result?.banking?.action :
      result?.kind === 'vertical' ? result?.action :
      null;
    if (!action) return;
    // Identity: a restored / silent-SSO session can carry a minimal session.user
    // without oauthId/sub, so fall back to the cached token sub (subjectSub) —
    // the same PingOne sub /agent/invoke records under, keeping a turn's records
    // collapsible. Skip only when no identity is resolvable (anonymous).
    const su = req.session?.user || {};
    const userId =
      subFromSessionToken(req) ||
      su.oauthId || su.sub ||
      req.session?.oauthTokens?.subjectSub ||
      su.id || null;
    if (!userId) return;
    let activeVertical = null;
    try { activeVertical = verticalManifest?.resolver?.activeIdFor?.(req) || null; } catch (_e) { /* noop */ }
    const reportVertical = result.vertical || vertical || activeVertical || 'banking';
    const nowIso = new Date().toISOString();
    reportStore.saveRun({
      runId: crypto.randomUUID(),
      userId,
      vertical: reportVertical,
      prompt: message,
      startedAt: nowIso,
      completedAt: nowIso,
      toolsCalled: [action],
      tokenEvents: [],
      tokenCount: 0,
      agentPath: 'nl',
      intent: action,
      success: true,
      files: [],
    });
    console.log('[bankingAgentNl] recorded report', { vertical: reportVertical, action, uid: String(userId).slice(0, 8) });
  } catch (saveErr) {
    console.warn('[bankingAgentNl] reportStore.saveRun failed:', saveErr.message);
  }
}

router.post('/nl', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  const provider = typeof req.body?.provider === 'string' ? req.body.provider : 'auto';
  const verticalRaw = req.body?.vertical;

  if (!message.trim()) {
    return res.status(400).json({ error: 'invalid_body', message: 'message is required' });
  }

  if (verticalRaw !== undefined && verticalRaw !== null && parseVerticalParam(verticalRaw) === null) {
    return res.status(400).json({ error: 'invalid_vertical', message: 'vertical must match [a-z][a-z0-9-]*' });
  }
  const vertical = parseVerticalParam(verticalRaw);

  const promptBlock = guardPromptInput(message.trim());
  if (promptBlock) {
    return res.status(promptBlock.status).json(promptBlock.body);
  }

  try {
    const u = req.session?.user;
    const context = u
      ? { role: u.role, firstName: u.firstName, vertical }
      : { anonymous: true, vertical };

    // Pass langchain_config so NL routing can respect configured LLM provider (Helix, etc.)
    const langchainConfig = req.session?.langchain_config || {};

    const { source, result, llm_attempted, llm_not_configured } = await parseNaturalLanguage(message.trim(), context, provider, langchainConfig);
    recordRunFromNl(req, message.trim(), result, vertical);
    return res.json({ source, result, llm_attempted, llm_not_configured });
  } catch (e) {
    console.error('[bankingAgentNl]', e);
    return res.status(500).json({ error: 'nl_parse_failed', message: e.message || 'Failed to parse message' });
  }
});

/** GET /api/demo-agent/nl/status — which LLM backends are configured. */
router.get('/nl/status', (req, res) => {
  const configStore = require('../services/configStore');
  // Read via configStore so setup-page overrides take effect at runtime.
  // configStore.getEffective() resolves: runtime KV → env var → default.

  // Resolve which LLM provider is actually configured.
  const helixApiKey = configStore.getEffective('helix_api_key') || '';
  const helixBaseUrl = configStore.getEffective('helix_base_url') || '';
  const helixConfigured = !!(helixApiKey && helixBaseUrl);

  // Determine the active LLM provider from the SELECTED agent mode — not just
  // Helix. The SPA sends this value as the `provider` field on every /nl call;
  // when it was null, the SPA sent provider:"heuristic" and parseNaturalLanguage
  // short-circuited to heuristic-only, so LM Studio / Claude modes never reached
  // their LLM (the user saw "Heuristics-only mode" despite picking LM Studio).
  // agent_mode is the SSOT (set via the mode picker); a fresh install has '' and
  // falls back to the session langchain_config provider (set by the LM Studio /
  // Claude config panels). resolveLlmProvider's catch-all is 'helix', so the
  // default path preserves the prior helixConfigured behavior exactly.
  const { resolveAgentMode } = require('../services/agentModeResolver');
  const { resolveLlmProvider } = require('../services/llmProviderResolver');
  const rawMode = configStore.getEffective('agent_mode');
  const modeProvider = rawMode
    ? resolveAgentMode(rawMode, configStore.getEffective('agent_external_wiring')).provider
    : resolveLlmProvider(req.session?.langchain_config || {}).provider;

  // Helix is only "active" when its credentials are present (otherwise the agent
  // falls back to the heuristic catalog — T-3b). Other providers need no
  // BFF-side key (LM Studio is local; openai/anthropic are enforced at :3006).
  // modeProvider === null means the mode is heuristics-only.
  let activeLlmProvider;
  if (modeProvider === 'helix') activeLlmProvider = helixConfigured ? 'helix' : null;
  else activeLlmProvider = modeProvider || null;

  const base = {
    activeLlmProvider,
    helixConfigured,
    heuristicAlwaysAvailable: true,
  };

  if (!req.session?.user) return res.json(base);

  return res.json({
    ...base,
    helixAgentId: configStore.getEffective('helix_agent_id') || '',
  });
});

/** GET /api/demo-agent/search?q=... — BFF-side web search via Brave Search API.
 * The BRAVE_SEARCH_API_KEY never leaves the server. */
router.get('/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) {
    return res.status(400).json({ ok: false, error: 'query_required', message: 'q parameter is required' });
  }
  const braveSearchService = require('../services/braveSearchService');
  try {
    const result = await braveSearchService.search(query);
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err.code === 'BRAVE_NOT_CONFIGURED') {
      return res.status(503).json({ ok: false, error: err.code, message: err.message });
    }
    console.error('[bankingAgentNl] search error:', err);
    return res.status(500).json({ ok: false, error: 'search_failed', message: 'Search request failed' });
  }
});


module.exports = router;
