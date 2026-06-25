'use strict';
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const recognizeService = require('../services/recognizeService');

// POST /api/recognize/enroll
// Live enrollment (no body) OR enroll-from-image (imageBase64 + scenario in body).
router.post('/enroll', authenticateToken, express.json(), async (req, res) => {
  try {
    const { imageBase64, scenario } = req.body || {};
    if (imageBase64) {
      await recognizeService.enrollFromImage(req.user.id, imageBase64, scenario || 'TRUSTED_SOURCE');
    } else {
      await recognizeService.enrollUser(req.user.id);
    }
    res.json({ enrolled: true });
  } catch (err) {
    console.error('[Recognize] enroll failed:', err.message);
    res.status(502).json({ error: 'recognize_enroll_failed', message: err.message });
  }
});

// DELETE /api/recognize/enroll
// Removes the Recognize enrollment for the logged-in user.
router.delete('/enroll', authenticateToken, async (req, res) => {
  try {
    await recognizeService.unenrollUser(req.user.id);
    res.json({ enrolled: false });
  } catch (err) {
    console.error('[Recognize] unenroll failed:', err.message);
    res.status(502).json({ error: 'recognize_unenroll_failed', message: err.message });
  }
});

module.exports = router;
