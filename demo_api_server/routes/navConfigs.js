'use strict';
/**
 * navConfigs.js — shared named-config library for sidebar customization.
 *
 * GET    /api/nav-configs      → list all configs (builtins + custom)
 * POST   /api/nav-configs      → create a custom config from a snapshot
 * DELETE /api/nav-configs/:id  → delete a custom config (403 on builtins)
 */
const express = require('express');
const router = express.Router();
const navConfigStore = require('../services/lmdb/navConfigStore.lmdb');

router.get('/', (req, res) => {
  res.json({ configs: navConfigStore.listConfigs() });
});

router.post('/', (req, res) => {
  const { name, hiddenLabels, flagSnapshot } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!Array.isArray(hiddenLabels)) {
    return res.status(400).json({ error: 'hiddenLabels must be an array' });
  }
  const config = navConfigStore.createConfig(name.trim(), hiddenLabels, flagSnapshot || {});
  res.status(201).json({ config });
});

router.delete('/:id', (req, res) => {
  const result = navConfigStore.deleteConfig(req.params.id);
  if (!result.ok && result.reason === 'not_found') {
    return res.status(404).json({ error: 'Config not found' });
  }
  if (!result.ok && result.reason === 'builtin') {
    return res.status(403).json({ error: 'Cannot delete a built-in config' });
  }
  res.json({ deleted: true });
});

module.exports = router;
