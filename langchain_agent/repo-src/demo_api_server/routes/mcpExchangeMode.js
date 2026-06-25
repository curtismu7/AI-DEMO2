// banking_api_server/routes/mcpExchangeMode.js
// Session-scoped exchange mode toggle for the demo dashboard.
// GET  /api/mcp/exchange-mode  -> { mode: 'single'|'double' }
// POST /api/mcp/exchange-mode  -> { mode: 'single'|'double' } body -> saves to session

'use strict';
const express = require('express');
const router = express.Router();

router.get('/exchange-mode', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'not_authenticated' });
  const mode = req.session.mcpExchangeMode || 'double';
  res.json({ mode });
});

router.post('/exchange-mode', express.json(), (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'not_authenticated' });
  const mode = req.body?.mode;
  if (mode !== 'single' && mode !== 'double') {
    return res.status(400).json({ error: 'invalid_mode', valid: ['single', 'double'] });
  }
  req.session.mcpExchangeMode = mode;
  res.json({ mode });
});

module.exports = router;
