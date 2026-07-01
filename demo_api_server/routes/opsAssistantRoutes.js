'use strict';
const express = require('express');
const router = express.Router();
const { processOpsMessage } = require('../services/opsAssistantService');

const VALID = new Set(['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce']);

router.post('/:vertical/ops-assistant', async (req, res) => {
  const { vertical } = req.params;
  if (!VALID.has(vertical)) return res.status(404).json({ error: 'unknown_vertical' });

  const { message, query, history } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message must be a non-empty string' });
  if (message.length > 2000) return res.status(400).json({ error: 'message too long (max 2000)' });

  const langchainConfig = (req.session && req.session.langchain_config) || {};
  try {
    const response = await processOpsMessage({
      vertical, query: String(query || ''), message,
      history: Array.isArray(history) ? history.slice(-10) : [],
      langchainConfig,
    });
    if (!response.success && response.error) return res.status(502).json(response);
    return res.json(response);
  } catch (err) {
    return res.status(500).json({ reply: '', success: false, error: err.message });
  }
});

module.exports = router;
