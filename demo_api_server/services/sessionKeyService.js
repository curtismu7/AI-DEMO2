'use strict';

const crypto = require('crypto');

/**
 * The UI still sends these two literal strings from call sites that have no
 * real per-agent id (App.js:351 openAdminStopAgent → "default-agent",
 * ControlPlaneRoster.jsx:152 no-live-agent fallback → "demo-agent"). Treating
 * them as absent here — rather than editing four already-shipped UI files —
 * is the caller-side choice the kill-mechanisms design spec calls for.
 */
const PLACEHOLDER_AGENT_IDS = new Set(['default-agent', 'demo-agent']);

/**
 * Resolve the key every kill-switch enforcement check and every kill-switch
 * write uses for "which agent." A real explicit id (when the caller has one,
 * e.g. ControlPlaneRoster's live.id) wins. Otherwise this falls back to a
 * key scoped to the caller's own session, so two different users clicking
 * "Stop Agent" on a shared-label surface no longer collide (the bug this
 * exists to fix — see docs/superpowers/specs/2026-08-10-agent-kill-mechanisms-design.md).
 * @param {{sessionID?: string}|null|undefined} req
 * @param {string|null|undefined} explicitAgentId
 * @returns {string}
 */
function deriveAgentKey(req, explicitAgentId) {
  const explicit = explicitAgentId && !PLACEHOLDER_AGENT_IDS.has(explicitAgentId)
    ? String(explicitAgentId).trim()
    : '';
  if (explicit) return explicit;

  const sessionID = req && req.sessionID;
  if (!sessionID) return 'session:anonymous';

  const hash = crypto.createHash('sha256').update(sessionID).digest('hex').slice(0, 16);
  return `session:${hash}`;
}

module.exports = { deriveAgentKey };
