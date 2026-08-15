'use strict';
/**
 * agentFlowHistory.js — per-user run history for the Agent & Token Flow
 * Inspector's history page (`/agent-flow-inspector`).
 *
 * Backed by reportStore.lmdb.js (durable, per-user), the same store already
 * fed by /api/agent/invoke and /api/demo-agent/nl — /api/agent/run (AG-UI)
 * and /api/admin-agent/message now write there too (see agentRun.js and
 * adminAgentRoutes.js), so this is the one list every execution path lands in.
 *
 * This is deliberately separate from routes/reports.js's GET /history, which
 * is a different feature by design (a shared demo-artifact gallery — every
 * user's reports, via reportStore.listAllRuns). This route is per-user only.
 *
 * Mounted with `authenticateToken` (see server.js); every route reads
 * req.user.sub — there is no :userId param, so there is nothing to widen
 * access with.
 *
 * Routes:
 *   GET /          — list the caller's own run history, newest first
 *   GET /:runId    — one run's full stored record
 */

const express = require('express');
const reportStore = require('../services/lmdb/reportStore.lmdb');

const router = express.Router();

/**
 * GET /?limit=50
 * List the authenticated user's run history, newest first.
 */
router.get('/', (req, res) => {
  const userId = req.user && req.user.sub;
  if (!userId) {
    return res.status(401).json({ error: 'authentication required' });
  }

  const limit = parseInt(req.query.limit || '50', 10);
  const runs = reportStore.listRuns(userId, { limit: Math.min(limit, 200) });
  return res.json({ runs, count: runs.length });
});

/**
 * GET /:runId
 * One run's full stored record, scoped to the authenticated caller.
 */
router.get('/:runId', (req, res) => {
  const userId = req.user && req.user.sub;
  if (!userId) {
    return res.status(401).json({ error: 'authentication required' });
  }

  const run = reportStore.getRun(userId, req.params.runId);
  if (!run) {
    return res.status(404).json({ error: 'run not found' });
  }
  return res.json({ run });
});

module.exports = router;
