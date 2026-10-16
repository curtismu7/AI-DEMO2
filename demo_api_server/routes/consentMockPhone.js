'use strict';

const express = require('express');
const { start, poll, decide } = require('../services/consentMockPhoneService');

const router = express.Router();

const reply = (res, action) => {
  res.set('Cache-Control', 'no-store');
  try {
    return res.json(action());
  } catch (error) {
    return res.status(error.httpStatus || 500).json({ error: error.code || 'consent_mock_failed', message: error.message });
  }
};

router.post('/start', (req, res) => reply(res, () => start(req, req.body)));
router.get('/status', (req, res) => reply(res, () => poll(req)));
router.post('/decision', (req, res) => reply(res, () => decide(req, req.body?.decision)));

module.exports = router;
