'use strict';
/**
 * /api/autonomous-runs — read back runs that happened with nobody watching.
 *
 * This is the replay path: the Token Chain rail is fed live over SSE during a
 * browser-driven run, so a 02:00 job can never appear there as it happens. The
 * run's token events are stored instead, and the UI hands them to the same
 * store the live path uses.
 *
 * Auth: authenticateToken, applied at the mount. An unattended run has no user
 * to own it — its principal is the agent — so there is no per-user ownership
 * filter here the way /api/transaction-trace has one. Any signed-in user can
 * see that the demo's scheduled agent ran and what it found.
 */
const express = require('express');
const router = express.Router();
const runStore = require('../services/lmdb/autonomousRunStore.lmdb');
const scheduler = require('../services/autonomousAgentScheduler');

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
  try {
    const run = await scheduler.runJobNow({ trigger: 'manual' });
    if (!run) return res.status(403).json({ error: 'feature_disabled', flag: 'ff_autonomous_agents' });
    res.json({ run });
  } catch (err) {
    res.status(500).json({ error: 'run_failed', message: err.message });
  }
});

module.exports = router;
