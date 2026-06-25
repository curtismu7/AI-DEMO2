'use strict';
const express = require('express');
const router = express.Router();
const spec = require('../config/oas/pingone-fragment.json');

// GET /api/oas/pingone-fragment — serve the mock OAS fragment (no auth: it's public spec)
router.get('/pingone-fragment', (_req, res) => {
  res.set({ 'Cache-Control': 'public, max-age=3600' });
  res.json(spec);
});

module.exports = router;
