const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const oauthService = require('../services/oauthService');
const configStore = require('../services/configStore');
const dataStore = require('../data/store');
const { determineClientType } = require('../middleware/auth');
const resourceIndicatorService = require('../services/resourceIndicatorService');
const {
  getFrontendOrigin,
  getAdminRedirectUri,
  validateRedirectUriOrigin,
  getExpectedFrontendOrigin,
} = require('../services/oauthRedirectUris');
const { setPkceCookie, readPkceCookie, clearPkceCookie } = require('../services/pkceStateCookie');
const { setAuthCookie, clearAuthCookie } = require('../services/authStateCookie');
const { clearAllAuthCookies, buildPingOneSignoffUrl } = require('../services/sessionCookies');
const oauthConfig = require('../config/oauth');
const { buildPingOneAuthorizeResourceQueryParam } = require('../utils/oauthAuthorizeResource');
const { trackTokenEvent } = require('../services/tokenChainService');
const { trackToken } = require('../services/apiCallTrackerService');
const { logEvent: logAppEvent } = require('../services/appEventService');
const tokenIntrospectionService = require('../services/tokenIntrospectionService');
const { decodeJwt } = require('../utils/tokenUtils');
const posthog = require('../services/posthog');
const archEmit = require('../services/archEventEmitter');
const { terminateAllUserSessions } = require('../services/pingOneSessionService');
const { sanitizePostLoginReturnPath } = require('./oauthUser');

const _isProd = () => !!(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === 'production');

/**
 * GET /api/auth/oauth/redirect-info — implemented on app in server.js (before /api/auth mount).
 */

/**
 * Initiate OAuth login for admin users
 * Redirects to PingOne Core authorization endpoint
 */
router.get('/login', (req, res) => {
  try {
    const _clientId = configStore.getEffective('PINGONE_ADMIN_CLIENT_ID');
    const _envId    = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
    console.debug('[oauth/login] HIT client_id=%s env_id=%s configured=%s',
      _clientId ? _clientId.slice(0, 8) + '...' : 'MISSING',
      _envId    ? _envId.slice(0, 8)    + '...' : 'MISSING',
      configStore.isConfigured()
    );

    // Guard: redirect to config if PingOne credentials are not set
    if (!configStore.isConfigured()) {
      return res.redirect(`${getFrontendOrigin()}/config?error=not_configured`);
    }

    // Drop a prior end-user OAuth session so Admin sign-in does not reuse customer tokens/role.
    const isEndUserSession =
      req.session?.oauthType === 'user' || req.session?.user?.role === 'customer';
    if (isEndUserSession) {
      delete req.session.oauthTokens;
      delete req.session.user;
      delete req.session.clientType;
      delete req.session.oauthType;
      // Also clear the _auth cookie so the session-restore middleware cannot
      // resurrect the customer identity on a different Vercel instance.
      clearAuthCookie(res, _isProd());
    }

    // Generate state parameter for CSRF protection
    const state = oauthService.generateState();

    // Generate PKCE code_verifier and store in session
    const codeVerifier = oauthService.generateCodeVerifier();
    const redirectUri = getAdminRedirectUri(req);
    console.log('[oauth/login] Redirect URI obtained:', {
      redirectUri,
      fromConfigStore: configStore.getEffective('admin_redirect_uri'),
      sessionId: req.sessionID?.slice(0, 8) + '...',
    });

    // Validate redirect_uri domain matches the expected deployment origin
    const uriCheck = validateRedirectUriOrigin(redirectUri);
    if (!uriCheck.ok) {
      console.warn('[oauth] Redirect URI rejected:', uriCheck.reason, redirectUri);
      return res.status(400).json({ error: 'invalid_redirect_uri', message: uriCheck.reason });
    }

    req.session.oauthState = state;
    req.session.oauthCodeVerifier = codeVerifier;
    req.session.oauthRedirectUri = redirectUri;
    console.log('[oauth/login] Stored in session - redirectUri:', redirectUri);

    // Same-origin SPA path to land on after admin login (e.g. the admin link a
    // customer clicked before being routed through the role switch). Mirrors
    // the end-user login's return_to handling in oauthUser.js — only set when a
    // return_to is present; do NOT delete an already-stored path when it is
    // absent, so a mid-handshake re-entry can't drop the user to the /dashboard
    // (or /admin) fallback. regenerate() in the callback clears it per-login.
    const returnPath = sanitizePostLoginReturnPath(req.query.return_to);
    if (returnPath) {
      req.session.postLoginReturnToPath = returnPath;
    }

    // Generate a nonce for OIDC replay protection (RFC 6749 / OIDC Core §3.1.2.1)
    const nonce = crypto.randomBytes(16).toString('hex');
    req.session.oauthNonce = nonce;

    // Handle RFC 9728 resource indicators
    let selectedResources = [];
    if (resourceIndicatorService.isResourceIndicatorsEnabled()) {
      // Get resources from query parameters or use defaults
      const queryResources = req.query.resource ? 
        (Array.isArray(req.query.resource) ? req.query.resource : [req.query.resource]) : 
        [];
      
      // Validate resource selection
      const validation = resourceIndicatorService.validateResourceSelection(_clientId, queryResources);
      
      if (!validation.valid) {
        console.warn('[oauth] Resource validation failed:', validation.errors);
        return res.status(400).json({ 
          error: 'invalid_resource_selection', 
          message: validation.errors.join(', ')
        });
      }
      
      selectedResources = validation.allowedResources;
      
      // Store resources in session for callback validation
      req.session.oauthResources = selectedResources;
      
      console.debug('[oauth] RFC 9728 resources selected:', selectedResources);
    }

    // Generate authorization URL (includes code_challenge derived from verifier)
    let resourceParam = '';
    if (selectedResources.length > 0) {
      // Use RFC 9728 resource indicators
      resourceParam = selectedResources.map(resource => 
        `&resource=${encodeURIComponent(resource)}`
      ).join('');
    } else {
      // Fallback to legacy resource parameter
      resourceParam = buildPingOneAuthorizeResourceQueryParam(
        process.env.ENDUSER_AUDIENCE,
        oauthConfig.scopes,
      );
    }
    
    const authUrl = oauthService.generateAuthorizationUrl(state, codeVerifier, redirectUri, nonce) + resourceParam;

    const cfg = oauthService.config || {};
    console.debug('[oauth/login] client_id=%s redirect_uri=%s env_id=%s authorize_pi.flow=%s',
      cfg.clientId ? cfg.clientId.slice(0, 8) + '...' : 'MISSING',
      redirectUri,
      cfg.tokenEndpoint ? cfg.tokenEndpoint.split('/')[4] : 'MISSING',
      !!cfg.authorizeUsesPiFlow
    );

    // Vercel / serverless: also store PKCE data in a signed cookie so the
    // callback can recover it if the in-memory session is on a different instance.
    setPkceCookie(res, { state, codeVerifier, redirectUri, nonce }, _isProd());

    // Explicitly save before redirecting — required with async stores (Redis/Upstash)
    // so the state/verifier are persisted before PingOne sends the callback.
    req.session.save((err) => {
      if (err) {
        console.error('[oauth] Session save error before redirect:', err);
        return res.status(500).json({ error: 'Failed to initiate OAuth login' });
      }
      res.redirect(authUrl);
    });
  } catch (error) {
    console.error('OAuth login error:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth login' });
  }
});

/**
 * OAuth callback handler
 * Receives authorization code from PingOne Core and exchanges it for tokens
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Validate the request origin matches our expected deployment (defence-in-depth)
    const isProdDeployment = process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT;
    if (isProdDeployment) {
      const referer = req.get('referer') || req.get('origin') || '';
      const expectedOrigin = getExpectedFrontendOrigin();
      if (referer && !referer.startsWith(expectedOrigin) && !referer.startsWith('https://auth.pingone')) {
        console.warn('[oauth/callback] Unexpected referer:', referer, '— expected:', expectedOrigin);
        // Log but don't block — PingOne already validates; this is observability only
        // If you want to harden further, change the console.warn to a return res.redirect error
      }
    }

    // Check for OAuth errors
    if (error) {
      console.error('OAuth error:', error);
      logAppEvent('oauth', 'error', `OAuth callback error from PingOne: ${error}`,
        { tag: 'oauth/callback-error', metadata: { oauthError: error } });
      // Self-heal: if PingOne rejected the redirect_uri, patch it before next attempt.
      const errorDesc = String(req.query.error_description || '').toLowerCase();
      if (errorDesc.includes('redirect') || error === 'access_denied' || error === 'invalid_request') {
        const { ensureAllRedirectUris } = require('../services/pingoneAppConfigService');
        ensureAllRedirectUris().catch(function (e) {
          console.warn('[redirect-uri-guard] admin recovery attempt failed:', e.message);
        });
      }
      return res.redirect(`${getFrontendOrigin()}/login?error=oauth_error`);
    }

    // Validate state — prefer session, fall back to PKCE cookie (Vercel serverless)
    const pkceCookie = readPkceCookie(req);
    const sessionState = req.session.oauthState;
    const resolvedState = sessionState || pkceCookie?.state;

    if (!state || state !== resolvedState) {
      console.error('[oauth/callback] Invalid state parameter. session:', sessionState, 'cookie:', pkceCookie?.state, 'received:', state);
      logAppEvent('oauth', 'warning', 'OAuth state mismatch — possible multi-tab race or CSRF attempt',
        { tag: 'oauth/state-mismatch', metadata: { sessionStatePresent: !!sessionState, cookieStatePresent: !!pkceCookie?.state } });
      clearPkceCookie(res, _isProd());
      // Auto-retry login instead of showing error (multi-tab race)
      console.log('[oauth/callback] Auto-retrying login after invalid_state (multi-tab race)');
      return res.redirect(`${req.baseUrl}/login`);
    }

    // Clear state, code_verifier and redirect URI from session and cookie
    const codeVerifier = req.session.oauthCodeVerifier || pkceCookie?.codeVerifier;
    const redirectUri   = req.session.oauthRedirectUri  || pkceCookie?.redirectUri;
    const expectedNonce = req.session.oauthNonce         || pkceCookie?.nonce;
    console.log('[oauth/callback] Retrieved redirect_uri for token exchange:', {
      redirectUri,
      fromSession: req.session.oauthRedirectUri,
      fromCookie: pkceCookie?.redirectUri,
      sessionId: req.sessionID?.slice(0, 8) + '...',
      code: code?.slice(0, 8) + '...',
    });
    
    // Get RFC 9728 resources from session
    const sessionResources = req.session.oauthResources || [];
    delete req.session.oauthState;
    delete req.session.oauthCodeVerifier;
    delete req.session.oauthRedirectUri;
    delete req.session.oauthNonce;
    delete req.session.oauthResources;
    clearPkceCookie(res, _isProd());

    // Exchange authorization code for access token (with PKCE verifier and resource indicators)
    console.log('[oauth/callback] Calling exchangeCodeForToken with:', {
      redirectUri,
      code: code?.slice(0, 8) + '...',
      codeVerifier: codeVerifier?.slice(0, 8) + '...',
      resources: sessionResources,
      configuredAdminRedirectUri: configStore.getEffective('admin_redirect_uri'),
      tokenEndpoint: configStore.getEffective('PINGONE_TOKEN_ENDPOINT'),
      oauthServiceConfig: {
        clientId: oauthService.config?.clientId?.slice(0, 8) + '...',
        tokenEndpoint: oauthService.config?.tokenEndpoint?.split('?')[0],
      },
    });
    const tokenData = await oauthService.exchangeCodeForToken(code, codeVerifier, redirectUri, sessionResources);
    archEmit({ nodeId: 'n-bff', edgeId: 'e-browser-bff', label: 'OAuth callback: code exchange complete' });

    // Verify nonce in ID token to prevent ID token replay attacks (OIDC Core §3.1.2.7)
    if (expectedNonce && tokenData.id_token) {
      try {
        const idPayload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64url').toString());
        if (!idPayload.nonce) {
          console.warn('[oauth/callback] ID token has no nonce claim');
        } else if (idPayload.nonce !== expectedNonce) {
          console.error('[oauth/callback] Nonce mismatch — possible ID token replay attack');
          logAppEvent('oauth', 'error', 'OAuth nonce mismatch — possible ID token replay attack',
            { tag: 'oauth/nonce-mismatch' });
          return res.redirect(`${getFrontendOrigin()}/login?error=nonce_mismatch`);
        }
      } catch (e) {
        console.warn('[oauth/callback] Could not decode ID token for nonce verification:', e.message);
      }
    }
    const userInfo = await oauthService.getUserInfo(tokenData.access_token);
    
    // Create user object from OAuth data
    const oauthUser = oauthService.createUserFromOAuth(userInfo);
    
    // Check if user already exists in our system
    let user = dataStore.getUserByUsername(oauthUser.username);
    
    if (!user) {
      // For OAuth users, we'll create them as admin by default
      // In production, you might want to check a whitelist or specific PingOne Core attributes
      oauthUser.role = 'admin'; // Make OAuth users admin by default
    } else {
      // This flow is the Admin PingOne app only — always grant admin in the demo store so
      // users who previously signed in as Customer can switch to Admin without staying "customer".
      // Do not downgrade an existing admin.
      oauthUser.role = 'admin';
    }
    
    if (!user) {
      // Create new user from OAuth data
      user = await dataStore.createUser({
        ...oauthUser,
        password: null // OAuth users don't have passwords
      });
    } else {
      // Preserve stored profile fields if userinfo omits them (PingOne may drop given_name/family_name on some flows)
      user = await dataStore.updateUser(user.id, {
        ...(oauthUser.email ? { email: oauthUser.email } : {}),
        ...(oauthUser.firstName ? { firstName: oauthUser.firstName } : {}),
        ...(oauthUser.lastName ? { lastName: oauthUser.lastName } : {}),
        role: oauthUser.role,
        oauthProvider: oauthUser.oauthProvider,
        oauthId: oauthUser.oauthId
      });
    }

    // Regenerate session ID before storing OAuth tokens to prevent session fixation.
    // Pre-capture the data we need to store, then assign after regeneration.
    if (!tokenData.refresh_token) {
      console.warn(
        '[oauth/callback] No refresh_token in token response — enable offline_access on the PingOne '
        + 'admin app and authorized scopes. Admin session renewal will fail until sign-in again.'
      );
    }
    const oauthTokens = {
      accessToken: tokenData.access_token,
      idToken: tokenData.id_token || null,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      tokenType: tokenData.token_type || 'Bearer',
      scope: tokenData.scope || null,
    };
    const clientType = determineClientType(tokenData.access_token);
    const authedUser = user;
    const redirectOrigin = getFrontendOrigin();
    // Capture BEFORE regenerate — regenerate() wipes the session, so reading
    // this afterwards always lost the /login route's return_to and every admin
    // login landed on /admin. Mirrors the end-user callback (oauthUser.js).
    const postLoginReturnToPath = sanitizePostLoginReturnPath(req.session.postLoginReturnToPath) || null;

    // P3 — Session regenerate failure is now fatal (prevents session fixation).
    // If regenerate fails the user retries sign-in once; the UX cost is acceptable
    // compared to serving the pre-login session ID after authentication.
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error('[oauth/callback] Session regenerate FAILED — aborting login (session fixation risk):', regenErr.message);
        logAppEvent('oauth', 'error', 'OAuth session regeneration failed',
          { tag: 'oauth/session-regen-failed', metadata: { error: regenErr.message } });
        clearAuthCookie(res, _isProd());
        return res.redirect(`${redirectOrigin}/login?error=session_regenerate_failed`);
      }
      req.session.oauthTokens = oauthTokens;
      req.session.user = authedUser;
      req.session.clientType = clientType;
      archEmit({ nodeId: 'n-pingone', edgeId: 'e-bff-pingone', label: 'PingOne issued access + ID token' });

      // Record initial auth token into token chain so /api/token-chain/current reflects login
      if (oauthTokens.accessToken && authedUser?.id) {
        // Use decoded.sub as userId key — must match req.user.id set by authenticateToken middleware
        const _tcClaims = (() => { try { return require('jsonwebtoken').decode(oauthTokens.accessToken) || {}; } catch { return {}; } })();
        const _tcUserId = _tcClaims.sub || authedUser.id;
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
          description: 'OAuth Access Token'
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
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[oauth/callback] Session save FAILED — aborting admin login:', saveErr.message);
          return req.session.destroy((destroyErr) => {
            if (destroyErr) {
              console.error('[oauth/callback] session.destroy after failed save:', destroyErr.message);
            }
            clearAuthCookie(res, _isProd());
            return res.redirect(`${redirectOrigin}/login?error=session_persist_failed`);
          });
        }
        console.debug('[oauth/callback] Session saved OK sid=' + (req.session?.id || '').slice(0, 8) + '…');
        const _idTokenDecoded = decodeJwt(oauthTokens?.idToken);
        logAppEvent('oauth', 'info', `OAuth admin login success: ${authedUser?.username || authedUser?.email || 'unknown'}`,
          { tag: 'oauth/callback-success', username: authedUser?.username,
            metadata: { role: authedUser?.role, clientType, hasIdToken: !!(oauthTokens?.idToken), jwtFullDecode: _idTokenDecoded || undefined, response: { hasAccessToken: !!(oauthTokens?.accessToken), hasIdToken: !!(oauthTokens?.idToken), tokenType: oauthTokens?.tokenType || 'Bearer' }, pkce: { code_challenge_method: 'S256', code_challenge_length: codeVerifier ? String(codeVerifier).length : 0 }, idTokenClaims: { sub: _idTokenDecoded?.claims?.sub || undefined, email: _idTokenDecoded?.claims?.email || undefined, acr: _idTokenDecoded?.claims?.acr || undefined } } });
        const _sessionHash = crypto.createHash('sha256').update(req.session.id || '').digest('hex').slice(0, 8);
        logAppEvent('auth_lifecycle', 'info', 'Session snapshot: admin login', {
          tag: 'auth_lifecycle/session-snapshot',
          metadata: { sessionId_hash: _sessionHash, event: 'login', role: authedUser?.role, hasAccessToken: !!(req.session.oauthTokens?.accessToken || oauthTokens?.accessToken), hasIdToken: !!(req.session.oauthTokens?.idToken || oauthTokens?.idToken), hasRefreshToken: !!(req.session.oauthTokens?.refreshToken) },
        });
        // Set a signed auth-state cookie so the session-restore middleware can
        // answer /status and /nl requests even when the session hits a different
        // serverless instance on Vercel.
        setAuthCookie(res, {
          ...authedUser,
          oauthType: 'admin',
          expiresAt: oauthTokens.expiresAt,
          idToken:   oauthTokens.idToken || null,
        }, _isProd());
        // Analytics is best-effort and MUST NOT abort a successful login. A throw
        // here (e.g. posthog rejecting an undefined distinctId) would propagate
        // into the session store's set() and be misreported as a save failure,
        // destroying the just-saved session. Keep it isolated.
        try {
          posthog.identify({
            distinctId: authedUser.id,
            properties: {
              $set: { email: authedUser.email, username: authedUser.username, role: authedUser.role },
            },
          });
          posthog.capture({
            distinctId: authedUser.id,
            event: 'oauth_login_completed',
            properties: { auth_method: 'pingone_oauth', role: authedUser.role, client_type: clientType },
          });
        } catch (analyticsErr) {
          console.warn('[oauth/callback] analytics (posthog) failed — login unaffected:', analyticsErr.message);
        }
        // Clear role-switch cookie if this login was triggered by POST /api/auth/switch
        res.clearCookie('_switch_target', { path: '/', sameSite: _isProd() ? 'none' : 'lax', secure: _isProd() });
        const postLoginPath = postLoginReturnToPath || '/admin';
        res.redirect(`${redirectOrigin}${postLoginPath}?oauth=success`);
      });
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    const detail = error.pingoneError || 'unknown';
    const desc   = error.pingoneDesc   || '';
    const query  = desc
      ? `error=callback_failed&detail=${encodeURIComponent(detail)}&info=${encodeURIComponent(desc)}`
      : `error=callback_failed&detail=${encodeURIComponent(detail)}`;
    res.redirect(`${getFrontendOrigin()}/login?${query}`);
  }
});

/**
 * Logout - clear local session and end PingOne SSO session
 */
router.get('/logout', async (req, res) => {
  const idToken      = req.session.oauthTokens?.idToken      || null;
  const accessToken  = req.session.oauthTokens?.accessToken  || null;
  const refreshToken = req.session.oauthTokens?.refreshToken || null;
  const postLogoutUri = `${getFrontendOrigin()}/logout`;
  const logoutUserId = req.session.user?.id;
  const pingOneUserId = req.session.user?.oauthId || req.session.user?.id || null;

  // RFC 7009 — revoke tokens before destroying the session (best-effort, non-fatal)
  if (accessToken  && accessToken  !== '_cookie_session') oauthService.revokeToken(accessToken,  'access_token');
  if (refreshToken && refreshToken !== '_cookie_session') oauthService.revokeToken(refreshToken, 'refresh_token');

  // Terminate PingOne SSO sessions so the user cannot silently re-authenticate
  try {
    await terminateAllUserSessions(pingOneUserId);
  } catch (_) { /* non-fatal — token revocation + signoff redirect still cover logout */ }

  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }
    if (logoutUserId) {
      posthog.capture({ distinctId: logoutUserId, event: 'user_logged_out' });
    }
    logAppEvent('auth_lifecycle', 'info', 'Session snapshot: admin logout', {
      tag: 'auth_lifecycle/session-snapshot',
      metadata: { event: 'logout', role: null, hasAccessToken: false, hasIdToken: false, hasRefreshToken: false },
    });

    clearAllAuthCookies(res, _isProd());

    res.redirect(buildPingOneSignoffUrl(postLogoutUri, 'pingone_admin_client_id', idToken));
  });
});

/**
 * Get current OAuth session status
 */
router.get('/status', (req, res) => {
  const token = req.session.oauthTokens?.accessToken;
  const hasOAuthToken = !!(token && token !== '_cookie_session');
  // Check expiry — expired token → authenticated: false so callers don't attempt
  // protected API routes and enter a 401 redirect loop.
  const expiresAt = req.session.oauthTokens?.expiresAt;
  const tokenNotExpired = !expiresAt || Date.now() < expiresAt;
  const isAuthenticated = !!(req.session.user && hasOAuthToken && tokenNotExpired);
  
  res.json({
    authenticated: isAuthenticated,
    user: isAuthenticated ? {
      id: req.session.user.id,
      username: req.session.user.username,
      email: req.session.user.email,
      firstName: req.session.user.firstName,
      lastName: req.session.user.lastName,
      role: req.session.user.role
    } : null,
    oauthProvider: isAuthenticated ? req.session.user.oauthProvider : null,
    // accessToken intentionally omitted — token stays on the backend (Backend-for-Frontend (BFF) pattern)
    tokenType: isAuthenticated ? req.session.oauthTokens.tokenType : null,
    expiresAt: isAuthenticated ? req.session.oauthTokens.expiresAt : null,
    clientType: isAuthenticated ? req.session.clientType : null
  });
});

/**
 * GET /api/auth/oauth/token-claims
 * Returns decoded JWT claims from the session access token (for demo/educational display).
 * The raw token is never sent to the browser — only the decoded header + payload.
 */
router.get('/token-claims', (req, res) => {
  const tokens = req.session?.oauthTokens;
  const user   = req.session?.user;
  if (!user || !tokens?.accessToken || tokens.accessToken === '_cookie_session') {
    return res.json({ authenticated: false });
  }
  try {
    const parts = tokens.accessToken.split('.');
    if (parts.length !== 3) return res.json({ authenticated: true, decoded: null });
    const header  = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return res.json({
      authenticated: true,
      sessionType: req.session.oauthType || 'unknown',
      clientType:  req.session.clientType || null,
      tokenType:   tokens.tokenType || 'Bearer',
      expiresAt:   tokens.expiresAt || null,
      hasRefreshToken: !!tokens.refreshToken,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
      decoded: { header, payload },
    });
  } catch {
    return res.json({ authenticated: true, decoded: null });
  }
});

/**
 * RFC 6749 §6 — Refresh the admin OAuth access token using the stored refresh token.
 * Called by the frontend or auto-refresh middleware when the access token is near expiry.
 */
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.session.oauthTokens?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'no_refresh_token', message: 'No refresh token in session' });
    }

    const tokenData = await oauthService.refreshAccessToken(refreshToken);
    
    // Update session with new tokens (refresh token rotation per RFC 6749 best practices)
    req.session.oauthTokens = {
      ...req.session.oauthTokens,
      accessToken:  tokenData.access_token,
      refreshToken: tokenData.refresh_token || req.session.oauthTokens.refreshToken,
      idToken:      tokenData.id_token      || req.session.oauthTokens.idToken,
      expiresAt:    Date.now() + ((tokenData.expires_in || 3600) * 1000),
      tokenType:    tokenData.token_type    || 'Bearer',
    };

    // Await session persistence before responding — prevents race condition where
    // the client believes the refresh succeeded but the token never persists to
    // the session store (e.g. Redis timeout on a different Lambda/instance).
    return req.session.save((err) => {
      if (err) {
        console.error('[admin refresh] Session save error:', err);
        return res.status(500).json({ error: 'session_persist_failed', message: 'Token refreshed but session save failed. Please retry.' });
      }
      return res.json({ success: true, expiresAt: req.session.oauthTokens.expiresAt });
    });
  } catch (err) {
    console.error('[admin refresh] Token refresh failed:', err.message);
    return res.status(401).json({ error: 'refresh_failed', message: err.message });
  }
});

module.exports = router;
