'use strict';
/**
 * userNavConfig.js — per-user active sidebar selection.
 *
 * GET /api/user/nav-config → this user's current hidden-item labels
 * PUT /api/user/nav-config → update this user's hidden-item labels
 *
 * hiddenLabels is always returned as [] when ff_sidebar_customization is
 * OFF, regardless of what's stored — the flag gates the feature at read
 * time, so toggling it back on restores the user's last saved selection.
 */
const express = require('express');
const router = express.Router();
const navConfigStore = require('../services/lmdb/navConfigStore.lmdb');
const configStore = require('../services/configStore');

function isFlagOn() {
  const raw = configStore.getEffective('ff_sidebar_customization');
  return raw === true || raw === 'true';
}

router.get('/', (req, res) => {
  const flagOn = isFlagOn();
  const prefs = navConfigStore.getUserPrefs(req.user.id);
  res.json({
    hiddenLabels: flagOn ? prefs.hiddenLabels : [],
    activeConfigId: prefs.activeConfigId,
    navOrder: prefs.navOrder || null,
    flagOn,
  });
});

router.put('/', (req, res) => {
  const { hiddenLabels, activeConfigId, navOrder } = req.body || {};
  if (!Array.isArray(hiddenLabels)) {
    return res.status(400).json({ error: 'hiddenLabels must be an array' });
  }
  if (navOrder !== undefined && navOrder !== null && !Array.isArray(navOrder)) {
    return res.status(400).json({ error: 'navOrder must be an array or null' });
  }
  const prefs = navConfigStore.setUserPrefs(req.user.id, hiddenLabels, activeConfigId || null, navOrder);
  const flagOn = isFlagOn();
  res.json({
    hiddenLabels: flagOn ? prefs.hiddenLabels : [],
    activeConfigId: prefs.activeConfigId,
    navOrder: prefs.navOrder || null,
    flagOn,
  });
});

module.exports = router;
