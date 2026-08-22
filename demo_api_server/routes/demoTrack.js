'use strict';
/**
 * Guided Demo Track API — read state, start runs, set the active step.
 * Mounted behind optionalAuthenticateToken (server.js) — a guest presenter
 * can drive the whole walkthrough without signing in. State is scoped by
 * req.sessionID (see demoTrackService.js), not by user identity, so this
 * stays safe for anonymous use: each browser session gets its own track.
 */
const express = require('express');
const router = express.Router();
const svc = require('../services/demoTrackService');

router.get('/', (req, res) => {
  res.json(svc.getState(req.sessionID));
});

router.post('/runs', (req, res) => {
  res.json({ run: svc.startRun(req.sessionID) });
});

router.get('/runs', (req, res) => {
  res.json({ runs: svc.getHistory(req.sessionID) });
});

router.post('/active-step', (req, res) => {
  res.json({ run: svc.setActiveStep(req.body && req.body.stepId, req.sessionID) });
});

router.post('/arm', (req, res) => {
  const { stepId, color } = req.body || {};
  res.json({ run: svc.armSlot({ stepId, color }, req.sessionID) });
});

module.exports = router;
