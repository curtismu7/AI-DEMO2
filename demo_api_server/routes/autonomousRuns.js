'use strict';
/**
 * /api/autonomous-runs — read back runs that happened with nobody watching.
 *
 * This is the replay path: the Token Chain rail is fed live over SSE during a
 * browser-driven run, so a 02:00 job can never appear there as it happens. The
 * run's token events are stored instead, and the UI hands them to the same
 * store the live path uses.
 *
 * Auth: PUBLIC — no sign-in, by explicit decision, so the Autonomous Agents
 * page can be opened and driven without a session. An unattended run has no
 * user to own it (its principal is the agent), so there is no per-user
 * ownership filter here the way /api/transaction-trace has one.
 *
 * What that exposes, stated plainly because it is a deliberate hole: anyone who
 * can reach this host can read every unattended run, start one, and switch the
 * feature on. The one narrowing applied is that /flag writes ONLY
 * ff_autonomous_agents — a public write to arbitrary flags was never asked for
 * and is not offered. Every other flag still requires the admin gate on
 * /api/admin/feature-flags.
 */
const express = require('express');
const router = express.Router();
const runStore = require('../services/lmdb/autonomousRunStore.lmdb');
const scheduler = require('../services/autonomousAgentScheduler');
const configStore = require('../services/configStore');

/** The only flag this public route may write. */
const FLAG = 'ff_autonomous_agents';

// Flag read/write sits BEFORE the feature gate below: you cannot turn the
// feature on through a route that refuses to answer while it is off.
router.get('/flag', (req, res) => {
  res.json({ flag: FLAG, enabled: scheduler.isEnabled() });
});

router.post('/flag', async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled_must_be_boolean' });
  }
  try {
    // setRaw takes a map, not (key, value) — see configStore.js:1407.
    await configStore.setRaw({ [FLAG]: String(enabled) });
    res.json({ flag: FLAG, enabled: scheduler.isEnabled() });
  } catch (err) {
    res.status(500).json({ error: 'flag_write_failed', message: err.message });
  }
});

// The feature being off means no run should exist and none should be startable.
// Reporting the feature state beats an empty list that reads like "it ran and
// found nothing".
router.use((req, res, next) => {
  if (!scheduler.isEnabled()) {
    return res.status(403).json({ error: 'feature_disabled', flag: 'ff_autonomous_agents' });
  }
  next();
});

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const runs = runStore.list(limit);
  // The list is for picking a run — token events can be large, so they are
  // fetched per-run rather than shipped for every row.
  res.json({
    runs: runs.map(({ tokenEvents, ...rest }) => ({
      ...rest,
      tokenEventCount: (tokenEvents || []).length,
    })),
  });
});

router.get('/:runId', (req, res) => {
  const run = runStore.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'run_not_found' });
  res.json({ run });
});

// Fire a run without waiting for the cron. This is what makes the feature
// demo-able at all -- nobody watches a demo at 02:00.
router.post('/run', async (req, res) => {
  const job = (req.body && req.body.job) || 'fraud-watch';
  if (!scheduler.JOBS[job]) {
    return res.status(400).json({ error: 'unknown_job', job, known: Object.keys(scheduler.JOBS) });
  }
  try {
    const run = await scheduler.runJobNow({ trigger: 'manual', job });
    if (!run) return res.status(403).json({ error: 'feature_disabled', flag: 'ff_autonomous_agents' });
    res.json({ run });
  } catch (err) {
    res.status(500).json({ error: 'run_failed', message: err.message });
  }
});

// The absent human answering. In the demo this is a button; in the real flow it
// is the CIBA push landing on their device. Either way the run was holding the
// transfer, so approval is what actually moves the money.
router.post('/:runId/approve', async (req, res) => {
  try {
    res.json({ run: await scheduler.approveParkedRun(req.params.runId) });
  } catch (err) {
    res.status(err.httpStatus || 500).json({ error: err.message });
  }
});

router.post('/:runId/deny', (req, res) => {
  try {
    res.json({ run: scheduler.denyParkedRun(req.params.runId) });
  } catch (err) {
    res.status(err.httpStatus || 500).json({ error: err.message });
  }
});

module.exports = router;
