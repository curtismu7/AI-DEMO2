/**
 * Agent Session Middleware
 * Binds agent executor to authenticated user context
 * Handles RFC 8693 token exchange setup and session validation
 */

const oauthUserService = require('../services/oauthUserService');

/**
 * Refreshes the OAuth access token for the current session using the stored refresh token.
 * Mirrors the pattern in middleware/tokenRefresh.js:refreshIfExpiring.
 */
const refreshOAuthSession = async (req) => {
  const tokens = req.session && req.session.oauthTokens;
  if (!tokens || !tokens.refreshToken || tokens.refreshToken === '_cookie_session') {
    throw new Error('no_refresh_token_available');
  }
  const tokenData = await oauthUserService.refreshAccessToken(tokens.refreshToken);
  req.session.oauthTokens.accessToken = tokenData.access_token;
  req.session.oauthTokens.refreshToken = tokenData.refresh_token || tokens.refreshToken;
  req.session.oauthTokens.expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;
  await new Promise((resolve, reject) =>
    req.session.save(err => err ? reject(err) : resolve())
  );
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
        error: 'Unauthorized',
        message: 'Please log in to access the banking agent.',
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
          error: 'Session expired',
          message: 'Could not refresh session. Please log in again.',
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
        error: 'Session expired',
        message: 'Your session is missing its identity. Please sign in again.',
        agentInitRequired: true,
        need_auth: true,
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
    return res
      .status(500)
      .json({ error: 'Internal server error', message: error.message });
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

module.exports = {
  agentSessionMiddleware,
  requireAgentContext,
  getAuthContextOrDefault,
};
