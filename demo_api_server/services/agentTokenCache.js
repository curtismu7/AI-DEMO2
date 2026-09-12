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
 *
 * Every writer mints between get() and set(), so an invalidation that lands
 * during a mint used to be undone by the in-flight set() — re-caching a token
 * minted under the authorization the consent change / revoke / logout just
 * removed (Greptile P1 on #3148). clear() therefore advances a per-session
 * generation, and set() takes the generation captured BEFORE the mint and drops
 * the write when it no longer matches.
 */

/** @type {Map<string, object>} `${sessionId} ${vertical}::${scopes}` -> token entry */
const tokens = new Map();
/** @type {Map<string, {gen: number, at: number}>} sessionId -> invalidation generation */
const generations = new Map();

/**
 * A mint that outlives this cannot be told apart from a fresh one, so its write
 * is allowed. Every mint path is bounded well below it (tool/exchange timeouts
 * are tens of seconds).
 */
const GENERATION_TTL_MS = 5 * 60 * 1000;

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

/** Drop expired tokens and long-settled generations — both outlive the sessions now. */
function sweep(now) {
  for (const [key, entry] of tokens) {
    if (now >= entry.expires_at) tokens.delete(key);
  }
  for (const [sessionId, entry] of generations) {
    if (now - entry.at >= GENERATION_TTL_MS) generations.delete(sessionId);
  }
}

/**
 * The session's current invalidation generation. Capture it BEFORE minting and
 * hand it back to set(), so a clear() that lands mid-mint wins.
 */
function generation(session) {
  const sessionId = idOf(session);
  if (!sessionId) return 0;
  const entry = generations.get(sessionId);
  return entry ? entry.gen : 0;
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

/**
 * Cache a freshly-minted token for (session, vertical, scopeSet) with a 60s
 * safety margin. Pass `since` — generation(session) from before the mint — so
 * an invalidation during the mint discards this write instead of being undone.
 */
function set(session, vertical, scopes, tokenResult, since) {
  const sessionId = idOf(session);
  if (!sessionId || !tokenResult) return;
  if (typeof since === 'number' && since !== generation(session)) return;
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

/**
 * Drop every token cached for this session (logout, consent change, revoke) and
 * advance its generation so a mint already in flight cannot restore one.
 */
function clear(session) {
  const sessionId = idOf(session);
  if (!sessionId) return;
  const prefix = `${sessionId} `;
  for (const key of tokens.keys()) {
    if (key.startsWith(prefix)) tokens.delete(key);
  }
  generations.set(sessionId, { gen: generation(session) + 1, at: Date.now() });
}

module.exports = { keyFor, get, set, newest, clear, generation };
