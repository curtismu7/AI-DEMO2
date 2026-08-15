'use strict';
/**
 * Guided Demo Track API — read state, start runs, set the active step.
 * Mounted behind authenticateToken in server.js (same posture as /api/use-cases).
 */
const express = require('express');
const router = express.Router();
const svc = require('../services/demoTrackService');

router.get('/', (req, res) => {
  res.json(svc.getState());
});

router.post('/runs', (req, res) => {
  res.json({ run: svc.startRun() });
});

router.get('/runs', (req, res) => {
  res.json({ runs: svc.getHistory() });
});

router.post('/active-step', (req, res) => {
  res.json({ run: svc.setActiveStep(req.body && req.body.stepId) });
});

router.post('/arm', (req, res) => {
  const { stepId, color } = req.body || {};
  res.json({ run: svc.armSlot({ stepId, color }) });
});

module.exports = router;
