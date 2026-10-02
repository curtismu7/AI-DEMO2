'use strict';

/**
 * Jev learning-page route (public — the page it serves renders signed out).
 *
 * POST /api/demo/jev/evaluate  { scenario: 'injection'|'intent'|'risk', state: string }
 *   -> { scenario, jev: {mode, model, latencyMs, answer}, heuristic: {latencyMs, answer} }
 * GET  /api/demo/jev/status    -> { live: boolean }
 *
 * Public means the only thing standing between a visitor and the paid key is
 * the scenario lock in services/jevService.js plus this rate limit.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { evaluate, heuristic, isConfigured } = require('../services/jevService');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded', message: 'Too many Jev requests. Try again in a minute.' },
});

router.get('/status', (req, res) => res.json({ live: isConfigured() }));

router.post('/evaluate', limiter, async (req, res) => {
  const { scenario, state } = req.body || {};
  try {
    const t0 = Date.now();
    const baseline = heuristic(scenario, String(state || ''));
    const heuristicMs = Date.now() - t0;
    const jev = await evaluate(scenario, state);
    return res.json({ scenario, jev, heuristic: { latencyMs: heuristicMs, answer: baseline } });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: 'invalid_request', message: err.message });
    console.error('[jev] evaluate failed:', err.message);
    return res.status(502).json({ error: 'jev_upstream_failed', message: 'Jev did not answer; try again.' });
  }
});

module.exports = router;
