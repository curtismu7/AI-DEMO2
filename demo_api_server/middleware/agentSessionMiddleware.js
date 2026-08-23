/**
 * Agent Session Middleware
 * Binds agent executor to authenticated user context
 * Handles RFC 8693 token exchange setup and session validation
 */

const oauthUserService = require('../services/oauthUserService');

/**
 * Concurrent-refresh guards for the agent-family routes (/api/agent,
 * /api/admin-agent, /api/ops-agent, /api/a2a, /api/support-agent,
 * /api/compliance-agent). These routes are NOT covered by the global
 * proactive refresh in server.js (only /api/demo-agent is), so this
 * reactive refresh is their only defense: without a guard, two concurrent
 * requests hitting an expired session both call PingOne with the same
 * refresh token. PingOne rotates refresh tokens on use, so the second call
 * gets invalid_grant and forces a full re-auth even though the first
 * call's refresh just succeeded.
 *
 * Mirrors the dedup Set + blacklist Map pattern in
 * middleware/tokenRefresh.js:refreshIfExpiring, adapted for this reactive/
 * blocking path: a concurrent caller AWAITS the in-flight refresh (rather
 * than skipping it) because the caller needs a valid access token before
 * it can proceed, and then reloads the session from the store to pick up
 * the tokens the in-flight request persisted.
 */
const _refreshInFlight = new Map(); // sessionId -> Promise
const _refreshBlacklist = new Map(); // sessionId -> expireTimestamp
const BLACKLIST_TTL = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of expired blacklist entries to prevent unbounded memory
// growth — mirrors middleware/tokenRefresh.js's sweep. Without it, a session
// that never returns with the same sessionId (the common case after a forced
// re-auth) leaves its entry here for the life of the process.
const BLACKLIST_CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [sid, expiry] of _refreshBlacklist) {
    if (now >= expiry) _refreshBlacklist.delete(sid);
  }
}, BLACKLIST_CLEANUP_INTERVAL).unref(); // .unref() so the timer doesn't prevent process exit

/**
 * Refreshes the OAuth access token for the current session using the stored refresh token.
 * Mirrors the pattern in middleware/tokenRefresh.js:refreshIfExpiring, including its
 * in-flight dedup + blacklist guards against the concurrent-refresh race.
 */
const refreshOAuthSession = async (req) => {
  const tokens = req.session && req.session.oauthTokens;
  if (!tokens || !tokens.refreshToken || tokens.refreshToken === '_cookie_session') {
    throw new Error('no_refresh_token_available');
  }

  const sid = req.sessionID;

  // Skip if this session's refresh token was recently rejected by PingOne
  const blacklistExpiry = _refreshBlacklist.get(sid);
  if (blacklistExpiry) {
    if (Date.now() < blacklistExpiry) throw new Error('invalid_grant');
    _refreshBlacklist.delete(sid); // expired — allow retry
  }

  // Another request for this session is already refreshing — await it
  // instead of racing it with the same (soon-to-be-rotated) refresh token.
  const inFlight = _refreshInFlight.get(sid);
  if (inFlight) {
    await inFlight;
    // The in-flight refresh persisted to the session STORE, not to this
    // request's own in-memory req.session — reload to pick up its result.
    if (req.sessionStore) {
      const stored = await new Promise((resolve) => {
        req.sessionStore.get(sid, (err, data) => resolve(err ? null : data));
      });
      if (stored?.oauthTokens) req.session.oauthTokens = stored.oauthTokens;
    }
    if (!req.session.oauthTokens?.accessToken || req.session.oauthTokens.expiresAt < Date.now()) {
      throw new Error('session_expired');
    }
    return;
  }

  const refreshPromise = (async () => {
    const tokenData = await oauthUserService.refreshAccessToken(tokens.refreshToken);
    req.session.oauthTokens.accessToken = tokenData.access_token;
    req.session.oauthTokens.refreshToken = tokenData.refresh_token || tokens.refreshToken;
    req.session.oauthTokens.expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;
    await new Promise((resolve, reject) =>
      req.session.save(err => err ? reject(err) : resolve())
    );
  })();
  _refreshInFlight.set(sid, refreshPromise);

  try {
    await refreshPromise;
  } catch (err) {
    if (err.message && /does not exist|invalid_grant|revoked|expired/i.test(err.message)) {
      _refreshBlacklist.set(sid, Date.now() + BLACKLIST_TTL);
    }
    throw err;
  } finally {
    _refreshInFlight.delete(sid);
  }
};

/**
 * Main middleware: validates session, attaches auth context
 * Should be applied to all /api/demo-agent/* routes
 */
async function agentSessionMiddleware(req, res, next) {
  try {
    console.log('[agentSessionMiddleware] Starting middleware');
    console.log('[agentSessionMiddleware] Session exists:', !!req.session);
    console.log('[agentSessionMiddleware] Request path:', req.path);
    console.log('[agentSessionMiddleware] Request method:', req.method);

    // Step 1: Verify user is authenticated via session (no authenticateToken needed —
    // full JWT re-validation can cause JWKS timeout errors; session is sufficient here).
    console.log('[agentSessionMiddleware] Checking session.user...');
    if (!req.session?.user) {
      console.log('[agentSessionMiddleware] ERROR: No session.user');
      return res.status(401).json({
        error: 'session_expired',
        message: 'Your sign-in session has expired. Sign in again to continue.',
        need_auth: true,
        requiresLogin: true,
      });
    }
    console.log('[agentSessionMiddleware] session.user present:', !!req.session.user);
    console.log('[agentSessionMiddleware] user keys:', Object.keys(req.session.user || {}));

    console.log('[agentSessionMiddleware] Checking oauthTokens...');
    if (!req.session.oauthTokens?.accessToken) {
      console.log('[agentSessionMiddleware] ERROR: No oauthTokens.accessToken');
      console.log('[agentSessionMiddleware] oauthTokens present:', !!req.session.oauthTokens);
      console.log('[agentSessionMiddleware] oauthTokens keys:', req.session.oauthTokens ? Object.keys(req.session.oauthTokens) : 'none');
      return res.status(401).json({
        error: 'oauth_session_required',
        message: 'The banking agent requires an active PingOne OAuth session. Please sign in via PingOne to use the agent.',
        hint: 'Use the "Sign in with PingOne" button — local account login does not provision agent tokens.',
        need_auth: true,
        requiresLogin: true,
      });
    }
    // Check if this is a cookie-restored stub (no real tokens available)
    if (req.session.oauthTokens.accessToken === '_cookie_session') {
      console.log('[agentSessionMiddleware] ERROR: OAuth access token is _cookie_session stub - real tokens not available');
      console.log('[agentSessionMiddleware] Session restored from cookie:', !!req.session._restoredFromCookie);
      console.log('[agentSessionMiddleware] Session store configured:', !!req.sessionStore);
      console.log('[agentSessionMiddleware] Session user present:', !!req.session.user);
      console.log('[agentSessionMiddleware] oauthTokens keys:', req.session.oauthTokens ? Object.keys(req.session.oauthTokens) : 'none');
      return res.status(401).json({
        error: 'session_restore_required',
        message: 'OAuth access token not available in session. Please sign in again.',
        hint: req.session._restoredFromCookie 
          ? 'Session was restored from cookie but real OAuth tokens are missing. Sign in again to get fresh tokens.'
          : 'Session has stub token instead of real OAuth tokens. This may indicate a session save failure. Sign in again.',
        need_auth: true,
        requiresLogin: true,
      });
    }
    console.log('[agentSessionMiddleware] oauthTokens.accessToken present:', !!req.session.oauthTokens.accessToken);

    // Step 2: Check session expiry and refresh if needed
    console.log('[agentSessionMiddleware] Checking token expiry...');
    if (req.session.oauthTokens.expiresAt && req.session.oauthTokens.expiresAt < Date.now()) {
      console.log('[agentSessionMiddleware] Token expired, attempting refresh...');
      try {
        await refreshOAuthSession(req);
        console.log('[agentSessionMiddleware] Token refresh successful');
      } catch (error) {
        console.error('[agentSessionMiddleware] ERROR: Refresh failed:', error.message);
        console.error('[agentSessionMiddleware] Refresh error stack:', error.stack);
        return res.status(401).json({
          error: 'session_expired',
          message: 'Your sign-in session has expired. Sign in again to continue.',
          need_auth: true,
          requiresLogin: true,
        });
      }
    }
    console.log('[agentSessionMiddleware] Token valid');

    // Step 3: Attach auth context to request for agent service.
    //
    // ARCHITECTURE-TRUTHS T-6: user identity is the PingOne UUID (sub/oauthId)
    // ONLY. session.user.id and session.user.oauthId are DIFFERENT UUIDs; the
    // legacy `.id` does not match per-user data (seeded against the PingOne
    // sub). The old `oauthId || id` fallback silently used the wrong identity
    // whenever oauthId was absent, surfacing as empty accounts/transactions.
    // Resolve from the PingOne sub only and fail closed if it is missing —
    // never fall back to the numeric/internal id.
    const pingOneSub = req.session.user.oauthId || req.session.user.sub;
    if (!pingOneSub) {
      console.error('[agentSessionMiddleware] ERROR: session.user has no PingOne sub (oauthId/sub) — refusing to fall back to legacy id');
      return res.status(401).json({
        error: 'session_expired',
        message: 'Your session is missing its identity. Please sign in again.',
        agentInitRequired: true,
        need_auth: true,
        requiresLogin: true,
      });
    }
    console.log('[agentSessionMiddleware] Attaching agentContext...');
    req.agentContext = {
      userId: pingOneSub,
      email: req.session.user.email || 'unknown',
      accessToken: req.session.oauthTokens.accessToken,
      refreshToken: req.session.oauthTokens.refreshToken || null,
      sessionId: req.sessionID,
      // Phase 3: RFC 8693 token exchange fields
      subjectToken: null, // Subject token with may_act (user context)
      txToken: null, // Delegated transaction token (act claim)
      txTokenExpiresAt: null, // When txToken expires
      agentCCToken: null, // Agent client credentials token (from Phase 1)
      mcpAccessToken: null, // RFC 8693 §3.2: populated after token exchange
      tokenExchangedAt: null,
      tokenEvents: [],
    };
    console.log('[agentSessionMiddleware] agentContext.userId:', req.agentContext.userId);
    console.log('[agentSessionMiddleware] agentContext.email:', req.agentContext.email);
    console.log('[agentSessionMiddleware] agentContext.accessToken present:', !!req.agentContext.accessToken);

    // Enterprise-managed MCP: auto-establish agent consent when IT policy passes.
    try {
      const enterpriseMcpPolicy = require('../services/enterpriseMcpPolicyService');
      if (enterpriseMcpPolicy.isEnabled()) {
        req.enterpriseManagedMode = true;
        const policy = await enterpriseMcpPolicy.establishEnterpriseSession(req);
        req.enterpriseMcpPolicy = policy;
        if (!policy.allowed && policy.code === 'enterprise_mcp_policy_denied') {
          req.enterpriseMcpPolicyDenied = true;
        }
      }
    } catch (e) {
      console.warn('[agentSessionMiddleware] enterprise MCP policy skipped:', e.message);
    }

    // Step 4: Initialize token events tracking for this request
    // Events will be collected during MCP tool calls and returned in response
    req.tokenEvents = req.agentContext.tokenEvents;

    // Steps 5: Add helper methods for token exchange (will be called by agent service)
    req.recordTokenEvent = (type, data) => {
      req.tokenEvents.push({
        type,
        timestamp: new Date().toISOString(),
        ...data,
      });
    };

    console.log('[agentSessionMiddleware] All checks passed, calling next()');
    // All checks passed — proceed to next middleware/handler
    next();
  } catch (error) {
    console.error('[agentSessionMiddleware] ERROR: Middleware error');
    console.error('[agentSessionMiddleware] Error name:', error.name);
    console.error('[agentSessionMiddleware] Error message:', error.message);
    console.error('[agentSessionMiddleware] Error stack:', error.stack);
    console.error('[agentSessionMiddleware] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Optional: Middleware to enforce agent context presence
 * Use after agentSessionMiddleware if you want double-validation
 */
function requireAgentContext(req, res, next) {
  if (!req.agentContext) {
    return res.status(500).json({
      error: 'Agent context not initialized',
      message: 'Please ensure agentSessionMiddleware is applied before this middleware.',
    });
  }
  next();
}

/**
 * Helper to safely access auth context with defaults
 */
function getAuthContextOrDefault(req) {
  return (
    req.agentContext || {
      userId: null,
      email: null,
      accessToken: null,
      refreshToken: null,
      sessionId: null,
      subjectToken: null,
      txToken: null,
      txTokenExpiresAt: null,
      agentCCToken: null,
      mcpAccessToken: null, // RFC 8693 §3.2: populated after token exchange
      tokenExchangedAt: null,
    }
  );
}

/**
 * Guest-permissive variant: attaches full auth context when a valid session
 * exists; sets req.agentContext = null and continues when there is no session.
 * Protected actions must check !req.agentContext and return need_auth: true.
 * Use only on routes that have explicit per-handler guest handling (demoAgentRoutes).
 */
async function agentGuestSessionMiddleware(req, res, next) {
  // No session at all → guest pass-through
  if (!req.session?.user || !req.session.oauthTokens?.accessToken ||
      req.session.oauthTokens.accessToken === '_cookie_session') {
    req.agentContext = null;
    req.tokenEvents = [];
    req.recordTokenEvent = () => {};
    return next();
  }

  // Valid session exists — run the full auth middleware
  return agentSessionMiddleware(req, res, next);
}

module.exports = {
  agentSessionMiddleware,
  agentGuestSessionMiddleware,
  requireAgentContext,
  getAuthContextOrDefault,
};
