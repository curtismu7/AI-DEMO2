'use strict';

/**
 * Jev learning-page route (public — the page it serves renders signed out).
 *
 * POST /api/demo/jev/evaluate  { scenario: 'injection'|'intent'|'risk'|…, state: string }
 *   -> { scenario, jev: {mode, model, latencyMs, answer}, heuristic: {latencyMs, answer} }
 * POST /api/demo/jev/batch  { scenario, states: string[] }  (max 20)
 *   -> { scenario, totalLatencyMs, jev: [...per-state results], heuristic: {latencyMs, answers: [...]} }
 * POST /api/demo/jev/langchain { scenario, state }
 *   -> { scenario, proxied, langchain: {mode, model, latency_ms, answer, usage},
 *        heuristic: {latencyMs, answer} }
 *   Proxies to the langchain agent's VonDecisions route (LangChain
 *   OpenAIDecisions port of the same lesson); the heuristic baseline stays
 *   here so bake-off numbers come from one implementation.
 * GET  /api/demo/jev/status    -> { live: boolean }
 *
 * Public means the only thing standing between a visitor and the paid key is
 * the scenario lock in services/jevService.js plus this rate limit.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { evaluate, heuristic, isConfigured, SCENARIOS } = require('../services/jevService');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');
const { internalSecret } = require('../utils/internalSecret');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded', message: 'Too many Jev requests. Try again in a minute.' },
});

router.get('/status', (req, res) => res.json({ live: isConfigured() }));

// Same scenario lock as the service: validate here so the langchain proxy can
// never be used as a generic POST-through to the agent container.
const SCENARIO_KEYS = new Set(['injection', 'intent', 'risk']);
const AGENT_TIMEOUT_MS = 65000; // the agent allows 60s for Von's cold-start weight load

router.post('/langchain', limiter, async (req, res) => {
  const { scenario, state } = req.body || {};
  const text = String(state || '');
  if (!SCENARIO_KEYS.has(scenario) || !text.trim()) {
    return res.status(400).json({ error: 'invalid_request', message: 'Unknown scenario or empty state.' });
  }
  const t0 = Date.now();
  const baseline = heuristic(scenario, text);
  const heuristicMs = Date.now() - t0;

  const agentUrl = process.env.LANGCHAIN_AGENT_HTTP_URL || 'http://127.0.0.1:8888';
  try {
    const { data } = await axios.post(
      `${agentUrl.replace(/\/$/, '')}/jev/evaluate`,
      { scenario, state: text },
      {
        timeout: AGENT_TIMEOUT_MS,
        // the agent's :8888 middleware gate — same as routes/agentRun.js
        headers: { 'x-internal-gateway-secret': internalSecret() },
      }
    );
    return res.json({ scenario, proxied: true, langchain: data, heuristic: { latencyMs: heuristicMs, answer: baseline } });
  } catch (err) {
    console.error('[jev] langchain proxy failed:', normalizeAxiosError(err, { label: 'jev-langchain', timeoutMs: AGENT_TIMEOUT_MS }).message);
    return res.status(502).json({ error: 'jev_upstream_failed', message: 'LangChain Jev did not answer; try again.' });
  }
});

router.post('/evaluate', limiter, async (req, res) => {
  const { scenario, state, mode } = req.body || {};
  try {
    const t0 = Date.now();
    const baseline = heuristic(scenario, String(state || ''));
    const heuristicMs = Date.now() - t0;
    const jev = await evaluate(scenario, state, { heuristicsOnly: mode === 'heuristics' });
    return res.json({ scenario, jev, heuristic: { latencyMs: heuristicMs, answer: baseline } });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: 'invalid_request', message: err.message });
    console.error('[jev] evaluate failed:', err.message);
    return res.status(502).json({ error: 'jev_upstream_failed', message: 'Jev did not answer; try again.' });
  }
});

// Batch: one scenario, many states — the "14 checks in one call" pattern from
// the PR-review demo. States ride in as an array of strings (capped); each is
// judged through the same scenario lock as /evaluate. In simulated mode the
// heuristic answers per state; in live mode the questions fan out in parallel.
router.post('/batch', limiter, async (req, res) => {
  const { scenario, states, mode } = req.body || {};
  if (!SCENARIOS[scenario]) {
    return res.status(400).json({ error: 'invalid_request', message: 'Unknown scenario.' });
  }
  if (!Array.isArray(states) || !states.length) {
    return res.status(400).json({ error: 'invalid_request', message: 'states must be a non-empty array.' });
  }
  if (states.length > 20) {
    return res.status(400).json({ error: 'invalid_request', message: 'At most 20 states per batch.' });
  }
  try {
    const t0 = Date.now();
    const baseline = states.map((s) => heuristic(scenario, String(s || '')));
    const heuristicMs = Date.now() - t0;
    const started = Date.now();
    const jevResults = await Promise.all(
      states.map(async (s, i) => {
        try {
          const r = await evaluate(scenario, s, { heuristicsOnly: mode === 'heuristics' });
          return { index: i, ...r };
        } catch (err) {
          return { index: i, mode: 'error', error: err.message || 'failed' };
        }
      }),
    );
    return res.json({
      scenario,
      totalLatencyMs: Date.now() - started,
      jev: jevResults,
      heuristic: { latencyMs: heuristicMs, answers: baseline },
    });
  } catch (err) {
    console.error('[jev] batch failed:', err.message);
    return res.status(502).json({ error: 'jev_upstream_failed', message: 'Jev did not answer; try again.' });
  }
});

module.exports = router;
