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
const { emitHop } = require('../transactionHop');

const HITL_INTERNAL_SECRET = process.env.HITL_INTERNAL_SECRET || '';

function requireSecret(req, res, next) {
  if (!HITL_INTERNAL_SECRET) {
    // Fail closed: require the secret in ALL environments.
    // Only allow bypass when HITL_ALLOW_UNSECURED=true is explicitly set in local dev.
    const allowUnsecured = process.env.HITL_ALLOW_UNSECURED === 'true' &&
      process.env.NODE_ENV !== 'production';
    if (allowUnsecured) {
      console.warn('[HITL] WARNING: HITL_INTERNAL_SECRET is unset and HITL_ALLOW_UNSECURED=true — skipping auth (dev only)');
      return next();
    }
    return res.status(503).json({
      error: 'hitl_misconfigured',
      message: 'HITL_INTERNAL_SECRET is required. Set it in the environment or set HITL_ALLOW_UNSECURED=true for local development.',
    });
  }
  if (req.headers['x-hitl-internal-secret'] !== HITL_INTERNAL_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// POST /challenges
// Body: { tool, userId, agentId, userEmail?, context? }
// Called by MCP Gateway when PingAuthorize returns INDETERMINATE/HITL obligation
router.post('/', requireSecret, async (req, res) => {
  const { tool, userId, agentId, userEmail, context, correlationId } = req.body || {};

  if (!tool) {
    return res.status(400).json({ error: 'tool is required' });
  }

  let challenge;
  try {
    challenge = store.create({ tool, userId, agentId, context, correlationId });
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

  // params carries the consented arguments — INV-7 compares them against the
  // arguments the tool actually executed with.
  //
  // Only emit when the challenge itself carries a correlationId. Do NOT let
  // emitHop() fall back to the per-request ALS id: correlationMiddleware
  // fabricates a fresh random UUID for every request that doesn't supply one
  // (see correlationMiddleware.js), so a challenge created without a
  // correlationId would otherwise emit a hop stamped with an unrelated,
  // fabricated id — an orphan single-hop transaction record in the UI.
  if (challenge.correlationId) {
    emitHop({
      phase: 'hitl.consent',
      op: challenge.tool,
      correlationId: challenge.correlationId,
      identity: { sub: challenge.userId || null, act: challenge.agentId ? [challenge.agentId] : [] },
      decision: {
        outcome: challenge.decision === 'approved' ? 'permit' : 'deny',
        by: 'gateway',
        reason: `hitl_${challenge.decision}`,
      },
      params: challenge.context || {},
      status: 'ok',
    });
  }

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
