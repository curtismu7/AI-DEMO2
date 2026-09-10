'use strict';
/**
 * mcpPingOneAdminAuth.js — Authorization Code + PKCE login for the built-in
 * "PingOne MCP" profile in the Generic MCP Inspector (routes/mcpInspector.js).
 *
 * Deliberately separate from routes/oauth.js's admin banking login: this uses
 * its own PingOne app ("PingOne MCP Server" — WORKER type, authorization_code
 * + PKCE, no client secret; the same app services/pingoneProvisionService.js
 * already creates for AI-assistant dev tooling, found-or-created here so a demo
 * environment that never ran the full bootstrap still gets one) and its own
 * session keys (pingoneMcpAdminOAuth / pingoneMcpAdminToken). It never reads
 * or writes req.session.oauthTokens / oauthState / oauthCodeVerifier, so an
 * in-progress banking admin login can't collide with this flow.
 *
 * Why Authorization Code instead of reusing the demo's existing worker
 * client_credentials token: the resulting token carries whatever PingOne
 * roles the SIGNED-IN USER has (demoAdmin already has Environment Admin +
 * Identity Data Admin — see services/demoPersonaRoleHardening.js) rather than
 * a static machine credential's roles — that's what the hosted MCP server's
 * role-driven authorization checks on (see pingoneProvisionService.js's
 * "Step 32b" comment: WORKER + authorization_code + admin role -> ~73 tools,
 * vs ~6 for a plain user token with no admin role).
 */
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const router = express.Router();
const configStore = require('../services/configStore');
const { getAuthorizationEndpoint, getTokenEndpoint, getParEndpoint } = require('../services/oauthEndpointResolver');
const { PingOneProvisionService } = require('../services/pingoneProvisionService');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');
const pingoneAdminSession = require('../services/pingoneAdminSession');

const PUBLIC_APP_ORIGIN = () => String(
  configStore.getEffective('PUBLIC_APP_URL') || process.env.PUBLIC_APP_URL || 'https://local.ping-devops.com:4000',
).replace(/\/+$/, '');

const APP_NAME = 'PingOne MCP Server';
// PingOne's built-in MCP client. Not an application object in any environment —
// it cannot be listed, edited or recreated, and it is the ONLY client whose
// tokens the hosted MCP accepts. See resolveLoopbackClientConfig.
const BUILTIN_MCP_CLIENT_ID = 'pingone-mcp-server';
const CALLBACK_PATH = '/api/mcp/inspector/pingone-admin/callback';

// Cached for the process lifetime — same find-or-create app, reused across logins.
let _appCache = null;

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function callbackUrl(req) {
  const configured = configStore.getEffective('PUBLIC_APP_URL') || process.env.PUBLIC_APP_URL;
  const origin = configured ? configured.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
  return `${origin}${CALLBACK_PATH}`;
}

/**
 * All demo UI origins that may host the inspector OAuth return.
 * PUBLIC_APP_URL alone is not enough: local .env often points at api.ping.demo:4000
 * while passkey login uses local.ping-devops.com:4000 (see .env.example). Bootstrap
 * must keep both registered or PingOne returns invalid_grant on code exchange.
 */
function inspectorCallbackUrls(req) {
  const urls = new Set([callbackUrl(req)]);
  const cors = String(process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const origin of cors) {
    try {
      urls.add(`${new URL(origin).origin}${CALLBACK_PATH}`);
    } catch {
      /* ignore malformed CORS entries */
    }
  }
  // Always include the passkey-capable local origin even when CORS_ORIGIN is empty.
  urls.add(`https://local.ping-devops.com:4000${CALLBACK_PATH}`);
  urls.add(`https://api.ping.demo:4000${CALLBACK_PATH}`);
  return [...urls];
}

/** Same worker-credential resolution order as services/pingOneUserService.js. */
function resolveWorkerConfig() {
  const region = process.env.PINGONE_REGION || configStore.getEffective('PINGONE_REGION') || 'com';
  const environmentId = process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const workerClientId =
    process.env.PINGONE_WORKER_TOKEN_CLIENT_ID ||
    process.env.PINGONE_WORKER_CLIENT_ID ||
    configStore.getEffective('pingone_worker_token_client_id') ||
    configStore.getEffective('PINGONE_MGMT_CLIENT_ID') ||
    configStore.getEffective('PINGONE_MANAGEMENT_CLIENT_ID');
  const workerClientSecret =
    process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET ||
    process.env.PINGONE_WORKER_CLIENT_SECRET ||
    configStore.getEffective('pingone_worker_token_client_secret') ||
    configStore.getEffective('PINGONE_MGMT_CLIENT_SECRET') ||
    configStore.getEffective('PINGONE_MANAGEMENT_CLIENT_SECRET');
  if (!environmentId || !workerClientId || !workerClientSecret) {
    throw new Error(
      'PingOne worker credentials are not configured (PINGONE_ENVIRONMENT_ID / PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET)'
    );
  }
  return { region, environmentId, workerClientId, workerClientSecret };
}

/**
 * How this door signs in: PingOne's OWN built-in client, over a loopback
 * callback.
 *
 * THE MEASURED RULE (2026-09-10): the hosted MCP accepts a token only when it
 * was minted for `pingone-mcp-server`, PingOne's built-in client. Two tokens
 * identical in aud, scope, sub, env, org, iss and acr — differing only in
 * client_id — behave differently: an app we register 401s, the built-in one
 * returns 78 tools. Roles are not the lever (a 141-role org admin is refused
 * the same way), nor scopes, nor audience, nor app type.
 *
 * That client's redirect allowlist is loopback-only, which is the entire reason
 * for the callback listener: an HTTPS callback on the app's own origin is
 * refused with "Redirect URI mismatch", and the client is system-owned so the
 * allowlist cannot be edited. A published container port satisfies it instead.
 *
 * The environment is the ordinary PINGONE_ENVIRONMENT_ID — the endpoint's
 * environment must match the issuing one, and both are simply the environment
 * being administered. An earlier revision routed this through a separate
 * "admin environment"; that was wrong, and its config surface
 * (PINGONE_MCP_ENVIRONMENT_ID, a client secret, a client_secret_basic/post
 * switch) is gone with it — the built-in client is public and takes no secret.
 */
function resolveLoopbackClientConfig() {
  const region = process.env.PINGONE_REGION || configStore.getEffective('PINGONE_REGION') || 'com';
  const envId = process.env.PINGONE_ENVIRONMENT_ID || configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const port = process.env.PINGONE_MCP_ADMIN_LOOPBACK_PORT
    || configStore.getEffective('PINGONE_MCP_ADMIN_LOOPBACK_PORT');
  if (!envId || !port) return null;
  const clientId = process.env.PINGONE_MCP_ADMIN_CLIENT_ID
    || configStore.getEffective('PINGONE_MCP_ADMIN_CLIENT_ID')
    || BUILTIN_MCP_CLIENT_ID;
  const as = `https://auth.pingone.${region}/${envId}/as`;
  return {
    region,
    envId,
    clientId,
    port: Number(port),
    // `localhost`, not 127.0.0.1: this exact string is what the built-in client
    // allowlists, and PingOne matches redirect URIs character for character.
    redirectUri: `http://localhost:${port}/callback`,
    authorizationEndpoint: `${as}/authorize`,
    tokenEndpoint: `${as}/token`,
  };
}

/**
 * Find-or-create the "PingOne MCP Server" app (idempotent — createApplication
 * patches drift on an existing app rather than duplicating it) and make sure
 * our callback URL is in its redirectUris alongside any existing ones
 * (additive — never removes a URI another tool registered, e.g. Claude Code's
 * loopback callback).
 *
 * Redirect allowlist is re-checked every call (createApplication is a cheap
 * name lookup when the app exists) so a later bootstrap that replaced
 * redirectUris with Cursor loopbacks cannot leave the inspector callback missing.
 */
async function ensureApp(req) {
  const { region, environmentId, workerClientId, workerClientSecret } = resolveWorkerConfig();
  const provisioner = new PingOneProvisionService();
  await provisioner.initialize(environmentId, workerClientId, workerClientSecret, region);

  const created = await provisioner.createApplication(
    APP_NAME,
    'OAuth client for AI assistants to reach the hosted PingOne MCP server (PKCE, no secret, no app roles)',
    'WORKER',
    ['authorization_code', 'refresh_token'],
    'none'
  );
  const app = created.application;
  const existingRedirects = Array.isArray(app.redirectUris) ? app.redirectUris : [];
  let clientId = app.clientId;
  const needed = inspectorCallbackUrls(req).filter((u) => !existingRedirects.includes(u));
  if (needed.length) {
    const updated = await provisioner.updateApplication(app.id, {
      redirectUris: [...existingRedirects, ...needed],
    });
    clientId = updated.clientId || clientId;
  }

  _appCache = { id: app.id, clientId, region, environmentId };
  return _appCache;
}

/**
 * Session-cookie gate. This router is mounted under /api/mcp/inspector
 * WITHOUT authenticateToken, so middleware/auth.requireAdmin (which reads
 * req.user) would 401 every browser redirect that arrives with only a session
 * cookie — check session.user directly instead, like /api/mcp/audit does.
 *
 * Any signed-in user, not just admin: the resulting token just carries
 * whatever PingOne roles that user has (an admin gets ~73 tools, a plain
 * user ~6 per pingoneProvisionService.js's "Step 32b" comment) — there is no
 * privilege being handed out here beyond what the user's own PingOne account
 * already grants, so gating the LOGIN route to admin-only was narrower than
 * the token itself requires.
 */
function requireSignedInSession(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      error: 'unauthenticated',
      message: 'A valid session is required. Please sign in.',
    });
  }
  return next();
}

/** Only a site-relative path, mirroring routes/privilegeMcpClient.js's sanitizeReturnTo. */
function sanitizeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || value.includes('?') || value.includes('#')) return null;
  return value;
}

// GET /api/mcp/inspector/pingone-admin/login — any signed-in user (see
// requireSignedInSession above). ?returnTo=/some/path sends the browser back
// there instead of the inspector page once the token is minted, so another
// page (e.g. /privilege-mcp-client's pingone-admin door) can drive this flow.
router.get('/login', requireSignedInSession, async (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const redirectUri = callbackUrl(req);
    const returnTo = sanitizeReturnTo(req.query.returnTo);

    // Configured admin-environment client: authenticate where the MCP endpoint's
    // own authorization server lives. Plain inline authorize, no PAR — PAR was
    // adopted here to bind `resource`, and `resource` turned out to be ignored
    // by PingOne entirely (same entry), so it earns nothing and adds a leg that
    // has to be enabled on the app.
    //
    // login_hint pre-fills the sign-on with the signed-in username. Same
    // environment as the app session, so the demo user is a valid hint here.
    // PINGONE_MCP_ADMIN_LOGIN_HINT overrides it; set it empty to send none.
    const configuredHint = process.env.PINGONE_MCP_ADMIN_LOGIN_HINT
      ?? configStore.getEffective('PINGONE_MCP_ADMIN_LOGIN_HINT');
    const loginHint = configuredHint ?? req.session.user.username;

    // Loopback sign-in with PingOne's built-in client — the only shape the
    // hosted MCP accepts. No PAR (it existed to bind `resource`, which PingOne
    // ignores) and no client secret (the built-in client is public).
    const loopback = resolveLoopbackClientConfig();
    if (loopback) {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: loopback.clientId,
        redirect_uri: loopback.redirectUri,
        scope: 'openid',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      if (loginHint) params.set('login_hint', loginHint);
      // Keyed by state, not by session: the callback lands on localhost:<port>,
      // a different host from the one the session cookie is scoped to, so it
      // arrives with no cookie and cannot look the session up.
      rememberLoopbackPending(state, {
        codeVerifier,
        redirectUri: loopback.redirectUri,
        clientId: loopback.clientId,
        tokenEndpoint: loopback.tokenEndpoint,
        returnTo,
      });
      return res.redirect(`${loopback.authorizationEndpoint}?${params.toString()}`);
    }

    const app = await ensureApp(req);

    req.session.pingoneMcpAdminOAuth = { state, codeVerifier, redirectUri, returnTo };

    const resource = `https://mcp.pingone.${app.region}/admin/${app.environmentId}/mcp`;
    const authParams = {
      response_type: 'code',
      client_id: app.clientId,
      redirect_uri: redirectUri,
      scope: 'openid',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // The signed-in user's own username, not a hardcoded admin — the token
      // must authenticate as whoever is actually signed in, now that this
      // isn't admin-only.
      login_hint: req.session.user.username || 'demoAdmin',
      // Without this, PingOne mints a token for its default resource
      // (Management API, api.pingone.com) — the hosted MCP server is a
      // DIFFERENT resource and rejects that token outright with a generic
      // "401 Invalid authentication" (see mcpPingOneHttpAdapter.js's own file
      // header). Verified directly against the server's own RFC 9728 metadata
      // (GET https://mcp.pingone.com/.well-known/oauth-protected-resource/admin/{envId}/mcp)
      // — its `resource` field is exactly this URL, not a bare origin.
      resource,
    };

    // Pushed straight to /as/par (RFC 9126) rather than passed inline on the
    // /authorize redirect: this app has parRequirement OPTIONAL, but the
    // hosted MCP server still answered "401 Invalid authentication" with an
    // inline resource param — PAR is this project's own established working
    // pattern for resource-bound PingOne authorization (services/parService.js).
    // Public client (tokenEndpointAuthMethod NONE, PKCE-enforced) — no
    // client_secret in the push, same as this app's other two legs.
    let requestUri;
    try {
      const parResp = await axios.post(
        getParEndpoint(),
        new URLSearchParams(authParams).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 },
      );
      requestUri = parResp.data.request_uri;
      if (!requestUri) throw new Error('PAR endpoint did not return request_uri');
    } catch (err) {
      const n = normalizeAxiosError(err, { label: 'PingOne PAR push' });
      console.error('[mcpPingOneAdminAuth] PAR push failed:', n.message);
      return res.redirect(`/pingone-mcp-inspector?source=custom&pingone_admin_error=${encodeURIComponent(n.message)}`);
    }

    req.session.save((err) => {
      if (err) {
        console.error('[mcpPingOneAdminAuth] session save error:', err.message);
        return res.status(500).json({ error: 'login_init_failed', message: err.message });
      }
      // Per RFC 9126: only client_id + request_uri on the authorize leg —
      // every other param already travelled in the pushed request above.
      const authorizeParams = new URLSearchParams({ client_id: app.clientId, request_uri: requestUri });
      res.redirect(`${getAuthorizationEndpoint()}?${authorizeParams.toString()}`);
    });
  } catch (err) {
    console.error('[mcpPingOneAdminAuth] /login error:', err.message);
    res.redirect(`/pingone-mcp-inspector?source=custom&pingone_admin_error=${encodeURIComponent(err.message)}`);
  }
});

// GET /api/mcp/inspector/pingone-admin/callback
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  const pending = req.session?.pingoneMcpAdminOAuth;

  const failAndRedirect = (message) => {
    const returnTo = pending?.returnTo;
    delete req.session.pingoneMcpAdminOAuth;
    if (returnTo) {
      return res.redirect(`${returnTo}?pingone_admin_login=error&reason=${encodeURIComponent(message)}`);
    }
    res.redirect(`/pingone-mcp-inspector?source=custom&pingone_admin_error=${encodeURIComponent(message)}`);
  };

  if (error) return failAndRedirect(errorDescription || error);
  if (!pending || !state || state !== pending.state) return failAndRedirect('invalid_state');
  if (!code) return failAndRedirect('missing_code');

  try {
    // The legacy cookie-callback path, for a deployment with no loopback port
    // configured. It cannot reach the hosted MCP — that needs PingOne's built-in
    // client, which only redirects to loopback — but it is left intact rather
    // than deleted so an operator who has not opened a port still gets a token
    // and a clear 401 explaining why, instead of a broken route.
    const app = await ensureApp(req);
    const tokenEndpoint = getTokenEndpoint();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.codeVerifier,
      client_id: app.clientId,
      // Kept for parity with this path's PAR push, which pins it. NOTE: it is
      // inert — PingOne ignores RFC 8707 `resource` here, measured repeatedly:
      // the token comes back `aud: https://api.pingone.com` with or without it.
      // Left in place only because this legacy path is vestigial and not worth
      // a behaviour change; the working path (loopback) sends none.
      resource: `https://mcp.pingone.${app.region}/admin/${app.environmentId}/mcp`,
    });

    const resp = await axios.post(tokenEndpoint, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    const expiresInMs = (resp.data.expires_in || 3600) * 1000;
    req.session.pingoneMcpAdminToken = {
      accessToken: resp.data.access_token,
      expiresAt: Date.now() + expiresInMs,
    };
    const returnTo = pending.returnTo;
    delete req.session.pingoneMcpAdminOAuth;
    req.session.save((err) => {
      if (err) console.error('[mcpPingOneAdminAuth] session save error (post-token):', err.message);
      // Publish to the shared store ONLY once the browser session that owns
      // this token actually persisted. Publishing first left a privileged
      // credential serving the façade door on behalf of a sign-in that never
      // completed — and with no session, nothing would later clear it (logout
      // keys off req.session.pingoneMcpAdminToken). See
      // services/pingoneAdminSession.js for the trade this store makes.
      if (!err) {
        pingoneAdminSession.remember({
          accessToken: resp.data.access_token,
          expiresAt: Date.now() + expiresInMs,
        });
      }
      res.redirect(returnTo ? `${returnTo}?pingone_admin_login=success` : '/pingone-mcp-inspector?source=custom');
    });
  } catch (err) {
    const n = normalizeAxiosError(err, { label: 'PingOne token request' });
    const detail = n.message;
    console.error('[mcpPingOneAdminAuth] token exchange failed:', detail);
    failAndRedirect(detail);
  }
});

/**
 * Loopback OAuth state, keyed by the `state` parameter.
 *
 * The loopback callback arrives on http://localhost:<port>/callback — a
 * DIFFERENT host from the one the session cookie is scoped to — so that request
 * carries no cookie and cannot find the browser's session. `state` is the
 * correlation handle instead: 128 bits of crypto randomness, single-use
 * (deleted on redemption), and expiring, which is the same job it does in the
 * cookie flow.
 *
 * In-process and deliberately not persisted: an entry is only meaningful
 * between a /login and its callback, and a restart in that window should fail
 * the sign-in rather than resurrect a half-finished one.
 */
const loopbackPending = new Map();
const LOOPBACK_PENDING_TTL_MS = 10 * 60 * 1000;

function rememberLoopbackPending(state, entry) {
  // Swept on write — no timer to leak, and the map only ever holds sign-ins
  // started in the last ten minutes.
  const now = Date.now();
  for (const [k, v] of loopbackPending) if (v.expiresAt <= now) loopbackPending.delete(k);
  loopbackPending.set(state, { ...entry, expiresAt: now + LOOPBACK_PENDING_TTL_MS });
}

/**
 * The loopback listener's ONLY route. server.js binds it to its own plain-HTTP
 * port serving nothing else — the same discipline as the façade listener, which
 * deliberately never exposes the session app.
 *
 * Publishes the token to the shared admin-session store, which is where the
 * pingone-admin door already reads it from (mcpFacade.js ->
 * pingoneAdminSession.getAccessToken), then sends the browser back to the
 * public origin so the user lands on the page they started from rather than on
 * a dead localhost tab.
 */
async function handleLoopbackCallback(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const pending = state ? loopbackPending.get(state) : null;
  // Single-use: redeemed or not, this state is spent.
  if (state) loopbackPending.delete(state);

  const backTo = (qs) => {
    const base = `${PUBLIC_APP_ORIGIN()}${pending?.returnTo || '/pingone-mcp-inspector'}`;
    res.writeHead(302, { Location: `${base}?${qs}` });
    res.end();
  };

  if (oauthError) return backTo(`pingone_admin_login=error&reason=${encodeURIComponent(oauthError)}`);
  // An unknown state must not redirect anywhere useful: it is expired,
  // replayed, or forged.
  if (!pending) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Unknown or expired sign-in. Start again from the app.');
  }
  if (!code) return backTo('pingone_admin_login=error&reason=missing_code');

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.codeVerifier,
    });
    const resp = await axios.post(pending.tokenEndpoint, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    const expiresInMs = (resp.data.expires_in || 3600) * 1000;
    pingoneAdminSession.remember({
      accessToken: resp.data.access_token,
      expiresAt: Date.now() + expiresInMs,
    });
    return backTo('pingone_admin_login=success');
  } catch (err) {
    const n = normalizeAxiosError(err, { label: 'PingOne token request (loopback)' });
    console.error('[mcpPingOneAdminAuth] loopback token exchange failed:', n.message);
    return backTo(`pingone_admin_login=error&reason=${encodeURIComponent(n.message)}`);
  }
}

module.exports = router;
module.exports.handleLoopbackCallback = handleLoopbackCallback;
module.exports.resolveLoopbackClientConfig = resolveLoopbackClientConfig;
// Test-only exports (pure helpers — no live PingOne calls).
module.exports._test = { CALLBACK_PATH, callbackUrl, inspectorCallbackUrls };
