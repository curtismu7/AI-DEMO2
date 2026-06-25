'use strict';

/**
 * Session-scoped agent-token cache, keyed by (vertical, scopeSet).
 *
 * The agent (client-credentials / exchanged) token used for tools/list is the
 * same across calls within a given vertical + scope set, so we cache it on the
 * session and reuse it. Switching the active vertical or flipping the write
 * toggle is a deliberate cache miss — it re-mints the token and re-runs
 * tools/list, which is the visible Authorize moment.
 *
 * Lifecycle: stored under req.session.agentTokens; logout's req.session.destroy()
 * clears it for free — no separate teardown needed.
 */

function keyFor(vertical, scopes) {
  const s = (Array.isArray(scopes) ? scopes : String(scopes || '').split(/\s+/))
    .filter(Boolean)
    .sort()
    .join(' ');
  return `${vertical || 'banking'}::${s}`;
}

/** Return a non-expired cached token for (vertical, scopeSet), or null. */
function get(session, vertical, scopes) {
  const entry = session && session.agentTokens && session.agentTokens[keyFor(vertical, scopes)];
  if (!entry) return null;
  if (Date.now() >= entry.expires_at) return null;
  return entry;
}

/** Cache a freshly-minted token for (vertical, scopeSet) with a 60s safety margin. */
function set(session, vertical, scopes, tokenResult) {
  if (!session) return;
  session.agentTokens = session.agentTokens || {};
  const ttlMs = Math.max(0, ((tokenResult.expires_in || 3600) - 60) * 1000);
  session.agentTokens[keyFor(vertical, scopes)] = { ...tokenResult, expires_at: Date.now() + ttlMs };
}

module.exports = { keyFor, get, set };
