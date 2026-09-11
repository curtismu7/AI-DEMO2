'use strict';

/**
 * Agent-token cache keyed by (session id, vertical, scopeSet).
 *
 * The agent (client-credentials / exchanged) token used for tools/list is the
 * same across calls within a given vertical + scope set, so we cache it and
 * reuse it. Switching the active vertical or flipping the write toggle is a
 * deliberate cache miss — it re-mints the token and re-runs tools/list, which
 * is the visible Authorize moment.
 *
 * Held in this process, NOT on req.session. Stored under req.session.agentTokens
 * a cache miss marked the session modified, so express-session wrote the whole
 * session back when the request ENDED — the copy it had loaded when the request
 * STARTED. An 11s POST /api/demo-agent/tools on a cold cache therefore undid an
 * agent-mode change made while it ran (seen live 2026-09-11): the same
 * last-write-wins class as REGRESSION_PLAN §4's /api/agent/run entry, reached
 * through a different route.
 *
 * Entries carry their own TTL and expired ones are swept on write, so guest
 * session churn cannot grow the map now that the session no longer clears it on
 * logout; clear() drops a session's tokens promptly. In-process: the same
 * single-BFF-process assumption mcpFlowSseHub and agentRunContext make.
 */

/** @type {Map<string, object>} `${sessionId} ${vertical}::${scopes}` -> token entry */
const tokens = new Map();

function keyFor(vertical, scopes) {
  const s = (Array.isArray(scopes) ? scopes : String(scopes || '').split(/\s+/))
    .filter(Boolean)
    .sort()
    .join(' ');
  return `${vertical || 'banking'}::${s}`;
}

/** A session with no id cannot be keyed — it behaves as permanently uncached. */
const idOf = (session) => (session && typeof session.id === 'string' && session.id) || null;
const entryKey = (sessionId, vertical, scopes) => `${sessionId} ${keyFor(vertical, scopes)}`;

/** Drop every entry whose TTL has passed — the map outlives the sessions now. */
function sweep(now) {
  for (const [key, entry] of tokens) {
    if (now >= entry.expires_at) tokens.delete(key);
  }
}

/** Return a non-expired cached token for (session, vertical, scopeSet), or null. */
function get(session, vertical, scopes) {
  const sessionId = idOf(session);
  if (!sessionId) return null;
  const entry = tokens.get(entryKey(sessionId, vertical, scopes));
  if (!entry) return null;
  if (Date.now() >= entry.expires_at) return null;
  return entry;
}

/** Cache a freshly-minted token for (session, vertical, scopeSet) with a 60s safety margin. */
function set(session, vertical, scopes, tokenResult) {
  const sessionId = idOf(session);
  if (!sessionId || !tokenResult) return;
  const now = Date.now();
  sweep(now);
  const ttlMs = Math.max(0, ((tokenResult.expires_in || 3600) - 60) * 1000);
  tokens.set(entryKey(sessionId, vertical, scopes), { ...tokenResult, expires_at: now + ttlMs });
}

/**
 * The session's latest-expiring non-expired access token, across every vertical
 * and scopeSet — what the resource-server tester probes as "the MCP token".
 */
function newest(session) {
  const sessionId = idOf(session);
  if (!sessionId) return null;
  const prefix = `${sessionId} `;
  const now = Date.now();
  let best = null;
  for (const [key, entry] of tokens) {
    if (!key.startsWith(prefix) || !entry.access_token) continue;
    if (now >= entry.expires_at) continue;
    if (!best || entry.expires_at > best.expires_at) best = entry;
  }
  return best ? best.access_token : null;
}

/** Drop every token cached for this session (logout, consent change, revoke). */
function clear(session) {
  const sessionId = idOf(session);
  if (!sessionId) return;
  const prefix = `${sessionId} `;
  for (const key of tokens.keys()) {
    if (key.startsWith(prefix)) tokens.delete(key);
  }
}

module.exports = { keyFor, get, set, newest, clear };
