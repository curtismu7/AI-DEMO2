const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const oauthService = require('../services/oauthUserService');
const { fetchPingOneUserById } = require('../services/pingOneUserLookupService');
const mfaService = require('../services/mfaService');
const oauthUserConfig = require('../config/oauthUser');
const configStore = require('../services/configStore');
const dataStore = require('../data/store');
const { determineClientType } = require('../middleware/auth');
const { getFrontendOrigin, getUserRedirectUri, validateRedirectUriOrigin, getExpectedFrontendOrigin } = require('../services/oauthRedirectUris');
const { setPkceCookie, readPkceCookie, clearPkceCookie } = require('../services/pkceStateCookie');
const { setAuthCookie, clearAuthCookie } = require('../services/authStateCookie');
const { clearAllAuthCookies, buildPingOneSignoffUrl } = require('../services/sessionCookies');
const { buildPingOneAuthorizeResourceQueryParam } = require('../utils/oauthAuthorizeResource');
const { getRoleFromClaims } = require('../services/roleClaimResolver');
const appEventService = require('../services/appEventService');
const tokenIntrospectionService = require('../services/tokenIntrospectionService');
const { terminateAllUserSessions } = require('../services/pingOneSessionService');
const demoScenarioStore = require('../services/demoScenarioStore');
const { verticalManifest } = require('../services/verticalManifest');

const STEP_UP_TTL_MS = 5 * 60 * 1000; // 5 min step-up validity

const _isProd = () => !!(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === 'production');

/**
 * Same-origin SPA path only — used after customer OAuth to return to landing page instead of /dashboard.
 * @param {unknown} raw
 * @returns {string|null}
 */
function sanitizePostLoginReturnPath(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t.startsWith('/') || t.startsWith('//') || t.length > 160) return null;
  if (!/^[/a-zA-Z0-9._~-]+$/.test(t)) return null;
  return t;
}

/**
 * After end-user OAuth failure, redirect to an SPA path where App still mounts BankingAgent
 * (`/`). `/login` is not in that set — users lose FAB + dock there.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Record<string, string>} params query keys (values truncated)
 * @param {string|null} [pathOverride] e.g. postLoginReturnToPath
 */
function redirectEndUserOAuthSpaFailure(req, res, params, pathOverride) {
  const origin = getFrontendOrigin();
  const path =
    typeof pathOverride === 'string' && pathOverride.startsWith('/')
      ? pathOverride
      : (sanitizePostLoginReturnPath(req.session?.postLoginReturnToPath) || '/');
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    const s = String(v);
    if (!s) continue;
    q.set(k, s.length > 400 ? s.slice(0, 400) : s);
  }
  res.redirect(`${origin}${path}?${q.toString()}`);
}

/**
 * Create sample accounts and transactions for new customers
 */
async function createSampleDataForCustomer(userId, firstName, lastName) {
  try {
    const result = await dataStore.seedAccountsForUser(userId);
    console.debug(`Created sample data for customer ${firstName} ${lastName} (vertical: ${result.vertical})`);
    return result;
  } catch (error) {
    console.error('Error creating sample data for customer:', error);
    throw error;
  }
}

/**
 * Reseed a customer's accounts if they don't match the active vertical.
 * Called on every login so switching verticals between sessions is reflected immediately.
 */
async function reseedIfVerticalMismatch(userId, firstName, lastName) {
  const activeVertical = configStore.getEffective('active_vertical') || 'banking';
  // Primary accountType derived from active vertical's manifest
  // (was hardcoded VERTICAL_PRIMARY_TYPE map; now read from manifest.terminology.accountTypes[0]).
  const activeManifestEntry = verticalManifest.loader.get(activeVertical);
  const expectedType = activeManifestEntry?.manifest?.terminology?.accountTypes?.[0];
  const existing = dataStore.getAccountsByUserId(userId);

  if (existing.length === 0) {
    return createSampleDataForCustomer(userId, firstName, lastName);
  }

  // Case-insensitive: provisionDemoAccounts writes lowercase; seed files use uppercase.
  const primaryType = (existing[0]?.accountType || '').toLowerCase();
  const expectedLower = (expectedType || '').toLowerCase();
  if (expectedLower && primaryType !== expectedLower) {
    console.debug(`[reseed] User ${userId} has "${existing[0]?.accountType}" accounts but vertical is "${activeVertical}" — reseeding`);
    // Wipe this user's accounts/transactions from the Maps directly,
    // then persist so in-memory and disk stay in sync before re-seeding.
    const acctIds = new Set();
    for (const [id, acct] of dataStore.accounts) {
      if (acct.userId === userId) { acctIds.add(id); dataStore.accounts.delete(id); }
    }
    for (const [id, tx] of dataStore.transactions) {
      if (tx.userId === userId || acctIds.has(tx.fromAccountId) || acctIds.has(tx.toAccountId)) {
        dataStore.transactions.delete(id);
      }
    }
    await dataStore.persistAllData();
    const result = await createSampleDataForCustomer(userId, firstName, lastName);
    // Update the KV snapshot so Vercel cold-start restore returns correct-vertical accounts.
    const freshAccounts = dataStore.getAccountsByUserId(userId);
    const snap = freshAccounts.map(a => ({
      id: a.id, accountType: a.accountType, accountNumber: a.accountNumber,
      name: a.name || '', balance: a.balance, currency: a.currency || 'USD', isActive: true,
    }));
    await demoScenarioStore.save(userId, { accountSnapshot: snap });
    return result;
  }
}

/**
 * Initiate OAuth login for end users
 */
router.get('/login', (req, res) => {
  try {
    const _mask = (v, n) => v ? v.slice(0, n) + '...' : 'MISSING';
    console.log('[oauth/user/login] env_id=%s  user_client_id=%s  user_secret=%s  authorize_pi.flow=%s',
      _mask(configStore.getEffective('pingone_environment_id'), 8),
      _mask(configStore.getEffective('user_client_id'), 8),
      _mask(configStore.getEffective('user_client_secret'), 4),
      !!oauthUserConfig.authorizeUsesPiFlow
    );

    // Guard: end-user flow needs user client + env (not admin_client_id)
    if (!configStore.isUserOAuthConfigured()) {
      return res.redirect(`${getFrontendOrigin()}/config?error=not_configured`);
    }

    const forceLogin = req.query.force === 'true';

    if (!forceLogin) {
      // Check if user already has an active session
      const token = req.session.oauthTokens?.accessToken;
      const hasOAuthToken = !!(token && token !== '_cookie_session');
      const expiresAt = req.session.oauthTokens?.expiresAt;
      const tokenNotExpired = !expiresAt || Date.now() < expiresAt;
      const isUserAuthenticated = !!(req.session.user && hasOAuthToken && tokenNotExpired && req.session.oauthType === 'user');

      if (isUserAuthenticated) {
        // User already has an active session — honour return_to (e.g. /) instead of always going to /dashboard
        const returnPath = sanitizePostLoginReturnPath(req.query.return_to) || '/dashboard';
        console.log('[oauth/user/login] User already authenticated, redirecting to:', returnPath, req.session.user.email);
        return res.redirect(`${getFrontendOrigin()}${returnPath}`);
      }
    } else {
      // Force re-authentication: clear existing tokens so the callback treats this as a fresh login
      console.log('[oauth/user/login] Force login requested — clearing existing session tokens');
      appEventService.logEvent('auth_lifecycle', 'warn', 'HITL force re-authentication: session cleared, prompt=login → PingOne', { tag: 'oauth/user/login/force' });
      delete req.session.oauthTokens;
      delete req.session.user;
      delete req.session.clientType;
      delete req.session.oauthType;
      clearAuthCookie(res, _isProd());
    }

    // Drop any prior admin session so Customer sign-in starts fresh.
    const isAdminSession = req.session?.oauthType === 'admin' || req.session?.user?.role === 'admin';
    if (isAdminSession) {
      delete req.session.oauthTokens;
      delete req.session.user;
      delete req.session.clientType;
      delete req.session.oauthType;
      // Also clear the _auth cookie so the session-restore middleware cannot
      // resurrect the admin identity on a different Vercel instance.
      clearAuthCookie(res, _isProd());
    }

    // Only set the return path when this request carries one. Do NOT delete an
    // already-stored path when return_to is absent: a single login can re-enter
    // this route mid-handshake without the param (e.g. a PingOne-side bounce, or
    // a silent vertical-switch reauth), and wiping it here drops the user onto
    // the /dashboard fallback instead of where they were (e.g. /). regenerate()
    // in the callback clears it per-login, so a stale value cannot leak across logins.
    const returnPath = sanitizePostLoginReturnPath(req.query.return_to);
    if (returnPath) {
      req.session.postLoginReturnToPath = returnPath;
    }

    // Per D-01: store pending agent intent so server can validate client replay after OAuth callback.
    // Primary replay mechanism is BX_AGENT_PENDING_NL_KEY in client sessionStorage.
    // BFF session copy is secondary — used for server-side validation only.
    if (req.query.pendingMessage) {
      const _pendingMsg = typeof req.query.pendingMessage === 'string'
        ? req.query.pendingMessage.slice(0, 2048)
        : null;
      if (_pendingMsg) {
        req.session.pendingAgentIntent = { message: _pendingMsg, timestamp: Date.now() };
      }
    }

    const state = oauthService.generateState();
    const codeVerifier = oauthService.generateCodeVerifier();
    const redirectUri = getUserRedirectUri(req);

    // Validate redirect_uri domain matches the expected deployment origin
    const uriCheck = validateRedirectUriOrigin(redirectUri);
    if (!uriCheck.ok) {
      console.warn('[oauth/user] Redirect URI rejected:', uriCheck.reason, redirectUri);
      return res.status(400).json({ error: 'invalid_redirect_uri', message: uriCheck.reason });
    }

    const resourceParam = buildPingOneAuthorizeResourceQueryParam(
      process.env.ENDUSER_AUDIENCE,
      oauthUserConfig.scopes,
    );

    // Generate a nonce for OIDC replay protection (RFC 6749 / OIDC Core §3.1.2.1)
    const nonce = crypto.randomBytes(16).toString('hex');
    const url =
      oauthService.generateAuthorizationUrl({
        state,
        codeVerifier,
        redirectUri,
        nonce,
      }) + resourceParam;

    // Store state, verifier and redirect URI in session for CSRF protection and PKCE
    req.session.oauthState = state;
    req.session.oauthCodeVerifier = codeVerifier;
    req.session.oauthRedirectUri = redirectUri;
    req.session.oauthNonce = nonce;
    req.session.oauthType = 'user'; // Distinguish from admin OAuth

    // Vercel / serverless: also persist PKCE data in a signed cookie so the
    // callback can recover it when the in-memory session is on a different instance.
    setPkceCookie(res, { state, codeVerifier, redirectUri, nonce }, _isProd());

    // Persist PKCE state before redirecting so the callback can validate.
    // Non-fatal: state/verifier are already in the signed PKCE cookie (setPkceCookie above),
    // so the callback can recover even when the Redis session write fails (Vercel cold start).
    req.session.oauthLoginStartedAt = Date.now();
    req.session.save((err) => {
      if (err) {
        console.warn('[oauth/user] Session save failed before PingOne redirect (PKCE cookie is fallback):', err.message);
      }
      console.log('Redirecting end user to PingOne SSO:', url);
      appEventService.logEvent('oauth', 'info', 'Redirecting → PingOne Authorization', { tag: 'oauth/user/login', redirect_uri: redirectUri });
      res.redirect(url);
    });
  } catch (error) {
    console.error('OAuth login error:', error);
    redirectEndUserOAuthSpaFailure(req, res, { error: 'oauth_init_failed' });
  }
});

/**
 * Silent re-authentication via prompt=none (OIDC §3.1.2.1).
 *
 * Initiates a PKCE Authorization Code flow with `prompt=none`. If the user
 * still has an active PingOne SSO session, PingOne returns a fresh code
 * immediately and the normal /callback flow issues new tokens without a
 * credential prompt. If PingOne has no session it returns `error=login_required`,
 * and the callback redirects the SPA to `return_to?silent_reauth_failed=1`
 * so the StaleSessionBanner can surface the manual "Sign in again" button.
 *
 * Usage: the browser navigates here (full redirect) with an optional
 * `return_to` path that the SPA should land on after success or failure.
 */
router.get('/silent-reauth', (req, res) => {
  try {
    if (!configStore.isUserOAuthConfigured()) {
      return res.redirect(`${getFrontendOrigin()}/config?error=not_configured`);
    }

    // Do not attempt silent reauth when we already have a valid token.
    const token = req.session.oauthTokens?.accessToken;
    const hasOAuthToken = !!(token && token !== '_cookie_session');
    const expiresAt = req.session.oauthTokens?.expiresAt;
    const tokenNotExpired = !expiresAt || Date.now() < expiresAt;
    if (req.session.user && hasOAuthToken && tokenNotExpired && req.session.oauthType === 'user') {
      const returnPath = sanitizePostLoginReturnPath(req.query.return_to) || '/dashboard';
      return res.redirect(`${getFrontendOrigin()}${returnPath}`);
    }

    const returnPath = sanitizePostLoginReturnPath(req.query.return_to) || '/dashboard';
    req.session.postLoginReturnToPath = returnPath;
    req.session.silentReauth = true; // callback uses this to suppress full-error pages on login_required

    const state = oauthService.generateState();
    const codeVerifier = oauthService.generateCodeVerifier();
    const redirectUri = getUserRedirectUri(req);
    const nonce = crypto.randomBytes(16).toString('hex');

    const resourceParam = buildPingOneAuthorizeResourceQueryParam(
      process.env.ENDUSER_AUDIENCE,
      oauthUserConfig.scopes,
    );

    const url = oauthService.generateAuthorizationUrl({
      state,
      codeVerifier,
      redirectUri,
      nonce,
      prompt: 'none',
    }) + resourceParam;

    req.session.oauthState = state;
    req.session.oauthCodeVerifier = codeVerifier;
    req.session.oauthRedirectUri = redirectUri;
    req.session.oauthNonce = nonce;
    req.session.oauthType = 'user';
    req.session.oauthLoginStartedAt = Date.now();
    setPkceCookie(res, { state, codeVerifier, redirectUri, nonce }, _isProd());

    req.session.save((err) => {
      if (err) {
        console.warn('[oauth/user/silent-reauth] Session save failed (PKCE cookie is fallback):', err.message);
      }
      appEventService.logEvent('oauth', 'info', 'Silent reauth → PingOne (prompt=none)', { tag: 'oauth/user/silent-reauth' });
      res.redirect(url);
    });
  } catch (error) {
    console.error('[oauth/user/silent-reauth] Error:', error.message);
    redirectEndUserOAuthSpaFailure(req, res, { error: 'silent_reauth_init_failed' });
  }
});

/**
 * Handle OAuth callback for end users
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Validate the request origin matches our expected deployment (defence-in-depth)
    const isProdDeployment = process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT;
    if (isProdDeployment) {
      const referer = req.get('referer') || req.get('origin') || '';
      const expectedOrigin = getExpectedFrontendOrigin(req);
      if (referer && !referer.startsWith(expectedOrigin) && !referer.startsWith('https://auth.pingone')) {
        console.warn('[oauth/user/callback] Unexpected referer:', referer, '— expected:', expectedOrigin);
        // Log but don't block — PingOne already validates; this is observability only
        // If you want to harden further, change the console.warn to a return res.redirect error
      }
    }

    // Check for OAuth errors (PingOne sends error + optional error_description)
    if (error) {
      // login_required from a prompt=none silent-reauth attempt is expected when the
      // PingOne SSO session has expired. Redirect the SPA to its return path with a
      // flag so it can show the manual "Sign in again" button without an error page.
      const wasSilentReauth = req.session.silentReauth === true;
      delete req.session.silentReauth;
      if (wasSilentReauth && (error === 'login_required' || error === 'interaction_required')) {
        const returnPath = sanitizePostLoginReturnPath(req.session.postLoginReturnToPath) || '/dashboard';
        delete req.session.postLoginReturnToPath;
        clearPkceCookie(res, _isProd());
        appEventService.logEvent('auth_lifecycle', 'info', 'Silent reauth: PingOne SSO expired (login_required)', { tag: 'oauth/user/callback/silent' });
        return req.session.save(() =>
          res.redirect(`${getFrontendOrigin()}${returnPath}?silent_reauth_failed=1`)
        );
      }
      console.error('[oauth/user/callback] IdP error:', error, req.query.error_description || '');
      // If PingOne rejected the redirect_uri, fire the guard immediately so it
      // self-heals before the next login attempt — fire-and-forget, never blocks.
      const errorDesc = String(req.query.error_description || '').toLowerCase();
      if (errorDesc.includes('redirect') || error === 'access_denied' || error === 'invalid_request') {
        const { ensureAllRedirectUris } = require('../services/pingoneAppConfigService');
        ensureAllRedirectUris().catch(function (e) {
          console.warn('[redirect-uri-guard] recovery attempt failed:', e.message);
        });
      }
      return redirectEndUserOAuthSpaFailure(req, res, {
        error:           'oauth_provider',
        idp_error:       String(error).slice(0, 120),
        error_description: String(req.query.error_description || '').slice(0, 400),
      });
    }
    
    // Validate state — prefer session, fall back to PKCE cookie (Vercel serverless)
    const pkceCookie = readPkceCookie(req);
    const sessionState = req.session.oauthState;
    const resolvedState = sessionState || pkceCookie?.state;

    if (!state || state !== resolvedState) {
      console.error('[oauth/user/callback] Invalid state. session:', sessionState, 'cookie:', pkceCookie?.state, 'received:', state);
      clearPkceCookie(res, _isProd());
      // Instead of showing an error, auto-retry login — the user clearly intended to sign in.
      // This handles the multi-tab race where tab B's login overwrites tab A's PKCE state.
      console.log('[oauth/user/callback] Auto-retrying login after invalid_state (multi-tab race)');
      return res.redirect(`${req.baseUrl}/login`);
    }

    // Validate code parameter
    if (!code) {
      console.error('[oauth/user/callback] No authorization code (pi.flow may use a different callback shape than code flow)');
      clearPkceCookie(res, _isProd());
      return redirectEndUserOAuthSpaFailure(req, res, { error: 'no_code' });
    }

    // Retrieve and clear the PKCE code verifier and redirect URI from session / cookie
    const codeVerifier = req.session.oauthCodeVerifier || pkceCookie?.codeVerifier;
    const redirectUri   = req.session.oauthRedirectUri  || pkceCookie?.redirectUri;
    const expectedNonce = req.session.oauthNonce         || pkceCookie?.nonce;
    delete req.session.oauthCodeVerifier;
    delete req.session.oauthRedirectUri;
    delete req.session.oauthState;
    delete req.session.oauthNonce;
    clearPkceCookie(res, _isProd());

    // Exchange code for token (with PKCE verifier)
    const tokenData = await oauthService.exchangeCodeForToken(code, codeVerifier, redirectUri);
    console.debug('Token received for end user');
    appEventService.logEvent('token_exchange', 'info', 'OAuth token received ← PingOne', { tag: 'oauth/user/callback' });

    // Decode ID token claims — used for nonce verification and as a fallback for userinfo gaps.
    let idTokenClaims = {};
    if (tokenData.id_token) {
      try {
        idTokenClaims = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64url').toString());
      } catch (e) {
        console.warn('[oauth/user/callback] Could not decode ID token:', e.message);
      }
    }

    // Verify nonce in ID token to prevent ID token replay attacks (OIDC Core §3.1.2.7)
    if (expectedNonce && idTokenClaims.nonce) {
      if (idTokenClaims.nonce !== expectedNonce) {
        console.error('[oauth/user/callback] Nonce mismatch — possible ID token replay attack');
        return redirectEndUserOAuthSpaFailure(req, res, { error: 'nonce_mismatch' });
      }
    } else if (expectedNonce && tokenData.id_token && !idTokenClaims.nonce) {
      console.warn('[oauth/user/callback] ID token has no nonce claim');
    }

    // Get user information from PingOne Core
    const userInfo = await oauthService.getUserInfo(tokenData.access_token);

    // Merge ID token claims as fallback for any userinfo gaps (e.g. email not in userinfo response).
    // userinfo takes priority; idTokenClaims fills only missing fields.
    const mergedUserInfo = { ...idTokenClaims, ...userInfo };

    // Create user object from OAuth data
    const oauthUser = oauthService.createUserFromOAuth(mergedUserInfo);
    
    // Check if user already exists in our system
    let user = dataStore.getUserByUsername(oauthUser.username);
    
    // Resolve admin role using four signals (any one is sufficient):
    //  1. admin_username allowlist  — permanent override (demoAdmin, service accounts)
    //  2. PingOne population ID     — admin users live in a dedicated PingOne population
    //  3. PingOne custom claim      — attribute named by admin_role_claim matches admin_role value
    //  4. Existing dataStore record — preserve admin granted in a previous session
    const configuredAdminRole       = configStore.getEffective('admin_role') || 'admin';
    const configuredAdminUsernames  = (configStore.getEffective('admin_username') || '')
      .split(',').map(u => u.trim()).filter(Boolean);
    const configuredAdminPopulation = (configStore.getEffective('admin_population_id') || '').trim();
    const configuredRoleClaim       = (configStore.getEffective('admin_role_claim') || '').trim();

    // Signal 1: username allowlist — always wins, no PingOne attribute needed
    const usernameIsAdmin = configuredAdminUsernames.includes(oauthUser.username);

    // Signal 2: population — PingOne includes population.id in userinfo when mapped;
    // also check top-level populationId as some app configs surface it there.
    let populationIsAdmin = false;
    if (configuredAdminPopulation && !usernameIsAdmin) {
      const popId = mergedUserInfo?.population?.id || mergedUserInfo?.populationId || null;
      populationIsAdmin = popId === configuredAdminPopulation;
    }

    // Signal 3: custom claim — supports string or array (e.g. group membership list)
    let claimIsAdmin = false;
    if (configuredRoleClaim && !usernameIsAdmin && !populationIsAdmin) {
      const claimValue = mergedUserInfo[configuredRoleClaim];
      claimIsAdmin = Array.isArray(claimValue)
        ? claimValue.includes(configuredAdminRole)
        : claimValue === configuredAdminRole;
    }

    // Signal 5: roleClaimResolver — new oauth_role_claim_* config (any IDP)
    // Note: we do NOT preserve an existing store role — role must be earned from PingOne
    // signals each login to prevent stale admin entries persisting via the customer app.
    const resolvedRole    = getRoleFromClaims(mergedUserInfo);
    const resolverIsAdmin = resolvedRole === 'admin';

    if (usernameIsAdmin || populationIsAdmin || claimIsAdmin || resolverIsAdmin) {
      oauthUser.role = 'admin';
      console.log(`[oauth/user/callback] Granting admin to ${oauthUser.username} (allowlist=${usernameIsAdmin}, population=${populationIsAdmin}, claim[${configuredRoleClaim}]=${claimIsAdmin}, resolver=${resolverIsAdmin})`);
    } else {
      oauthUser.role = 'customer';
      console.log(`[oauth/user/callback] Granting customer role to ${oauthUser.username}`);
    }
    
    if (!user) {
      // Create new user from OAuth data
      user = await dataStore.createUser({
        ...oauthUser,
        password: null // OAuth users don't have passwords
      });

      if (user.role === 'customer') {
        try {
          await reseedIfVerticalMismatch(user.id, user.firstName, user.lastName);
        } catch (error) {
          console.error('Failed to create sample data for new customer:', error);
        }
      }
    } else {
      // Update existing user with OAuth data
      user = await dataStore.updateUser(user.id, {
        ...(oauthUser.email ? { email: oauthUser.email } : {}),
        ...(oauthUser.firstName ? { firstName: oauthUser.firstName } : {}),
        ...(oauthUser.lastName ? { lastName: oauthUser.lastName } : {}),
        role: oauthUser.role,
        oauthProvider: oauthUser.oauthProvider,
        oauthId: oauthUser.oauthId
      });

      // Reseed if the active vertical changed since last login
      if (user.role === 'customer') {
        try {
          await reseedIfVerticalMismatch(user.id, user.firstName, user.lastName);
        } catch (error) {
          console.error('Failed to reseed accounts on login:', error);
        }
      }
    }
    
    if (!tokenData.refresh_token) {
      console.warn(
        '[oauthUser/callback] No refresh_token in token response — enable offline_access on the PingOne '
        + 'user app and include offline_access in authorized scopes. Session renewal will fail until users sign in again.'
      );
    }
    // Pre-capture data before regenerating session to prevent session fixation
    const oauthTokens = {
      accessToken: tokenData.access_token,
      idToken: tokenData.id_token || null,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      tokenType: tokenData.token_type || 'Bearer',
      scope: tokenData.scope || null,
    };

    // Determine client type from the original OAuth token
    const clientType = determineClientType(tokenData.access_token);
    const authedUser = user;
    const origin = getFrontendOrigin();
    // Preserve step-up return destination across session regeneration
    const stepUpReturnTo = req.session.stepUpReturnTo || null;
    const postLoginReturnToPath = sanitizePostLoginReturnPath(req.session.postLoginReturnToPath) || null;

    // Detect silent SSO: if PingOne returned in < 2 s the user had an active session
    // and was not prompted for credentials. Pass sso_silent=1 to the SPA so it can
    // inform the user. Threshold is 2000 ms — normal credential entry takes 5–30 s.
    const loginStartedAt = req.session.oauthLoginStartedAt || null;
    const loginElapsedMs = loginStartedAt ? Date.now() - loginStartedAt : null;
    const silentSso = loginElapsedMs !== null && loginElapsedMs < 2000;

    // Decode access token to extract consent ACR and may_act for session storage.
    // These are used by the consent gate in agentMcpTokenService and the agent UI.
    let accessTokenAcr = null;
    let accessTokenMayAct = null;
    try {
      const parts = (tokenData.access_token || '').split('.');
      if (parts.length === 3) {
        const atClaims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        accessTokenAcr    = atClaims.acr    || idTokenClaims.acr    || null;
        accessTokenMayAct = atClaims.may_act || null;
      }
    } catch (_) { /* non-fatal — acr / may_act stay null */ }

    // Phase 266: cache subject sub so /internal/id-token can look up sessions by sub
    // without needing the session cookie. Smallest possible additive change — does not
    // affect any existing behavior.
    oauthTokens.subjectSub = idTokenClaims.sub || null;

    console.log('End user OAuth login successful for:', authedUser.username);
    appEventService.logEvent('auth_lifecycle', 'info', `User authenticated: ${authedUser.username}`, { tag: 'oauth/user/callback', username: authedUser.username });

    // Regenerate session before storing credentials to prevent session fixation.
    // P3 — failure is now fatal (abort login) to eliminate the session fixation risk.
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error('[oauth/user/callback] Session regenerate FAILED — aborting login:', regenErr.message);
        clearAuthCookie(res, _isProd());
        return redirectEndUserOAuthSpaFailure(
          req,
          res,
          { error: 'session_regenerate_failed' },
          postLoginReturnToPath || '/'
        );
      }

      req.session.oauthTokens = oauthTokens;
      req.session.user = authedUser;
      req.session.clientType = clientType;
      req.session.oauthType = 'user';
      // D-01: clear pending agent intent — client handles replay via sessionStorage (BX_AGENT_PENDING_NL_KEY)
      delete req.session.pendingAgentIntent;

      console.log('[oauth/user/callback] tokens stored — access_token=%s id_token=%s refresh_token=%s sid=%s',
        oauthTokens.accessToken  ? 'PRESENT' : 'MISSING',
        oauthTokens.idToken      ? 'PRESENT' : 'MISSING',
        oauthTokens.refreshToken ? 'PRESENT' : 'MISSING',
        (req.sessionID || '').slice(0, 8) + '…'
      );

      // Consent gate: store ACR and may_act from the user access token so the
      // MCP token-exchange guard can check them without re-decoding the JWT.
      req.session.consentAcr = accessTokenAcr;
      req.session.mayAct     = accessTokenMayAct;
      if (stepUpReturnTo) {
        req.session.stepUpReturnTo = stepUpReturnTo;
      }

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[oauth/user/callback] Session save FAILED — aborting login (no _auth cookie):', saveErr.message);
          return req.session.destroy((destroyErr) => {
            if (destroyErr) {
              console.error('[oauth/user/callback] session.destroy after failed save:', destroyErr.message);
            }
            clearAuthCookie(res, _isProd());
            return redirectEndUserOAuthSpaFailure(
              req,
              res,
              { error: 'session_persist_failed' },
              postLoginReturnToPath || '/'
            );
          });
        }
        console.log('[oauth/user/callback] Session saved OK sid=' + (req.session?.id || '').slice(0, 8) + '…');

        // RFC 7662 — introspect at login so /api/tokens/session-preview shows
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
            req.session.save((e) => { if (e) console.warn('[oauth/user/callback] loginIntrospection session save:', e.message); });
          })
          .catch((err) => {
            console.debug('[oauth/user/callback] loginIntrospection skipped:', err.message);
          });

        // Set a signed auth-state cookie so the session-restore middleware can
        // answer /status and /nl requests even when the session hits a different
        // serverless instance on Vercel.
        setAuthCookie(res, {
          ...authedUser,
          oauthType: 'user',
          expiresAt: oauthTokens.expiresAt,
          idToken:   oauthTokens.idToken || null,
        }, _isProd());

        // Clear role-switch cookie if this login was triggered by POST /api/auth/switch
        res.clearCookie('_switch_target', { path: '/', sameSite: _isProd() ? 'none' : 'lax', secure: _isProd() });

        if (stepUpReturnTo) {
          return res.redirect(stepUpReturnTo);
        }

        const ssoParam = silentSso ? '&sso_silent=1' : '';
        if (postLoginReturnToPath) {
          res.redirect(`${origin}${postLoginReturnToPath}?oauth=success${ssoParam}`);
        } else {
          res.redirect(`${origin}/dashboard?oauth=success${ssoParam}`);
        }
      });
    });
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    const detail = error.pingoneError || 'unknown';
    const desc   = error.pingoneDesc   || '';
    redirectEndUserOAuthSpaFailure(req, res, {
      error:  'callback_failed',
      detail: String(detail).slice(0, 120),
      ...(desc ? { info: String(desc).slice(0, 400) } : {}),
    });
  }
});

/**
 * Step-up MFA: re-authenticate the current user with acr_values to satisfy
 * PingOne's MFA policy.  Called when the transaction server returns 428.
 *
 *   GET /api/auth/oauth/user/stepup?return_to=<url>
 *
 * After PingOne issues a fresh token with the MFA ACR, the normal /callback
 * flow redirects the browser back to `return_to` (defaults to /dashboard).
 */
router.get('/stepup', (req, res) => {
  try {
    // Honor empty STEP_UP_ACR_VALUE (blank = omit acr_values, rely on app's default sign-on policy).
    // `|| 'Multi_Factor'` would swallow '' (falsy) so we use an explicit undefined check instead.
    const acrValue = process.env.STEP_UP_ACR_VALUE !== undefined
      ? process.env.STEP_UP_ACR_VALUE.trim()
      : 'Multi_Factor';
    const returnTo = req.query.return_to || `${getFrontendOrigin()}/dashboard`;

    const state = oauthService.generateState();
    const codeVerifier = oauthService.generateCodeVerifier();
    const redirectUri = getUserRedirectUri(req);
    const nonce = crypto.randomBytes(16).toString('hex');
    const url = oauthService.generateAuthorizationUrl({
      state,
      codeVerifier,
      redirectUri,
      nonce,
      acr_values: acrValue,
      max_age: 0,
    });

    // Persist PKCE + state + redirect URI + where to go after MFA
    req.session.oauthState = state;
    req.session.oauthCodeVerifier = codeVerifier;
    req.session.oauthRedirectUri = redirectUri;
    req.session.oauthNonce = nonce;
    req.session.oauthType = 'user';
    req.session.stepUpReturnTo = `${returnTo}?stepup=done`;

    // Vercel / serverless: PKCE cookie fallback
    setPkceCookie(res, { state, codeVerifier, redirectUri, nonce }, _isProd());

    console.log(`[StepUp] Initiating MFA step-up with acr_values=${acrValue}`);
    req.session.save((err) => {
      if (err) {
        console.error('[StepUp] Session save error:', err);
        return res.redirect(`${getFrontendOrigin()}/dashboard?error=stepup_init_failed`);
      }
      res.redirect(url);
    });
  } catch (error) {
    console.error('[StepUp] Error initiating step-up:', error);
    res.redirect(`${getFrontendOrigin()}/dashboard?error=stepup_init_failed`);
  }
});

/**
 * Get current OAuth session status for end users
 */
router.get('/status', (req, res) => {
  const token = req.session.oauthTokens?.accessToken;
  const hasOAuthToken = !!(token && token !== '_cookie_session');
  // Check expiry so that an expired session token does not report authenticated:true
  // and then cause every downstream API call to return 401 (producing a redirect loop).
  // refreshIfExpiring middleware runs first; if refresh succeeded the token is already
  // updated in req.session before we get here, so this check is transparent for valid sessions.
  const expiresAt = req.session.oauthTokens?.expiresAt;
  const tokenNotExpired = !expiresAt || Date.now() < expiresAt;
  const isAuthenticated = !!(req.session.user && hasOAuthToken && tokenNotExpired && (req.session.oauthType === 'user' || req.session.oauthType === 'admin'));

  // Stale session: the user DID complete an OAuth login (session.user + oauthType
  // survive), but the tokens are gone or expired and could not be refreshed
  // (tokenRefresh.js deletes the refresh token on invalid_grant). Without this
  // flag the UI cannot distinguish "never logged in" from "sign-in went stale" —
  // generic reads keep working off the session record, so the dashboard looks
  // signed in while every agent/MCP call fails (2026-06-12 incident).
  const wasOAuthLogin = !!(req.session.user && (req.session.oauthType === 'user' || req.session.oauthType === 'admin'));
  const staleSession = wasOAuthLogin && !isAuthenticated;
  const staleReason = !staleSession ? null
    : !hasOAuthToken ? 'tokens_missing'
    : 'token_expired';

  // In-app consent flag — set by POST /api/auth/oauth/user/consent (no PingOne dependency)
  const consentGiven = isAuthenticated && req.session.agentConsentGiven === true;

  res.json({
    authenticated: isAuthenticated,
    staleSession,
    staleReason,
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
    clientType: isAuthenticated ? req.session.clientType : null,
    // In-app consent gate field — consumed by BankingAgent.js and agentMcpTokenService
    consentGiven,
    consentedAt: isAuthenticated ? (req.session.agentConsentedAt || null) : null,
    mayAct: isAuthenticated ? (req.session.mayAct || null) : null,
  });
});

/**
 * POST /api/auth/oauth/user/consent
 * Record that the authenticated end-user has accepted the in-app agent consent agreement.
 * Sets req.session.agentConsentGiven = true (no PingOne round-trip needed).
 */
router.post('/consent', (req, res) => {
  const token = req.session.oauthTokens?.accessToken;
  // Accept _cookie_session stub (demo/Vercel mode) — real gate is user+oauthType
  const hasOAuthToken = !!(token);
  const isAuthenticated = !!(req.session.user && hasOAuthToken && req.session.oauthType === 'user');

  if (!isAuthenticated) {
    return res.status(401).json({ error: 'not_authenticated', message: 'Must be logged in as a customer to grant agent consent.' });
  }

  req.session.agentConsentGiven  = true;
  req.session.agentConsentedAt   = new Date().toISOString();

  req.session.save((err) => {
    if (err) {
      console.error('[consent] Session save failed:', err.message);
      return res.status(500).json({ error: 'session_save_failed' });
    }
    console.log('[consent] Agent consent granted for user:', req.session.user?.username);
    res.json({ consentGiven: true, consentedAt: req.session.agentConsentedAt });
  });
});

/**
 * DELETE /api/auth/oauth/user/consent
 * Revoke the in-app agent consent for the current session (for testing / demo reset).
 */
router.delete('/consent', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  req.session.agentConsentGiven = false;
  delete req.session.agentConsentedAt;
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'session_save_failed' });
    res.json({ consentGiven: false });
  });
});

/**
 * GET /api/auth/oauth/user/token-claims
 * Returns decoded JWT claims from the end-user session access token (demo display only).
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
 * Logout end user OAuth session and end PingOne SSO session
 */
router.get('/logout', async (req, res) => {
  const idToken      = req.session.oauthTokens?.idToken      || null;
  const accessToken  = req.session.oauthTokens?.accessToken  || null;
  const refreshToken = req.session.oauthTokens?.refreshToken || null;
  const userId       = req.session.user?.oauthId || req.session.user?.id || null;
  const postLogoutUri = `${getFrontendOrigin()}/logout`;

  // RFC 7009 — revoke tokens before destroying the session (best-effort, non-fatal)
  if (accessToken  && accessToken  !== '_cookie_session') oauthService.revokeToken(accessToken,  'access_token');
  if (refreshToken && refreshToken !== '_cookie_session') oauthService.revokeToken(refreshToken, 'refresh_token');

  // Terminate PingOne SSO sessions so the user cannot silently re-authenticate
  try {
    await terminateAllUserSessions(userId);
  } catch (_) { /* non-fatal */ }

  // Clear this user's in-memory demo state so the next login starts fresh
  try {
    const { clearTokenChain } = require('../services/tokenChainService');
    const mcpAudit = require('../services/mcpToolAuditStore');
    if (userId) clearTokenChain(userId);
    mcpAudit.clearToolCalls();
    appEventService.clearEvents();
    if (global.pendingConsents) global.pendingConsents = {};
  } catch (_) { /* non-fatal */ }

  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }

    clearAllAuthCookies(res, _isProd());

    res.redirect(buildPingOneSignoffUrl(postLogoutUri, 'pingone_user_client_id', idToken));
  });
});

/**
 * RFC 6749 §6 — Refresh the end-user access token using the stored refresh token.
 * Called by the frontend or auto-refresh middleware when the access token is near expiry.
 */
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.session.oauthTokens?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'no_refresh_token', message: 'No refresh token in session' });
    }
    const tokenData = await oauthService.refreshAccessToken(refreshToken);
    // Update session with new tokens
    req.session.oauthTokens = {
      ...req.session.oauthTokens,
      accessToken:  tokenData.access_token,
      refreshToken: tokenData.refresh_token || req.session.oauthTokens.refreshToken,
      idToken:      tokenData.id_token      || req.session.oauthTokens.idToken,
      expiresAt:    Date.now() + ((tokenData.expires_in || 3600) * 1000),
      tokenType:    tokenData.token_type    || 'Bearer',
    };
    req.session.save((err) => {
      if (err) console.error('[refresh] Session save error:', err);
    });
    return res.json({ success: true, expiresAt: req.session.oauthTokens.expiresAt });
  } catch (err) {
    console.error('[refresh] Token refresh failed:', err.message);
    return res.status(401).json({ error: 'refresh_failed', message: err.message });
  }
});

/**
 * GET /api/auth/oauth/user/consent-url
 * @deprecated — In-app consent is now handled via POST /consent.
 * Kept for backwards-compat; signals caller to use the in-app modal.
 */
router.get('/consent-url', (req, res) => {
  return res.json({ deprecated: true, useInAppConsent: true });
});

/**
 * POST /api/auth/oauth/user/initiate-otp
 *
 * Email OTP step-up: generate a 6-digit code, store it in the session with a
 * 5-minute TTL, and send it to the user via the PingOne Notifications API.
 * Returns { otpSent, expiresIn, maskedEmail } — no PingOne redirect required.
 */
router.post('/initiate-otp', async (req, res) => {
  const token = req.session.oauthTokens?.accessToken;
  // Accept _cookie_session stub (demo/Vercel mode) — real gate is user+oauthType
  const hasOAuthToken = !!(token);
  const isAuthenticated = !!(req.session.user && hasOAuthToken && req.session.oauthType === 'user');
  if (!isAuthenticated) {
    return res.status(401).json({ error: 'not_authenticated', message: 'Must be logged in to initiate step-up.' });
  }

  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  req.session.pendingStepUpOtp = { code, expiresAt };

  req.session.save(async (err) => {
    if (err) {
      console.error('[OTP] Session save error:', err);
      return res.status(500).json({ error: 'session_error' });
    }

    const user = req.session.user;
    // oauthId is the PingOne UUID; id may be a legacy numeric key on bootstrap users
    const pingoneUserId = user?.oauthId || user?.id;
    console.log(`[OTP] Generated step-up OTP for user ${pingoneUserId} — code=${code}`);

    const method = (req.body && req.body.method === 'sms') ? 'sms' : 'email';

    // Primary delivery: PingOne native one-time OTP (POST /deviceAuthentications).
    // PingOne emails/SMSes the real code itself — no /messages endpoint, no admin
    // creds. The homegrown `code` above stays in the session as a BACKUP so the
    // user is never locked out if the email doesn't arrive (verify also accepts
    // 123123). We do NOT silently swallow a delivery failure — the response
    // reports whether PingOne actually sent it ("no silent fails").
    let delivered = false;
    let deliveryError = null;
    let pingMaskedContact = null;
    try {
      const contact = await mfaService.getPingOneUserContact(pingoneUserId);
      const deliveryType = method === 'sms' ? 'SMS' : 'EMAIL';
      const to = method === 'sms' ? contact.mobilePhone : contact.email;
      if (!to) {
        throw new Error(
          method === 'sms'
            ? 'No mobile phone is on file for this user in PingOne.'
            : 'No email address is on file for this user in PingOne.',
        );
      }
      const result = await mfaService.initiateOneTimeOtp(pingoneUserId, deliveryType, to);
      // Persist the PingOne transaction id so verify can check the real code.
      req.session.pendingStepUpOtp.daId = result.id || null;
      const dev = result?._embedded?.devices?.[0];
      pingMaskedContact = dev ? (dev.email || dev.phone || null) : null;
      delivered = !!result.id;
    } catch (sendErr) {
      deliveryError =
        sendErr.response?.data?.details?.[0]?.message ||
        sendErr.response?.data?.message ||
        sendErr.message ||
        'Delivery failed';
      console.error(`[OTP] PingOne ${method} OTP send FAILED:`, deliveryError);
    }
    // Persist the daId update from the delivery attempt.
    if (delivered) {
      await new Promise((resolve) => req.session.save(() => resolve()));
    }

    const isProd = process.env.NODE_ENV === 'production';

    // Prefer PingOne's own masked address from the OTP response; fall back to a
    // best-effort local lookup below.
    let maskedContact = pingMaskedContact;
    try {
      const pingoneUserId = user?.oauthId || user?.id;
      if (!maskedContact && pingoneUserId) {
        const { user: p1User } = await fetchPingOneUserById(pingoneUserId);
        if (method === 'sms' && p1User?.mobilePhone) {
          const digits = p1User.mobilePhone.replace(/\D/g, '');
          maskedContact = digits.length >= 4
            ? '***-***-' + digits.slice(-4)
            : p1User.mobilePhone;
        } else if (method !== 'sms') {
          const email = p1User?.email || user?.email || '';
          if (email.includes('@')) {
            const [local, domain] = email.split('@');
            const visible = local.length > 2 ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1] : local[0] + '*';
            maskedContact = visible + '@' + domain;
          }
        }
      }
    } catch (_) { /* non-fatal */ }

    // Fallback: mask email from session if PingOne lookup failed
    if (!maskedContact && method !== 'sms' && user?.email?.includes('@')) {
      const [local, domain] = user.email.split('@');
      const visible = local.length > 2 ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1] : local[0] + '*';
      maskedContact = visible + '@' + domain;
    }

    res.json({
      otpSent: delivered,
      // Truthful delivery signal so the UI never claims an email was sent when
      // it wasn't. When delivery fails, deliveryError carries the reason.
      delivered,
      deliveryError,
      method,
      expiresIn: 300,
      email: user.email || '',
      maskedContact,
      // devCode: only included in non-production so demos can complete step-up
      // without email/SMS delivery being configured.
      ...(isProd ? {} : { devCode: code }),
    });
  });
});

/**
 * POST /api/auth/oauth/user/verify-otp
 *
 * Verify the 6-digit code submitted by the user. On success, marks the session
 * as step-up verified so the next tool-call attempt can proceed without
 * re-challenging (single-use — consumed by checkLocalStepUp on the next call).
 */
router.post('/verify-otp', async (req, res) => {
  const token = req.session.oauthTokens?.accessToken;
  // Accept _cookie_session stub (demo/Vercel mode) — real gate is user+oauthType
  const hasOAuthToken = !!(token);
  const isAuthenticated = !!(req.session.user && hasOAuthToken && req.session.oauthType === 'user');
  if (!isAuthenticated) {
    return res.status(401).json({ error: 'not_authenticated', message: 'Must be logged in to verify OTP.' });
  }

  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'invalid_request', message: 'OTP code is required.' });
  }

  const pending = req.session.pendingStepUpOtp;
  if (!pending || Date.now() > pending.expiresAt) {
    delete req.session.pendingStepUpOtp;
    return res.status(400).json({ error: 'otp_expired', message: 'OTP has expired. Please request a new one.' });
  }

  const entered = code.trim();
  // Accept any of three codes:
  //   1. 123123 — demo bypass / backup (always works, never locked out).
  //   2. the homegrown session code — local backup.
  //   3. the real PingOne one-time OTP — verified against deviceAuthentications.
  let ok = entered === '123123' || entered === pending.code;
  if (!ok && pending.daId) {
    try {
      const result = await mfaService.verifyOneTimeOtp(pending.daId, entered);
      ok = result?.status === 'COMPLETED' || result?.completed === true;
    } catch (vErr) {
      console.warn('[OTP] PingOne one-time OTP verify failed:', vErr.message);
      ok = false;
    }
  }
  if (!ok) {
    return res.status(400).json({ error: 'invalid_code', message: 'Incorrect code. Please try again.' });
  }

  // Mark session as step-up verified with TTL (consumed by checkLocalStepUp)
  req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
  delete req.session.pendingStepUpOtp;

  req.session.save((err) => {
    if (err) {
      console.error('[OTP] Session save error after verify:', err);
      return res.status(500).json({ error: 'session_error' });
    }
    console.log(`[OTP] Step-up verified for user ${req.session.user?.id}`);
    res.json({ verified: true });
  });
});

module.exports = router;
module.exports.sanitizePostLoginReturnPath = sanitizePostLoginReturnPath;
