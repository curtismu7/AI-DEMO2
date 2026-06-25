/**
 * LM Studio management routes.
 *
 * Wraps LM Studio's v1 REST API for model discovery, download, and loading.
 * All calls go to the LM Studio local server (default: http://localhost:1234).
 *
 * Routes:
 *   GET  /api/langchain/lmstudio/status          — server reachable + loaded models
 *   POST /api/langchain/lmstudio/download        — start downloading a model
 *   GET  /api/langchain/lmstudio/download/status — poll download job progress
 *   POST /api/langchain/lmstudio/load            — load a downloaded model
 *   POST /api/langchain/lmstudio/unload          — unload a model from memory
 *
 * LM Studio API reference: https://lmstudio.ai/docs/developer/rest/endpoints
 * Anthropic-compat endpoint: POST /v1/messages (same origin, no /api/v1 prefix)
 */
const express = require('express');
const { getLmStudioBase } = require('../services/lmstudioService');

const router = express.Router();

const DEFAULT_MODEL = 'google/gemma-4-e2b';

async function lmsRequest(path, options = {}) {
  const base = getLmStudioBase();
  const url = `${base}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 10_000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

router.get('/status', async (req, res) => {
  try {
    const base = getLmStudioBase();
    const response = await lmsRequest('/api/v1/models', { timeout: 5_000 });
    if (!response.ok) {
      return res.json({ server_running: false, reason: `LM Studio returned ${response.status}`, models: [] });
    }
    const data = await response.json();
    const models = (data.models || []).map(m => ({
      key: m.key,
      display_name: m.display_name,
      loaded: (m.loaded_instances || []).length > 0,
      loaded_instances: m.loaded_instances || [],
      size_bytes: m.size_bytes,
      capabilities: m.capabilities,
    }));
    res.json({
      server_running: true,
      base_url: base,
      anthropic_endpoint: `${base}/v1/messages`,
      models,
      default_model: DEFAULT_MODEL,
    });
  } catch (err) {
    res.json({ server_running: false, reason: err.message, models: [] });
  }
});

router.post('/download', async (req, res) => {
  const model = req.body?.model || DEFAULT_MODEL;
  try {
    const response = await lmsRequest('/api/v1/models/download', {
      method: 'POST',
      body: JSON.stringify({ model }),
      timeout: 15_000,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return res.status(response.status).json({ ok: false, error: data?.error || 'Download request failed', model });
    }
    const data = await response.json();
    res.json({ ok: true, model, ...data });
  } catch (err) {
    res.status(503).json({ ok: false, error: `LM Studio unreachable: ${err.message}`, model });
  }
});

router.get('/download/status', async (req, res) => {
  const { job_id } = req.query;
  if (!job_id) {
    return res.status(400).json({ ok: false, error: 'job_id query parameter required' });
  }
  try {
    const response = await lmsRequest(`/api/v1/models/download/status/${encodeURIComponent(job_id)}`, { timeout: 5_000 });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return res.status(response.status).json({ ok: false, error: data?.error || 'Status check failed' });
    }
    const data = await response.json();
    const pct = (data.total_size_bytes && data.downloaded_bytes != null)
      ? Math.round((data.downloaded_bytes / data.total_size_bytes) * 100)
      : null;
    res.json({ ok: true, ...data, progress_pct: pct });
  } catch (err) {
    res.status(503).json({ ok: false, error: `LM Studio unreachable: ${err.message}` });
  }
});

router.post('/load', async (req, res) => {
  const model = req.body?.model || DEFAULT_MODEL;
  const body = { model };
  if (req.body?.context_length) body.context_length = req.body.context_length;
  try {
    const response = await lmsRequest('/api/v1/models/load', {
      method: 'POST',
      body: JSON.stringify(body),
      timeout: 60_000,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return res.status(response.status).json({ ok: false, error: data?.error || 'Load failed', model });
    }
    const data = await response.json();
    res.json({ ok: true, model, ...data });
  } catch (err) {
    res.status(503).json({ ok: false, error: `LM Studio unreachable: ${err.message}`, model });
  }
});

router.post('/unload', async (req, res) => {
  const model = req.body?.model;
  if (!model) return res.status(400).json({ ok: false, error: 'model required' });
  try {
    const response = await lmsRequest('/api/v1/models/unload', {
      method: 'POST',
      body: JSON.stringify({ model }),
      timeout: 15_000,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return res.status(response.status).json({ ok: false, error: data?.error || 'Unload failed', model });
    }
    const data = await response.json();
    res.json({ ok: true, model, ...data });
  } catch (err) {
    res.status(503).json({ ok: false, error: `LM Studio unreachable: ${err.message}`, model });
  }
});

module.exports = router;
