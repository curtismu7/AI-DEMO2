'use strict';

const tokenIntrospectionService = require('./tokenIntrospectionService');
const { trackTokenEvent } = require('./tokenChainService');
const { trackToken } = require('./apiCallTrackerService');
const archEmit = require('./archEventEmitter');

/**
 * Build a signed-in ADMIN session (the admin counterpart of establishUserSession).
 * Regenerates the session id (anti-fixation), stores tokens/user, records the token-chain
 * entry and kicks off login introspection, then saves. Never redirects and never touches
 * cookies: the caller owns the response, audit and failure cleanup.
 *
 * `onRegenerated(session)` lets the caller stamp extra session fields right after regenerate.
 * Returns { ok: true, oauthTokens } or { ok: false, reason }.
 */
async function establishAdminSession(req, res, {
  tokenData, provider, clientType, user, onRegenerated,
}) {
  // Pre-capture before regenerating the session to prevent session fixation
  const oauthTokens = {
    accessToken: tokenData.access_token,
    idToken: tokenData.id_token || null,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + (tokenData.expires_in * 1000),
    tokenType: tokenData.token_type || 'Bearer',
    scope: tokenData.scope || null,
  };

  const regenErr = await new Promise((resolve) => req.session.regenerate((e) => resolve(e || null)));
  if (regenErr) {
    console.error('[oauth/callback] Session regenerate FAILED — aborting login (session fixation risk):', regenErr.message);
    return { ok: false, reason: 'session_regenerate_failed', error: regenErr };
  }

  req.session.oauthTokens = oauthTokens;
  req.session.user = user;
  req.session.clientType = clientType;
  req.session.oauthProvider = provider;
  if (onRegenerated) onRegenerated(req.session);
  archEmit({ nodeId: 'n-pingone', edgeId: 'e-bff-pingone', label: 'PingOne issued access + ID token' });

  // Record initial auth token into token chain so /api/token-chain/current reflects login
  if (oauthTokens.accessToken && user?.id) {
    // Use decoded.sub as userId key — must match req.user.id set by authenticateToken middleware
    const _tcClaims = (() => { try { return require('jsonwebtoken').decode(oauthTokens.accessToken) || {}; } catch { return {}; } })();
    const _tcUserId = _tcClaims.sub || user.id;
    trackTokenEvent({
      eventType: 'auth',
      token: oauthTokens.accessToken,
      userId: _tcUserId,
      description: 'User authenticated via PingOne OAuth',
    }).catch(err => {
      console.error('[oauth/callback] Failed to track token event:', err.message);
    });

    // Track token for API call display (separate from token chain)
    trackToken(req.session.id, {
      token: oauthTokens.accessToken,
      tokenType: 'user_token',
      description: 'OAuth Access Token',
    });

    // RFC 7662 — introspect at login so /api/tokens/session-preview can show
    // "active-token introspection" in the Token Chain before any tool call.
    // Fire-and-forget: non-fatal, result stored in session for display only.
    tokenIntrospectionService.validateToken(oauthTokens.accessToken)
      .then((intro) => {
        req.session.loginIntrospection = {
          active:    intro.valid,
          sub:       intro.sub,
          exp:       intro.exp,
          aud:       intro.aud,
          scopes:    intro.scopes,
          client_id: intro.client_id,
        };
        req.session.save((e) => { if (e) console.warn('[oauth/callback] loginIntrospection session save:', e.message); });
      })
      .catch((err) => {
        console.debug('[oauth/callback] loginIntrospection skipped:', err.message);
      });
  }

  // Save session before redirect to prevent race condition where status
  // endpoint runs before session is persisted to the store
  const saveErr = await new Promise((resolve) => req.session.save((e) => resolve(e || null)));
  if (saveErr) {
    console.error('[oauth/callback] Session save FAILED — aborting admin login:', saveErr.message);
    return { ok: false, reason: 'session_persist_failed', error: saveErr };
  }
  return { ok: true, oauthTokens };
}

module.exports = { establishAdminSession };
