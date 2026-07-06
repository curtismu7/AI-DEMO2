// demo_api_server/routes/llamacppModels.js — BFF routes for local GGUF tier inventory and downloads.
/**
 * Routes:
 *   GET  /api/langchain/llamacpp/models                 — tier inventory + disk usage
 *   POST /api/langchain/llamacpp/models/download        — start hf download for a tier
 *   GET  /api/langchain/llamacpp/models/download/status — poll download job
 *   POST /api/langchain/llamacpp/models/dedupe          — symlink dupes + clear HF cache
 */
const express = require('express');
const {
  getInventory,
  startDownload,
  getDownloadStatus,
  dedupeModels,
} = require('../services/llamacppModelsService');

const router = express.Router();

router.get('/models', (req, res) => {
  try {
    res.json({ ok: true, ...getInventory() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/models/download', (req, res) => {
  const tier = req.body?.tier;
  if (tier == null) {
    return res.status(400).json({ ok: false, error: 'tier required' });
  }
  try {
    const result = startDownload(tier);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.code === 'UNKNOWN_TIER' ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.get('/models/download/status', (req, res) => {
  const { job_id: jobId } = req.query;
  if (!jobId) {
    return res.status(400).json({ ok: false, error: 'job_id query parameter required' });
  }
  const status = getDownloadStatus(jobId);
  if (!status) {
    return res.status(404).json({ ok: false, error: 'job not found' });
  }
  res.json(status);
});

router.post('/models/dedupe', (req, res) => {
  try {
    const result = dedupeModels();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
