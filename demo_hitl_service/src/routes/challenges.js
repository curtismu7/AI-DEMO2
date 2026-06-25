'use strict';

/**
 * HITL challenge REST routes.
 *
 *   POST   /challenges                  — create a new HITL challenge
 *   GET    /challenges/:id              — poll challenge status
 *   POST   /challenges/:id/respond      — human approves or denies
 *   GET    /challenges                  — list challenges (admin / dashboard)
 */

const express = require('express');
const router = express.Router();
const store = require('../store/challengeStore');
const { notifyUser } = require('../notifier');
const { teachLog } = require('../teachLogger');

const HITL_INTERNAL_SECRET = process.env.HITL_INTERNAL_SECRET || '';

function requireSecret(req, res, next) {
  if (!HITL_INTERNAL_SECRET) return next();
  if (req.headers['x-hitl-internal-secret'] !== HITL_INTERNAL_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// POST /challenges
// Body: { tool, userId, agentId, userEmail?, context? }
// Called by MCP Gateway when PingAuthorize returns INDETERMINATE/HITL obligation
router.post('/', requireSecret, async (req, res) => {
  const { tool, userId, agentId, userEmail, context } = req.body || {};

  if (!tool) {
    return res.status(400).json({ error: 'tool is required' });
  }

  let challenge;
  try {
    challenge = store.create({ tool, userId, agentId, context });
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  // Fire-and-forget notification — don't block the response
  if (userEmail) {
    notifyUser(challenge, userEmail).catch((err) =>
      teachLog.error('notification error', err, { challengeId: challenge.id, userEmail }),
    );
  }

  res.status(201).json({
    challengeId: challenge.id,
    status: challenge.status,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
    tool: challenge.tool,
    context: challenge.context,
  });
});

// GET /challenges/:id
// Polled by MCP Gateway to check if human has responded.
// requireSecret: the response carries userId/agentId/context (PII + transaction
// details) — an unauthenticated reader who guesses a challenge UUID must not see it.
router.get('/:id', requireSecret, (req, res) => {
  const challenge = store.get(req.params.id);
  if (!challenge) return res.status(404).json({ error: 'Challenge not found' });

  res.json({
    challengeId: challenge.id,
    status: challenge.status,
    tool: challenge.tool,
    userId: challenge.userId,
    agentId: challenge.agentId,
    context: challenge.context,
    createdAt: new Date(challenge.createdAt).toISOString(),
    expiresAt: new Date(challenge.expiresAt).toISOString(),
    resolvedAt: challenge.resolvedAt ? new Date(challenge.resolvedAt).toISOString() : null,
  });
});

// POST /challenges/:id/respond
// Body: { decision: 'approved' | 'denied', respondedBy? }
// Called by HITL dashboard UI or webhook (via BFF, which supplies the secret)
router.post('/:id/respond', requireSecret, (req, res) => {
  const { decision } = req.body || {};

  if (!decision) {
    return res.status(400).json({ error: 'decision required (approved|denied)' });
  }
  if (decision !== 'approved' && decision !== 'denied') {
    return res.status(400).json({ error: "decision must be 'approved' or 'denied'" });
  }

  let challenge;
  try {
    challenge = store.resolve(req.params.id, decision);
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }

  if (!challenge) return res.status(404).json({ error: 'Challenge not found' });

  res.json({
    challengeId: challenge.id,
    status: challenge.status,
    decision: challenge.decision,
    resolvedAt: challenge.resolvedAt ? new Date(challenge.resolvedAt).toISOString() : null,
  });
});

// GET /challenges?userId=&status=&limit=
// requireSecret: this enumerates pending challenges and leaks every queued userId.
router.get('/', requireSecret, (req, res) => {
  const { userId, status, limit } = req.query;
  const rawLimit = parseInt(limit, 10);
  const parsedLimit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;
  const challenges = store.list({
    userId: userId || null,
    status: status || null,
    limit: parsedLimit,
  });

  res.json({
    challenges: challenges.map((c) => ({
      challengeId: c.id,
      status: c.status,
      tool: c.tool,
      userId: c.userId,
      context: c.context,
      createdAt: new Date(c.createdAt).toISOString(),
      expiresAt: new Date(c.expiresAt).toISOString(),
      resolvedAt: c.resolvedAt ? new Date(c.resolvedAt).toISOString() : null,
    })),
    total: challenges.length,
  });
});

module.exports = router;
