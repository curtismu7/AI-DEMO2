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

// 'support' selects the support-console track; anything else is 'main'.
function _trackId(req) {
  return ((req.query && req.query.track) || (req.body && req.body.track)) === 'support' ? 'support' : 'main';
}

router.get('/', (req, res) => {
  res.json(svc.getState(req.sessionID, _trackId(req)));
});

router.post('/runs', (req, res) => {
  res.json({ run: svc.startRun(req.sessionID, _trackId(req)) });
});

router.get('/runs', (req, res) => {
  res.json({ runs: svc.getHistory(req.sessionID) });
});

router.post('/active-step', (req, res) => {
  res.json({ run: svc.setActiveStep(req.body && req.body.stepId, req.sessionID, _trackId(req)) });
});

router.post('/arm', (req, res) => {
  const { stepId, color } = req.body || {};
  res.json({ run: svc.armSlot({ stepId, color }, req.sessionID, _trackId(req)) });
});

module.exports = router;
