'use strict';

/**
 * Admin Tools API (read-only) — GET /api/admin-tools → the 14 admin/PingOne-admin
 * ops formerly in the Actions dropdown's "Admin Actions" / "PingOne Admin"
 * sections. Source of truth: config/adminTools.js.
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { ADMIN_TOOLS } = require('../config/adminTools');

router.get('/', requireAdmin, (req, res) => {
  res.set({ 'Cache-Control': 'private, max-age=60' });
  res.json({ tools: ADMIN_TOOLS });
});

module.exports = router;
