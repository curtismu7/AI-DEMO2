'use strict';

const oauthUserService = require('../services/oauthUserService');
const tokenChainService = require('../services/tokenChainService');

/**
 * In-memory guards to prevent thundering-herd refresh attempts.
 *
 * _refreshInFlight: Set of session IDs currently attempting a refresh.
 *   Concurrent requests for the same session skip the refresh and let the
 *   first one finish (its session.save() will propagate to later requests).
 *
 * _refreshBlacklist: Map<sessionId, expireTimestamp>.  When a refresh token
 *   is rejected by PingOne (invalid_grant / does not exist / revoked), the
 *   session is blacklisted so we stop retrying on every poll hit.
 *   Entries auto-expire after BLACKLIST_TTL so a fresh login can work again.
 */
const _refreshInFlight = new Set();
const _refreshBlacklist = new Map();
const BLACKLIST_TTL = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of expired blacklist entries to prevent unbounded memory growth.
// Runs every 5 minutes; only iterates entries that exist (O(n) with n = blacklisted sessions).
const BLACKLIST_CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [sid, expiry] of _refreshBlacklist) {
    if (now >= expiry) _refreshBlacklist.delete(sid);
  }
}, BLACKLIST_CLEANUP_INTERVAL).unref(); // .unref() so the timer doesn't prevent process exit

/**
 * Effective access-token expiry (ms). Uses session.expiresAt when set; otherwise
 * decodes JWT `exp` so we still refresh when expiresAt was never persisted.
 */
function getAccessTokenExpiryMs(tokens) {
  if (tokens.expiresAt && typeof tokens.expiresAt === 'number') {
    return tokens.expiresAt;
  }
  const at = tokens.accessToken;
  if (!at || typeof at !== 'string' || at === '_cookie_session') return null;
  const parts = at.split('.');
  if (parts.length !== 3) return null;
  try {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    }
    return payload.exp ? payload.exp * 1000 : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Auto-refresh middleware (RFC 6749 §6).
 * If the session holds an end-user access token that is within 5 minutes of
 * expiry, silently refresh it before forwarding the request.
 * Skips cookie-restored sessions (accessToken === '_cookie_session') because
 * those do not have a real bearer token on this server.
 * Non-fatal: refresh errors are logged and the request continues unchanged.
 */
async function refreshIfExpiring(req, res, next) {
  try {
    const tokens = req.session?.oauthTokens;
    if (!tokens?.refreshToken) return next();
    if (tokens.accessToken === '_cookie_session') return next();

    const sid = req.sessionID;

    // Skip if this session's refresh token was recently rejected by PingOne
    const blacklistExpiry = _refreshBlacklist.get(sid);
    if (blacklistExpiry) {
      if (Date.now() < blacklistExpiry) return next();
      _refreshBlacklist.delete(sid); // expired — allow retry
    }

    const MARGIN = 5 * 60 * 1000; // 5 minutes
    const effectiveExp = getAccessTokenExpiryMs(tokens);
    if (!effectiveExp) return next();
    if ((Date.now() + MARGIN) < effectiveExp) return next();

    // Only one concurrent refresh per session — others skip and continue
    if (_refreshInFlight.has(sid)) return next();
    _refreshInFlight.add(sid);

    try {
      console.log('[tokenRefresh] Access token expiring soon (or expired), refreshing...');
      const tokenData = await oauthUserService.refreshAccessToken(tokens.refreshToken);

      req.session.oauthTokens = {
        ...tokens,
        accessToken:  tokenData.access_token,
        refreshToken: tokenData.refresh_token || tokens.refreshToken,
        idToken:      tokenData.id_token      || tokens.idToken,
        expiresAt:    Date.now() + ((tokenData.expires_in || 3600) * 1000),
        tokenType:    tokenData.token_type    || 'Bearer',
        // Marker for the token-chain UI: session-preview shows a 'token-refresh'
        // card whenever this is set (the refreshed AT is the current session AT).
        refreshedAt:  Date.now(),
      };
      // Transient request flag so the live tool-call chain (this same request,
      // e.g. /api/demo-agent) can prepend a 'token-refresh' card to its events.
      req._didRefresh = true;

      // Make the silent refresh visible in the token chain (teaching): record a
      // 'refresh' event carrying the newly minted access token's claims, so the
      // UI shows the RT -> new-AT step, not just auth/exchange. Fire-and-forget —
      // trackTokenEvent is in-memory and its result is unused. userId must match
      // the chain key the other emitters + route use (oauthId || sub).
      tokenChainService.trackTokenEvent({
        eventType: 'refresh',
        token: tokenData.access_token,
        userId: req.session.user?.oauthId || req.session.user?.sub,
        description: 'Silent refresh — new access token minted from the refresh token',
      }).catch((emitErr) => {
        console.warn('[tokenRefresh] token-chain refresh emit failed (non-fatal):', emitErr.message);
      });

      // Await the durable persist BEFORE releasing the in-flight guard. If the
      // guard is dropped first (fire-and-forget save), a concurrent request can
      // read the stale expiresAt, pass the expiry check, and refresh a second
      // time with the already-consumed (rotated) refresh token — PingOne returns
      // invalid_grant, the session is blacklisted, and the user is forced to
      // re-authenticate mid-session.
      await new Promise((resolve) => {
        req.session.save((err) => {
          if (err) console.error('[tokenRefresh] Session save error:', err);
          resolve();
        });
      });
    } finally {
      _refreshInFlight.delete(sid);
    }

    next();
  } catch (err) {
    console.warn('[tokenRefresh] Auto-refresh failed (continuing):', err.message);
    // If the refresh token is invalid/revoked/expired, blacklist + clear so we
    // stop retrying on every poll hit. The user will need to re-authenticate.
    if (err.message && /does not exist|invalid_grant|revoked|expired/i.test(err.message)) {
      const sid = req.sessionID;
      _refreshBlacklist.set(sid, Date.now() + BLACKLIST_TTL);
      _refreshInFlight.delete(sid);

      const tokens = req.session?.oauthTokens;
      if (tokens) {
        delete tokens.refreshToken;
        req.session.save(() => {}); // best-effort persist
      }
    }
    next(); // Don't block the request on a refresh failure
  }
}

module.exports = { refreshIfExpiring };
