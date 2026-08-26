'use strict';

/**
 * Agent registry — the read surface over agentRegistryService.
 *
 * Guarded by authenticateToken, matching routes/controlPlane.js: this is the
 * same class of control-plane view, and it exposes identity metadata (client
 * ids, scopes, lifecycle) though never a secret.
 */
const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const agentRegistryService = require('../services/agentRegistryService');

const router = express.Router();

/**
 * GET /api/registry/agents
 *
 * Always 200 when the registry can be assembled at all — a dead source shows
 * as `sources.<name>.up === false` with the reason, and every other identity
 * still renders. Degrading beats blanking the page.
 */
router.get('/agents', authenticateToken, async (_req, res) => {
  try {
    const registry = await agentRegistryService.buildRegistry();
    return res.json(registry);
  } catch (err) {
    console.error('[agentRegistry] failed to build registry:', err?.stack || String(err));
    return res.status(500).json({ error: 'registry_unavailable' });
  }
});

/** GET /api/registry/agents/:id — one identity from the same merged view. */
router.get('/agents/:id', authenticateToken, async (req, res) => {
  try {
    const registry = await agentRegistryService.buildRegistry();
    const row = registry.rows.find((r) => r.id === req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    return res.json(row);
  } catch (err) {
    console.error('[agentRegistry] failed to build registry:', err?.stack || String(err));
    return res.status(500).json({ error: 'registry_unavailable' });
  }
});

module.exports = router;
