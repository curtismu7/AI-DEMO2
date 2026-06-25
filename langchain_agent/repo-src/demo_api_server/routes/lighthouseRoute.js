// demo_api_server/routes/lighthouseRoute.js
'use strict';

const express = require('express');
const router = express.Router();
const configStore = require('../services/configStore');
const lighthouseService = require('../services/lighthouseService');

// Resolve the audit target URL from configStore (PUBLIC_APP_URL) or fall back to default
function getAuditUrl() {
  const base = configStore.getEffective('PUBLIC_APP_URL') || 'https://api.ping.demo:4000';
  return `${base}/admin`;
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
  next();
}

/**
 * POST /api/admin/lighthouse/run
 * Triggers a Lighthouse audit. Returns the result immediately.
 */
router.post('/run', requireAdmin, async (req, res) => {
  if (lighthouseService.isRunning) {
    return res.status(429).json({ error: 'An audit is already in progress' });
  }

  lighthouseService.isRunning = true;
  try {
    const result = await lighthouseService.runLighthouseAudit(getAuditUrl());
    res.json({ result });
  } catch (err) {
    console.error('[lighthouse] Audit failed:', err.message);
    if (err.code === 'CHROME_NOT_FOUND') {
      return res.status(503).json({ error: 'Lighthouse audit failed: Chrome not available' });
    }
    if (err.code === 'LIGHTHOUSE_TIMEOUT') {
      return res.status(504).json({ error: 'Lighthouse audit timed out' });
    }
    res.status(500).json({ error: 'Lighthouse audit failed: ' + err.message });
  } finally {
    lighthouseService.isRunning = false;
  }
});

/**
 * GET /api/admin/lighthouse/history
 * Returns stored audit history (up to 30 entries).
 */
router.get('/history', requireAdmin, (req, res) => {
  const history = lighthouseService.getHistory();
  res.json({ history });
});

module.exports = router;
