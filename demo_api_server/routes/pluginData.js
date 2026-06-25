'use strict';

const express = require('express');
const router = express.Router();
const { verticalManifest } = require('../services/verticalManifest');
const verticalDispatch = require('../services/verticalDispatch');

/**
 * GET /api/plugin/data — returns the active vertical plugin's data for the authenticated user.
 * Used to fetch per-vertical data (patient records, orders, etc.) for dashboard rendering.
 * Returns 404 when the active vertical has no plugin (banking is MCP-backed).
 * Returns 200 with { vertical, data } on success.
 */
router.get('/', (req, res) => {
  // Session-scoped: serve the plugin data for THIS session's vertical.
  const activeId = verticalManifest.resolver.activeIdFor(req);
  if (!activeId) return res.status(404).json({ error: 'no_active_vertical' });

  const plugin = verticalDispatch.resolvePlugin(activeId);
  if (!plugin) return res.status(404).json({ error: 'no_plugin', vertical: activeId });

  const store = plugin.getDataStore();
  if (!store || typeof store.get !== 'function') {
    return res.status(404).json({ error: 'no_data_store', vertical: activeId });
  }

  const userId = req.user && req.user.id;
  const data = store.get(userId);
  res.json({ vertical: activeId, data });
});

module.exports = router;
