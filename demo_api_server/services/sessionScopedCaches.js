'use strict';

/**
 * One call site for every in-process cache keyed by session id.
 *
 * These caches used to live ON req.session, where `session.destroy()` dropped
 * them for free. They were moved off it because a write inside a long request
 * made express-session save that request's whole start-of-request copy when it
 * ended, undoing anything saved meanwhile — the agent-mode revert chain in
 * REGRESSION_PLAN §4 (/api/agent/run, the agent-token cache, the DPoP keypair).
 *
 * Moving them off the session made every session-destruction path responsible
 * for clearing them (Greptile P1 on #3151: the first cut wired only the two
 * OAuth logout handlers, so admin kill-switch, refresh-expiry and the unified
 * logout orphaned entries until their sweep). Clearing is cheap and idempotent,
 * so call this next to EVERY `req.session.destroy()` rather than picking which
 * ones matter — the sweeps stay as the backstop, not the plan.
 */

/**
 * Drop every session-scoped in-process cache entry for this session.
 * Safe with a missing/idless session, and never throws: callers are teardown
 * paths that must still destroy the session and answer the request.
 * @param {object} session - req.session (may be undefined)
 */
function clearSessionScopedCaches(session) {
  if (!session) return;
  try {
    require('./agentTokenCache').clear(session);
  } catch (err) {
    console.warn('[sessionScopedCaches] agent-token clear failed (non-fatal):', err.message);
  }
  try {
    require('./dpopKeyService').clearSessionDpopKey(session);
  } catch (err) {
    console.warn('[sessionScopedCaches] DPoP key clear failed (non-fatal):', err.message);
  }
}

module.exports = { clearSessionScopedCaches };
