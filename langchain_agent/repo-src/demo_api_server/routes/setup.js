// banking_api_server/routes/setup.js
'use strict';

/**
 * Public setup helpers (no secrets): bootstrap plan from example manifest.
 * @see docs/SETUP_AUTOMATION_PLAN.md
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  planStepsFromManifest,
  loadManifestFromPath,
  getExampleManifestPath,
} = require('../services/pingoneBootstrapService');

const router = express.Router();

const planLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'too_many_requests', message: 'Too many requests. Try again shortly.' },
});

/** GET /api/setup/plan — planned PingOne bootstrap steps (example manifest). */
router.get('/plan', planLimiter, async (_req, res) => {
  try {
    const manifestPath = getExampleManifestPath();
    const manifest = await loadManifestFromPath(manifestPath);
    const steps = planStepsFromManifest(manifest);
    res.json({
      ok: true,
      manifestVersion: manifest.version ?? null,
      steps,
      manifestPath: 'config/pingone-bootstrap.manifest.example.json',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'plan_failed' });
  }
});

module.exports = router;
