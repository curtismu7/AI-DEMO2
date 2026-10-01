'use strict';

const oauthUserService = require('../services/oauthUserService');
const oauthService = require('../services/oauthService');
const tokenChainService = require('../services/tokenChainService');
const configStore = require('../services/configStore');
const { clearAuthCookie } = require('../services/authStateCookie');

function oauthServiceForSession(session) {
  const oauthType = session?.oauthType || (session?.user?.role === 'admin' ? 'admin' : 'user');
  return oauthType === 'admin' ? oauthService : oauthUserService;
}

/**
 * In-memory guards to prevent thundering-herd refresh attempts.
 *
 * _refreshInFlight: Map of session IDs to the durable refresh operation.
 *   Concurrent requests wait for that operation and reload the saved session
 *   before continuing, so they never use a rotated-away refresh token.
 *
 * _refreshBlacklist: Map<sessionId, expireTimestamp>.  When a refresh token
 *   is rejected by PingOne (invalid_grant / does not exist / revoked), the
 *   session is blacklisted so we stop retrying on every poll hit.
 *   Entries auto-expire after BLACKLIST_TTL so a fresh login can work again.
 */
const _refreshInFlight = new Map();
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

function normalizeOAuthProvider(provider) {
  if (provider === 'pingfederate') return 'pingfederate';
  if (provider === 'pingone' || provider === 'pingone_sso') return 'pingone';
  return null;
}

function saveSession(session) {
  return new Promise((resolve, reject) => {
    session.save((err) => {
      if (!err) return resolve();
      err.code ||= 'SESSION_PERSIST_FAILED';
      reject(err);
    });
  });
}

function reloadSession(session) {
  if (typeof session.reload !== 'function') return Promise.resolve();
  return new Promise((resolve, reject) => {
    session.reload((err) => err ? reject(err) : resolve());
  });
}

function invalidateMismatchedProviderSession(req, res, next) {
  const tokens = req.session?.oauthTokens;
  if (!req.session?.user || !tokens?.accessToken || tokens.accessToken === '_cookie_session') return false;

  const configuredProvider = configStore.getOAuthProvider?.() || 'pingone';
  const sessionProvider = normalizeOAuthProvider(
    req.session.oauthProvider || req.session.user.oauthProvider,
  );
  if (!sessionProvider || sessionProvider === normalizeOAuthProvider(configuredProvider)) return false;

  console.info(`[tokenRefresh] Clearing stale ${sessionProvider} session after provider changed to ${configuredProvider}`);
  delete req.session.oauthTokens;
  clearAuthCookie(res, !!(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === 'production'));
  req.session.save((err) => err ? next(err) : next());
  return true;
}

async function refreshSession(req, tokens) {
  console.log('[tokenRefresh] Access token expiring soon (or expired), refreshing...');
  const tokenData = await oauthServiceForSession(req.session).refreshAccessToken(tokens.refreshToken);

  req.session.oauthTokens = {
    ...tokens,
    accessToken:  tokenData.access_token,
    refreshToken: tokenData.refresh_token || tokens.refreshToken,
    idToken:      tokenData.id_token      || tokens.idToken,
    expiresAt:    Date.now() + ((tokenData.expires_in || 3600) * 1000),
    tokenType:    tokenData.token_type    || 'Bearer',
    refreshedAt:  Date.now(),
  };
  req._didRefresh = true;

  tokenChainService.trackTokenEvent({
    eventType: 'refresh',
    token: tokenData.access_token,
    userId: req.session.user?.oauthId || req.session.user?.sub,
    description: 'Silent refresh — new access token minted from the refresh token',
  }).catch((emitErr) => {
    console.warn('[tokenRefresh] token-chain refresh emit failed (non-fatal):', emitErr.message);
  });

  await saveSession(req.session);
  return req.session.oauthTokens;
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
    if (invalidateMismatchedProviderSession(req, res, next)) return;

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

    const inFlight = _refreshInFlight.get(sid);
    if (inFlight) {
      await inFlight;
      try {
        await reloadSession(req.session);
      } catch (err) {
        console.error('[tokenRefresh] Could not reload refreshed session:', err.message);
        return next(err);
      }
      req._didRefresh = true;
      return next();
    }

    const refreshOperation = refreshSession(req, tokens);
    _refreshInFlight.set(sid, refreshOperation);
    try {
      await refreshOperation;
    } finally {
      if (_refreshInFlight.get(sid) === refreshOperation) _refreshInFlight.delete(sid);
    }

    next();
  } catch (err) {
    console.warn('[tokenRefresh] Auto-refresh failed (continuing):', err.message);
    if (err.code === 'SESSION_PERSIST_FAILED') return next(err);
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
    next(); // Don't block the request on an upstream refresh failure
  }
}

module.exports = { refreshIfExpiring };
