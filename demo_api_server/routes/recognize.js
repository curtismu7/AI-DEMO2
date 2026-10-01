'use strict';

const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

function unavailable(_req, res) {
  return res.status(503).json({ error: 'recognize_contract_unavailable' });
}

// Retain the old paths during migration but do not accept image bodies,
// client booleans, or the former session-token protocol.
router.post('/enroll', authenticateToken, unavailable);
router.delete('/enroll', authenticateToken, unavailable);

module.exports = router;
