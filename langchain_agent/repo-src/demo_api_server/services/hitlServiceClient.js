'use strict';

/**
 * hitlServiceClient.js — BFF client for the canonical HITL service (port 3009).
 *
 * "One HITL solution": demo_hitl_service is the single source of truth for
 * agent-initiated HITL challenges and receipts. The MCP gateway already uses it
 * (demo_mcp_gateway/src/hitlClient.ts); this is the BFF's matching client so the
 * BFF agent gate verifies receipts the SAME way the gateway does — one store,
 * one verification contract. See
 * docs/superpowers/plans/2026-05-29-unified-hitl-one-solution.md.
 *
 * verifyHitlReceipt is a faithful JS port of the gateway's TS function so the
 * anti-replay binding (user + agent + tool, approved + not-expired) is identical
 * on both paths. This is the ONLY place allowed to authorize hitlApproved=true.
 */

const HITL_SERVICE_URL = process.env.HITL_SERVICE_URL || 'http://localhost:3009';
const HITL_TIMEOUT_MS = Number(process.env.HITL_SERVICE_TIMEOUT_MS || 5000);
const HITL_INTERNAL_SECRET = process.env.HITL_INTERNAL_SECRET || '';

/**
 * Reserved tool-arg the agent echoes on a HITL retry to carry the approved
 * challenge id. The pipeline reads + STRIPS it before forwarding downstream so
 * it never reaches the tool. The gateway uses the same literal — keep the two in
 * sync (one constant per package; cross-package sharing is out of scope).
 */
const HITL_CHALLENGE_ARG = '_hitl_challenge_id';

/**
 * POST /challenges — create a pending HITL challenge in the canonical store.
 * @param {{ tool: string, userId?: string, agentId?: string, userEmail?: string, context?: object }} payload
 * @param {string} [correlationId]
 * @returns {Promise<{ challengeId: string, status: string, expiresAt: string, tool: string, context: object }>}
 */
async function createChallenge(payload, correlationId) {
  const res = await _fetchJson(`${HITL_SERVICE_URL}/challenges`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(HITL_INTERNAL_SECRET ? { 'X-HITL-Internal-Secret': HITL_INTERNAL_SECRET } : {}),
      ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
    },
    body: JSON.stringify({ ...payload, ...(correlationId ? { correlationId } : {}) }),
  });
  return res;
}

/**
 * GET /challenges/:id — fetch current challenge status.
 * @param {string} challengeId
 * @returns {Promise<object>} the challenge record (challengeId, status, userId, agentId, tool, expiresAt, ...)
 */
async function getChallengeStatus(challengeId) {
  return _fetchJson(`${HITL_SERVICE_URL}/challenges/${encodeURIComponent(challengeId)}`, {
    method: 'GET',
    headers: {
      ...(HITL_INTERNAL_SECRET ? { 'X-HITL-Internal-Secret': HITL_INTERNAL_SECRET } : {}),
    },
  });
}

/**
 * POST /challenges/:id/respond — human approves or denies (dashboard/UI path).
 * @param {string} challengeId
 * @param {'approved'|'denied'} decision
 * @param {string} [correlationId]
 * @returns {Promise<{ challengeId: string, status: string, decision: string, resolvedAt: string }>}
 */
async function respondToChallenge(challengeId, decision, correlationId) {
  return _fetchJson(`${HITL_SERVICE_URL}/challenges/${encodeURIComponent(challengeId)}/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(HITL_INTERNAL_SECRET ? { 'X-HITL-Internal-Secret': HITL_INTERNAL_SECRET } : {}),
      ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
    },
    body: JSON.stringify({ decision }),
  });
}

/**
 * Verify an approved HITL receipt is bound to THIS caller, agent, and tool.
 *
 * Faithful port of demo_mcp_gateway/src/hitlClient.ts::verifyHitlReceipt — keep
 * the two in lockstep (the "one verification contract" invariant). Lenient on
 * absent binding fields (older/looser challenge records pass on those fields);
 * only a MISMATCH or non-approved/expired status rejects.
 *
 * @param {object} status            GET /challenges/:id response body
 * @param {string|undefined} expectedUserId   userSub from the inbound session/token
 * @param {string|undefined} expectedAgentId  act.sub from the inbound MCP token (may be undefined)
 * @param {string} expectedTool      tool name being retried
 * @param {number} [now=Date.now()]  injectable for tests
 * @returns {{ ok: boolean, message?: string }}
 */
function verifyHitlReceipt(status, expectedUserId, expectedAgentId, expectedTool, now = Date.now()) {
  if (!status || typeof status !== 'object') {
    return { ok: false, message: 'No HITL challenge status' };
  }
  if (status.status !== 'approved') {
    return { ok: false, message: `HITL challenge not approved (status: ${status.status})` };
  }

  // Expired-but-approved receipts must NOT be honoured.
  if (status.expiresAt) {
    const expiryMs = Date.parse(status.expiresAt);
    if (Number.isFinite(expiryMs) && expiryMs < now) {
      return { ok: false, message: 'HITL challenge expired' };
    }
  }

  if (status.userId && expectedUserId && status.userId !== expectedUserId) {
    return { ok: false, message: 'HITL challenge belongs to a different user' };
  }
  if (status.agentId && expectedAgentId && status.agentId !== expectedAgentId) {
    return { ok: false, message: 'HITL challenge belongs to a different agent' };
  }
  if (status.tool && expectedTool && status.tool !== expectedTool) {
    return { ok: false, message: 'HITL challenge belongs to a different tool' };
  }

  return { ok: true };
}

/**
 * Fetch JSON with a timeout. Throws on non-2xx or network/timeout error — the
 * caller (gate/pipeline) is responsible for fail-closed handling (re-challenge,
 * never PERMIT, on any error).
 */
async function _fetchJson(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HITL_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HITL service ${opts.method} ${url} failed (${res.status}): ${text}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  createChallenge,
  getChallengeStatus,
  respondToChallenge,
  verifyHitlReceipt,
  HITL_SERVICE_URL,
  HITL_CHALLENGE_ARG,
};
