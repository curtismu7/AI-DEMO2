// demo_api_server/routes/mcpDecisionPolling.js
/**
 * HITL (Human-in-the-Loop) decision polling for MCP tool authorization.
 *
 * "One HITL solution" — this module is now a thin ADAPTER over the canonical
 * HITL service (demo_hitl_service, port 3009). It preserves the existing UI
 * contract (`/api/mcp/decision/:taskId` GET/approve/deny and the
 * `createPendingDecision(userSub, ctx) -> { taskId }` server-side helper) while
 * delegating all storage to 3009 via hitlServiceClient. `taskId` IS the 3009
 * `challengeId`. Both the agent UI and the gateway therefore read/write ONE
 * store. See docs/superpowers/plans/2026-05-29-unified-hitl-one-solution.md.
 *
 * Why keep this module: two BFF callers (mcpToolPipeline first-tool gate via
 * deps.createHitlChallenge, and middleware/agentRestrictionsGate via
 * createPendingDecision) plus the UI's /decision routes are bound to this
 * contract. Adapting in place avoids a UI rewrite and a second store.
 */
'use strict';

const express = require('express');
const router = express.Router();
const hitlServiceClient = require('../services/hitlServiceClient');

/**
 * Create a pending HITL challenge in the canonical 3009 store.
 * Synchronous-looking callers (agentRestrictionsGate) await this.
 * @param {string} userSub - PingOne user sub (owner)
 * @param {object} context - { tool, decisionId, decisionContext, reason, agentId }
 * @returns {Promise<{ taskId: string }>} taskId === 3009 challengeId
 */
async function createPendingDecision(userSub, context = {}) {
  const challenge = await hitlServiceClient.createChallenge({
    tool: context.tool || null,
    userId: userSub,
    agentId: context.agentId,
    context: {
      decisionId: context.decisionId || null,
      decisionContext: context.decisionContext || 'McpFirstTool',
      reason: context.reason || 'Human approval required',
    },
  });
  return { taskId: challenge.challengeId };
}

/**
 * Fetch a decision by taskId (== 3009 challengeId). Returns the raw 3009 record
 * or null. Kept for back-compat; callers that need the owner check should use
 * the route below.
 * @param {string} taskId
 * @returns {Promise<object|null>}
 */
async function getDecision(taskId) {
  try {
    return await hitlServiceClient.getChallengeStatus(taskId);
  } catch {
    return null;
  }
}

/** Owner check: the 3009 record's userId must match the session user. */
function _sessionSub(req) {
  return req.session?.user?.oauthId || req.session?.user?.id || null;
}

/**
 * Shared preamble for the decision routes: require a session, fetch the 3009
 * challenge (→404 on miss/error), and enforce the per-user owner check (→403).
 * On success returns the 3009 record; on any failure it sends the response and
 * returns null, so callers do `const entry = await loadOwnedChallenge(...); if (!entry) return;`.
 */
async function loadOwnedChallenge(req, res) {
  if (!req.session?.user) {
    res.status(401).json({ error: 'authentication_required' });
    return null;
  }
  let entry;
  try {
    entry = await hitlServiceClient.getChallengeStatus(req.params.taskId);
  } catch {
    entry = null;
  }
  if (!entry) {
    res.status(404).json({ error: 'not_found', message: 'Decision not found or expired.' });
    return null;
  }
  const userSub = _sessionSub(req);
  if (entry.userId && userSub && entry.userId !== userSub) {
    res.status(403).json({ error: 'forbidden', message: 'Decision belongs to another user.' });
    return null;
  }
  return entry;
}

// ── Routes ────────────────────────────────────────────────────────────────

/**
 * GET /decision/:taskId — Poll for decision status (proxied to 3009).
 */
router.get('/decision/:taskId', async (req, res) => {
  const entry = await loadOwnedChallenge(req, res);
  if (!entry) return;
  return res.json({
    taskId: req.params.taskId,
    status: entry.status,
    tool: entry.tool,
    reason: entry.context?.reason,
    decisionId: entry.context?.decisionId,
    updatedAt: entry.resolvedAt || entry.createdAt || null,
  });
});

/**
 * POST /decision/:taskId/approve — User approves (proxied to 3009 respond).
 */
router.post('/decision/:taskId/approve', express.json(), (req, res) =>
  _respond(req, res, 'approved'),
);

/**
 * POST /decision/:taskId/deny — User denies (proxied to 3009 respond).
 */
router.post('/decision/:taskId/deny', express.json(), (req, res) =>
  _respond(req, res, 'denied'),
);

async function _respond(req, res, decision) {
  const entry = await loadOwnedChallenge(req, res);
  if (!entry) return;
  if (entry.status !== 'pending') {
    return res.status(409).json({ error: 'already_resolved', status: entry.status });
  }

  try {
    await hitlServiceClient.respondToChallenge(req.params.taskId, decision, req.correlationId);
  } catch (err) {
    return res.status(502).json({ error: 'hitl_service_error', message: err.message });
  }

  console.log(JSON.stringify({
    event: decision === 'approved' ? 'hitl_decision_approved' : 'hitl_decision_denied',
    taskId: req.params.taskId,
    userSub: _sessionSub(req),
    tool: entry.tool,
    decisionId: entry.context?.decisionId,
    timestamp: new Date().toISOString(),
  }));

  return res.json({ status: decision, taskId: req.params.taskId });
}

module.exports = router;
module.exports.createPendingDecision = createPendingDecision;
module.exports.getDecision = getDecision;
