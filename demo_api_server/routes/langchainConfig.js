/**
 * LangChain configuration routes.
 *
 * Persists configuration to SQLite (configStore) so credentials survive server/browser restarts.
 * helix_api_key is encrypted at rest; other fields stored plaintext.
 *
 * Routes:
 *   GET  /api/langchain/config/status   — current provider, model, key_set flags
 *   POST /api/langchain/config          — save provider/model/key to session + SQLite
 *   DELETE /api/langchain/config/key/:keyType — clear a key from session + SQLite
 */
const express = require('express');
const configStore = require('../services/configStore');
const { resolveAgentMode, AGENT_MODES, DEFAULT_MODE } = require('../services/agentModeResolver');

const router = express.Router();

// Models available per provider
const PROVIDER_MODELS = {
  openai:              ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic:           ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-20241022'],
  // GroqCloud retires models without notice, and provider availability is gated
  // on GROQ_API_KEY alone (see key_set below) — so a decommissioned id here does
  // not show as "unconfigured", it passes the health check and 404s mid-request.
  // Verified against GET /openai/v1/models on 2026-08-26. qwen3.6-27b is live but
  // omitted: it emits <think> into content, which the SPA renders verbatim.
  groq:                ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'groq/compound-mini'],
  google:              ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  helix:               ['gpt-4o', 'gpt-4o-mini', 'gemini-1.5-pro', 'claude-3-5-sonnet'],
  // LM Studio — Anthropic-compatible endpoint at /v1/messages.
  // Model IDs must match what is loaded in LM Studio (publisher/model-name format).
  'anthropic-lmstudio': ['google/gemma-4-e2b', 'google/gemma-4-e4b', 'google/gemma-3-12b-it'],
  // llama.cpp — local small LLM with native tool-calling, served by llama-server.
  // Model IDs are whatever llama-server reports via /v1/models (the model it was
  // launched with via `-m`/`-hf`). Prefer a small NON-reasoning model: NL intent +
  // short teaching answers must return under the SPA fetch timeout, which reasoning
  // models routinely blow.
  llamacpp:            ['phi-4-mini-instruct', 'gpt-oss-20b'],
  mlx:                 ['mlx-community/Phi-4-mini-instruct-4bit'],
};

const DEFAULT_MODELS = {
  openai:              'gpt-4o-mini',
  anthropic:           'claude-3-5-haiku-20241022',
  groq:                'openai/gpt-oss-20b',
  google:              'gemini-2.0-flash',
  helix:               'gpt-4o-mini',
  'anthropic-lmstudio': 'google/gemma-4-e2b',
  llamacpp:            'phi-4-mini-instruct',
  mlx:                 'mlx-community/Phi-4-mini-instruct-4bit',
};

// Default provider fallback order surfaced by the LLM Config UI when the
// session has no saved order yet. Kept in sync with LlmConfigPanel's default.
const DEFAULT_FALLBACK_ORDER = ['groq', 'anthropic', 'openai', 'google'];

const KEY_SESSION_FIELDS = {};

function getLangchainConfig(req) {
  return req.session.langchain_config || {};
}

function setLangchainConfig(req, updates) {
  req.session.langchain_config = Object.assign(getLangchainConfig(req), updates);
}

// GET /api/langchain/config/status
router.get('/config/status', (req, res) => {
  try {
    const cfg = getLangchainConfig(req);
    const { resolveLlmProvider } = require('../services/llmProviderResolver');
    const provider = resolveLlmProvider(cfg).provider;
    const model = cfg.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.helix;

    // Load Helix credentials from SQLite if not in session (e.g., after tab switch)
    let helix_base_url = cfg.helix_base_url || '';
    let helix_api_key = cfg.helix_api_key || '';
    let helix_environment_id = cfg.helix_environment_id || '';
    let helix_agent_id = cfg.helix_agent_id || '';
    let helix_prompt_field_id = cfg.helix_prompt_field_id || '';

    // Try to load from configStore but don't let it crash the response.
    // Use getEffective so FIELD_DEFS defaults (committed in configStore.js for
    // helix_base_url, helix_environment_id, helix_agent_id, helix_prompt_field_id)
    // reach fresh clones whose SQLite has not yet been populated.
    try {
      helix_base_url = helix_base_url || configStore.getEffective('helix_base_url') || '';
      helix_api_key = helix_api_key || configStore.getEffective('helix_api_key') || '';
      helix_environment_id = helix_environment_id || configStore.getEffective('helix_environment_id') || '';
      helix_agent_id = helix_agent_id || configStore.getEffective('helix_agent_id') || '';
      helix_prompt_field_id = helix_prompt_field_id || configStore.getEffective('helix_prompt_field_id') || '';
    } catch (dbErr) {
      console.warn('[langchainConfig GET] configStore error:', dbErr.message);
    }

    // If we loaded from SQLite, update the session so it's available for this session
    if ((helix_base_url || helix_api_key || helix_environment_id || helix_agent_id || helix_prompt_field_id) &&
        (!cfg.helix_base_url && !cfg.helix_api_key && !cfg.helix_environment_id && !cfg.helix_agent_id && !cfg.helix_prompt_field_id)) {
      setLangchainConfig(req, {
        helix_base_url,
        helix_api_key,
        helix_environment_id,
        helix_agent_id,
        helix_prompt_field_id,
      });
    }

    res.json({
      provider,
      model,
      helix_base_url,
      helix_api_key: helix_api_key ? '••••••••' : '',
      helix_environment_id,
      helix_agent_id,
      helix_prompt_field_id,
      // Honest credential presence so UIs can disable unconfigured
      // providers (teaching spec 2026-05-18-chatgpt-claude-as-agent,
      // "disable unconfigured" UX). openai/anthropic are enforced for real
      // at banking_agent_service (:3006), which reads OPENAI_API_KEY /
      // ANTHROPIC_API_KEY — mirror that source here (session key OR
      // configStore OR that env var).
      key_set: {
        helix: !!(helix_api_key && helix_base_url),
        openai: !!(cfg.openai_api_key ||
          configStore.getEffective('openai_api_key') ||
          process.env.OPENAI_API_KEY),
        anthropic: !!(cfg.anthropic_api_key ||
          configStore.getEffective('anthropic_api_key') ||
          process.env.ANTHROPIC_API_KEY),
        groq: !!(cfg.groq_api_key || process.env.GROQ_API_KEY),
        google: !!(cfg.google_api_key ||
          configStore.getEffective('google_api_key') ||
          process.env.GOOGLE_API_KEY ||
          process.env.GEMINI_API_KEY),
        // LM Studio — no API key needed; always "configured" (local server, no auth)
        'anthropic-lmstudio': true,
      },
      provider_models: PROVIDER_MODELS,
      default_models: DEFAULT_MODELS,
      fallback_order: Array.isArray(cfg.fallback_order) && cfg.fallback_order.length
        ? cfg.fallback_order
        : DEFAULT_FALLBACK_ORDER,
      agent_mode: configStore.getEffective('agent_mode') || DEFAULT_MODE,
      external_wiring: configStore.getEffective('agent_external_wiring') || 'bff',
      agent_modes: AGENT_MODES.map((m) => ({ id: m.id, label: m.label, external: m.external })),
    });
  } catch (err) {
    console.error('[langchainConfig GET] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/langchain/config
// Body: { provider, model, key_type, key, helix_api_key, helix_base_url, helix_environment_id, helix_agent_id, helix_prompt_field_id }
router.post('/config', async (req, res) => {
  const { provider, model, key_type, key, helix_api_key, helix_base_url, helix_environment_id, helix_agent_id, helix_prompt_field_id } = req.body || {};
  const { agent_mode, external_wiring } = req.body || {};

  const updates = {};
  const dbUpdates = {}; // updates for SQLite persistence

  if (provider) updates.provider = provider;
  if (model) updates.model = model;
  // Persist the provider fallback order (LLM Config drag-to-reorder UI).
  if (Array.isArray(req.body?.fallback_order)) {
    updates.fallback_order = req.body.fallback_order;
  }

  // Handle Helix credentials (4-field configuration)
  if (key_type === 'helix' || provider === 'helix') {
    if (helix_base_url) {
      updates.helix_base_url = helix_base_url;
      dbUpdates.helix_base_url = helix_base_url;
    }
    if (helix_environment_id) {
      updates.helix_environment_id = helix_environment_id;
      dbUpdates.helix_environment_id = helix_environment_id;
    }
    if (helix_agent_id) {
      updates.helix_agent_id = helix_agent_id;
      dbUpdates.helix_agent_id = helix_agent_id;
    }
    if (helix_prompt_field_id) {
      updates.helix_prompt_field_id = helix_prompt_field_id;
      dbUpdates.helix_prompt_field_id = helix_prompt_field_id;
    }
    if (helix_api_key) {
      updates.helix_api_key = helix_api_key;
      dbUpdates.helix_api_key = helix_api_key;
    }
    if (key) {
      updates.helix_api_key = key;
      dbUpdates.helix_api_key = key;
    }
    if (provider) updates.provider = provider;
  }

  // Handle cloud provider API keys (single-field configuration)
  if (key_type && ['openai', 'anthropic', 'google', 'groq'].includes(key_type)) {
    updates[key_type + '_api_key'] = key;
    dbUpdates[key_type + '_api_key'] = key;
    updates.provider = key_type;
  }

  // Anthropic base URL override (for LM Studio proxy or custom endpoint)
  if (req.body?.anthropic_base_url !== undefined) {
    updates.anthropic_base_url = req.body.anthropic_base_url || '';
  }

  setLangchainConfig(req, updates);

  let am = null;
  if (agent_mode !== undefined) {
    am = resolveAgentMode(agent_mode, external_wiring);
    try {
      await configStore.setConfig({
        agent_mode: am.mode,
        agent_external_wiring: am.externalWiring || '',
      });
    } catch (err) {
      console.error('[langchainConfig POST] agent_mode persist failed:', err.message);
    }
    // Write the provider on EVERY mode change, including null for heuristics.
    // Guarding on `am.provider` meant switching TO heuristics left the previous
    // LLM provider (e.g. anthropic) sitting in the session, which agentRun then
    // picked up — heuristics quietly calling a frontier API.
    setLangchainConfig(req, { provider: am.provider || null });
  }

  // Persist Helix credentials to SQLite
  if (Object.keys(dbUpdates).length > 0) {
    try {
      await configStore.setConfig(dbUpdates);
    } catch (err) {
      console.error('[langchainConfig POST] SQLite persist failed:', err.message);
      // Continue despite DB error — session is still valid
    }
  }

  const cfg = getLangchainConfig(req);
  const { resolveLlmProvider } = require('../services/llmProviderResolver');
  const activeProvider = resolveLlmProvider(cfg).provider;

  // Log Helix config for debugging
  if (key_type === 'helix' || provider === 'helix') {
    console.log('[langchainConfig POST] Helix saved:', {
      helix_base_url: !!cfg.helix_base_url,
      helix_api_key: !!cfg.helix_api_key,
      helix_environment_id: !!cfg.helix_environment_id,
      helix_agent_id: !!cfg.helix_agent_id,
      provider: cfg.provider,
      db: Object.keys(dbUpdates).length > 0 ? 'persisted' : 'session_only'
    });
  }

  res.json({
    ok: true,
    provider: activeProvider,
    model: cfg.model || DEFAULT_MODELS[activeProvider],
    key_set: { [activeProvider]: true },
    agent_mode: am ? am.mode : (configStore.getEffective('agent_mode') || null),
    external_wiring: am ? am.externalWiring : (configStore.getEffective('agent_external_wiring') || null),
  });
});

// DELETE /api/langchain/config/key/:keyType — clear Helix config from session + SQLite
router.delete('/config/key/:keyType', async (req, res) => {
  const keyType = req.params.keyType;

  // Clear Helix config from session
  if (keyType === 'helix') {
    const cfg = getLangchainConfig(req);
    delete cfg.helix_base_url;
    delete cfg.helix_api_key;
    delete cfg.helix_environment_id;
    delete cfg.helix_agent_id;
    req.session.langchain_config = cfg;

    // Clear from the persistent config store (LMDB-backed configStore — NO SQLITE).
    // setConfig writes empty strings so getEffective falls back to FIELD_DEFS
    // defaults / env, matching the prior "DELETE FROM config" semantics.
    try {
      await configStore.setConfig({
        helix_base_url: '',
        helix_api_key: '',
        helix_environment_id: '',
        helix_agent_id: '',
      });
      console.log('[langchainConfig DELETE] Helix config cleared from configStore (LMDB)');
    } catch (err) {
      console.error('[langchainConfig DELETE] configStore cleanup failed:', err.message);
      // Continue despite error — session is still cleared
    }
  }

  if (['google', 'anthropic', 'openai', 'groq'].includes(keyType)) {
    const cfg = getLangchainConfig(req);
    delete cfg[`${keyType}_api_key`];
    req.session.langchain_config = cfg;
    try {
      await configStore.setConfig({ [`${keyType}_api_key`]: '' });
    } catch (err) {
      console.error(`[langchainConfig DELETE] ${keyType} configStore cleanup failed:`, err.message);
    }
  }

  res.json({ ok: true, key_type: keyType, cleared: true });
});


// POST /api/langchain/helix/verify
// Body: { helix_base_url, helix_api_key, helix_environment_id, helix_agent_id, helix_prompt_field_id }
// Runs a live Helix conversation test. No session required — called during setup before login.
router.post('/helix/verify', async (req, res) => {
  const { helix_base_url, helix_api_key, helix_environment_id, helix_agent_id, helix_prompt_field_id } = req.body || {};
  const missing = ['helix_base_url','helix_api_key','helix_environment_id','helix_agent_id','helix_prompt_field_id']
    .filter(k => !req.body?.[k]);
  if (missing.length) {
    return res.json({ ok: false, error: `Missing required fields: ${missing.join(', ')}` });
  }
  try {
    const { callHelixAgent } = require('../services/helixLlmService');
    await callHelixAgent(
      { helix_base_url, helix_api_key, helix_environment_id, helix_agent_id, helix_prompt_field_id },
      [{ role: 'user', content: 'ping' }]
    );
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;

// GET /api/langchain/provider/:providerName/status
// Returns: { provider, status, reason, configured: boolean }
// Status: 'available' | 'unconfigured' | 'unreachable'
// NOTE: Async health check runs server-side; client sees result synchronously
router.get('/provider/:providerName/status', async (req, res) => {
  const { providerName } = req.params;

  // Validate provider
  if (!PROVIDER_MODELS[providerName]) {
    return res.status(400).json({ error: `Unknown provider: ${providerName}` });
  }

  try {
    const { getProviderStatus } = require('../services/llmProviderStatus');
    const cfg = getLangchainConfig(req);

    // For Helix, try to load from SQLite if not in session.
    // Use getEffective so FIELD_DEFS defaults reach fresh clones.
    if (providerName === 'helix') {
      try {
        cfg.helix_base_url = cfg.helix_base_url || configStore.getEffective('helix_base_url') || '';
        cfg.helix_api_key = cfg.helix_api_key || configStore.getEffective('helix_api_key') || '';
        cfg.helix_environment_id = cfg.helix_environment_id || configStore.getEffective('helix_environment_id') || '';
        cfg.helix_agent_id = cfg.helix_agent_id || configStore.getEffective('helix_agent_id') || '';
      } catch (dbErr) {
        console.warn('[langchainConfig provider status] configStore error:', dbErr.message);
      }
    }

    if (providerName === 'google') {
      try {
        cfg.google_api_key = cfg.google_api_key || configStore.getEffective('google_api_key') || '';
      } catch (dbErr) {
        console.warn('[langchainConfig provider status] configStore error:', dbErr.message);
      }
      if (!cfg.google_api_key) {
        cfg.google_api_key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
      }
    }

    const statusData = await getProviderStatus(providerName, cfg);
    
    res.json({
      provider: providerName,
      status: statusData.status,
      reason: statusData.reason,
      configured: statusData.hasKey,
    });
  } catch (error) {
    console.error(`[langchainConfig] Provider status check failed for ${providerName}:`, error.message);
    res.status(500).json({
      provider: providerName,
      status: 'unreachable',
      reason: `Status check error: ${error.message}`,
      configured: false,
    });
  }
});

// ── llama.cpp swap-mode tier control ────────────────────────────────────────
// The multi-model proxy loads ONE tier at a time (swap mode). These routes let
// the UI see which tier is loaded and pre-warm a bigger one before a demo, so
// the first real request doesn't pay the model-load pause. The actual swap is
// done by the host tier-manager daemon (:8097) — same one the router uses.
const LLAMACPP_TIER_PORTS = {
  'phi-4-mini-instruct': 8091,
  'gpt-oss-20b': 8096,
};

function llamacppOrigin() {
  return (process.env.LLAMACPP_BASE_URL || 'http://host.docker.internal:8090').replace(/\/+$/, '');
}

function tierManagerOrigin() {
  if (process.env.TIER_MANAGER_URL) return process.env.TIER_MANAGER_URL.replace(/\/+$/, '');
  return `http://${new URL(llamacppOrigin()).hostname}:8097`;
}

/** Read proxy pin (LLM_PROXY_PIN_TIER). Returns null when unset/unreachable. */
async function fetchProxyPin() {
  try {
    const r = await fetch(`${llamacppOrigin()}/status`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const data = await r.json();
    return data.pin && data.pin.port ? data.pin : null;
  } catch {
    return null;
  }
}

// GET /api/langchain/llamacpp/tiers — which tier is loaded / swapping
router.get('/llamacpp/tiers', async (req, res) => {
  try {
    const r = await fetch(`${llamacppOrigin()}/status`, { signal: AbortSignal.timeout(5000) });
    const data = await r.json();
    res.json({ ...data, prewarmable: Object.keys(LLAMACPP_TIER_PORTS) });
  } catch (error) {
    res.status(502).json({ error: 'llm-proxy unreachable', message: error.message });
  }
});

// POST /api/langchain/llamacpp/prewarm { model } — swap the requested tier in
// now. With keep-warm defaults (LLM_PROXY_IDLE_DECAY_MS=0) the tier stays
// loaded; classic 5-min decay is opt-in via LLM_PROXY_IDLE_DECAY_MS=300000.
// When the proxy is hard-pinned to another tier (and residency is not keeping
// both), skip — otherwise we unload the pin, load the request, then thrash back.
router.post('/llamacpp/prewarm', async (req, res) => {
  const model = (req.body && req.body.model) || '';
  const port = LLAMACPP_TIER_PORTS[model];
  if (!port) {
    return res.status(400).json({ error: `Unknown tier model: ${model}`, allowed: Object.keys(LLAMACPP_TIER_PORTS) });
  }
  try {
    const pin = await fetchProxyPin();
    if (pin && Number(pin.port) !== Number(port)) {
      console.log(`[langchainConfig] prewarm skipped — pinned to ${pin.name} (:${pin.port}), requested ${model} (:${port})`);
      return res.json({ ok: true, skipped: true, reason: 'pinned', model, port, pinned: pin });
    }
    const r = await fetch(`${tierManagerOrigin()}/ensure?port=${port}`, { signal: AbortSignal.timeout(180000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: 'tier-manager swap failed', detail: data });
    if (data.skipped) {
      console.log(`[langchainConfig] prewarm skipped by tier-manager — ${data.reason || 'pinned'} (requested ${model})`);
      return res.json({ ok: true, skipped: true, reason: data.reason || 'pinned', model, port, pinned: data.pin ? { port: data.pin } : undefined });
    }
    // The swap happened behind the router's back — poke it to re-probe tier
    // health immediately, otherwise its cache routes to the unloaded tier for
    // up to 30s.
    await fetch(`${llamacppOrigin()}/refresh`, { method: 'POST', signal: AbortSignal.timeout(15000) }).catch(() => {});
    console.log(`[langchainConfig] pre-warmed llamacpp tier ${model} (:${port})`);
    res.json({ ok: true, model, port });
  } catch (error) {
    // The tier-manager is K8-only: docker-compose.yml gates `tier-manager-k8`
    // behind the `k8-build` profile and it never starts in compose, so on every
    // local stack this fetch fails and the dashboard logged a hard 502 on every
    // single page load. Prewarm is a latency optimization — the model still
    // loads on first use — so a missing swap manager is "nothing to do", not an
    // error, and it now reports the same benign shape as the pinned case above.
    // A 502 here trained everyone to ignore console errors on the dashboard,
    // which is exactly how a real failure gets missed.
    const unreachable = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|abort/i.test(error.message || '');
    if (unreachable) {
      console.log(`[langchainConfig] prewarm skipped — tier-manager not deployed (${model}); the tier loads on first use`);
      return res.json({
        ok: true, skipped: true, reason: 'tier-manager-unavailable', model, port,
      });
    }
    // A tier-manager that IS deployed but failing is a genuine error — keep it loud.
    res.status(502).json({ error: 'tier-manager unreachable', message: error.message });
  }
});
