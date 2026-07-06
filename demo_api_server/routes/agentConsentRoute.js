'use strict';

const express = require('express');
const { requireSession } = require('../middleware/auth');
const { agentRunStore } = require('../services/agentRunStore');

const router = express.Router();

/** Resolve the PingOne user sub from the browser session. */
function _sessionSub(req) {
  return req.session?.user?.oauthId || req.session?.user?.id || null;
}

/**
 * POST /api/agent/consent/:runId
 *
 * Signals consent approval/denial for a HITL-suspended run.
 * Cloud-safe: publishes to Redis pub/sub channel agui:consent:<runId>
 * so the SSE handler (which may be on a different instance) receives it.
 * Body: { approved: boolean }
 */
router.post('/consent/:runId', requireSession, async (req, res) => {
  const { runId } = req.params;
  const { approved } = req.body;
  const userSub = _sessionSub(req);

  const runState = await agentRunStore.getRunState(runId);
  if (!runState) {
    return res.status(404).json({ error: 'Run not found' });
  }
  if (runState.status !== 'suspended_hitl') {
    return res.status(409).json({ error: 'Run is not awaiting consent' });
  }
  if (!runState.userId || !userSub || runState.userId !== userSub) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Consent request belongs to another user.',
    });
  }

  // Publish consent signal via pub/sub — SSE handler on any instance receives it
  await agentRunStore.publishConsent(runId, { approved: Boolean(approved) });

  // Remove run state from Redis (SSE handler will clean up its subscription)
  await agentRunStore.deleteRunState(runId);

  return res.json({ ok: true, runId, approved: Boolean(approved) });
});

module.exports = router;
