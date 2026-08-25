'use strict';
/**
 * mcpPrivilegeAuth.js — Authorization Code + PKCE login for the built-in
 * "Privilege MCP" profile in the Generic MCP Inspector (routes/mcpInspector.js).
 *
 * Unlike mcpPingOneAdminAuth.js's target (a manually pre-registered PingOne
 * WORKER app), the Privilege Cloud gateway (cmuir-agentless-mcpgw.ping-devops.com
 * /external) is not a PingOne "Application" object at all — per
 * privilege/AGENTLESS-CONFIGURATION.md's 2026-08-24 entry, only Dynamic Client
 * Registration (RFC 7591) against the gateway's own /external/register is a
 * proven working path for a per-consumer client on this gateway; the one
 * manually-registered PingOne OIDC application documented there is the
 * gateway's own shared login client, not a per-consumer pattern. This route
 * discovers the gateway's OAuth endpoints (RFC 8414 authorization-server
 * metadata) and registers a public client (token_endpoint_auth_method:
 * "none", PKCE-only, no secret) once per process, caching the result exactly
 * like mcpPingOneAdminAuth.js caches its found-or-created PingOne app.
 */
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const router = express.Router();
const configStore = require('../services/configStore');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const GATEWAY_ISSUER = 'https://cmuir-agentless-mcpgw.ping-devops.com/external';
const CALLBACK_PATH = '/api/mcp/inspector/privilege/callback';

// Cached for the process lifetime — same discover-once, reuse-forever shape
// as mcpPingOneAdminAuth.js's _appCache.
let _clientCache = null;

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function callbackUrl(req) {
  const configured = configStore.getEffective('PUBLIC_APP_URL') || process.env.PUBLIC_APP_URL;
  const origin = configured ? configured.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
  return `${origin}${CALLBACK_PATH}`;
}

/**
 * All demo UI origins that may host the inspector OAuth return — same
 * reasoning as mcpPingOneAdminAuth.js's inspectorCallbackUrls(): local .env
 * often points at api.ping.demo while passkey login uses
 * local.ping-devops.com, and DCR only accepts the redirect_uris registered
 * at client-creation time (there is no later "add another redirect URI"
 * call for a DCR client the way there is for a PingOne Application).
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
  urls.add(`https://local.ping-devops.com:4000${CALLBACK_PATH}`);
  urls.add(`https://api.ping.demo:4000${CALLBACK_PATH}`);
  return [...urls];
}

/** Discover the gateway's OAuth endpoints, then register a public PKCE client. */
async function ensureClient(req) {
  if (_clientCache) return _clientCache;

  const { data: metadata } = await axios.get(
    `${GATEWAY_ISSUER}/.well-known/oauth-authorization-server`,
    { timeout: 10000 },
  );
  const { data: registration } = await axios.post(
    metadata.registration_endpoint,
    {
      redirect_uris: inspectorCallbackUrls(req),
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_name: 'AI-DEMO2 MCP Inspector',
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10000 },
  );

  _clientCache = {
    clientId: registration.client_id,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
  };
  return _clientCache;
}

// Session-cookie admin gate — this router is mounted under /api/mcp/inspector
// WITHOUT authenticateToken (see mcpInspector.js), so middleware/auth.requireAdmin
// (which reads req.user) would 401 every browser redirect that arrives with
// only a session cookie. Same fix REGRESSION_PLAN.md's 2026-07-26 entry
// applied to mcpPingOneAdminAuth.js — check session.user.role directly.
function requireAdminSession(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      error: 'unauthenticated',
      message: 'A valid session is required. Please sign in.',
    });
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({
      error: 'admin_required',
      message: 'Admin session required for Privilege MCP admin login.',
    });
  }
  return next();
}

// GET /api/mcp/inspector/privilege/login — admin only (this mints a token
// carrying the signed-in user's own PingOne identity; only meaningful for
// our own demo admin, same guard as the PingOne MCP admin login).
router.get('/login', requireAdminSession, async (req, res) => {
  try {
    const client = await ensureClient(req);
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const redirectUri = callbackUrl(req);

    req.session.privilegeMcpOAuth = { state, codeVerifier, redirectUri };

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    req.session.save((err) => {
      if (err) {
        console.error('[mcpPrivilegeAuth] session save error:', err.message);
        return res.status(500).json({ error: 'login_init_failed', message: err.message });
      }
      res.redirect(`${client.authorizationEndpoint}?${params.toString()}`);
    });
  } catch (err) {
    console.error('[mcpPrivilegeAuth] /login error:', err.message);
    res.redirect(`/pingone-mcp-inspector?source=custom&privilege_error=${encodeURIComponent(err.message)}`);
  }
});

// GET /api/mcp/inspector/privilege/callback
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  const pending = req.session?.privilegeMcpOAuth;

  const failAndRedirect = (message) => {
    delete req.session.privilegeMcpOAuth;
    res.redirect(`/pingone-mcp-inspector?source=custom&privilege_error=${encodeURIComponent(message)}`);
  };

  if (error) return failAndRedirect(errorDescription || error);
  if (!pending || !state || state !== pending.state) return failAndRedirect('invalid_state');
  if (!code) return failAndRedirect('missing_code');

  try {
    const client = await ensureClient(req);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: client.clientId,
      code_verifier: pending.codeVerifier,
    });
    const resp = await axios.post(client.tokenEndpoint, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    const expiresInMs = (resp.data.expires_in || 3600) * 1000;
    req.session.privilegeMcpToken = {
      accessToken: resp.data.access_token,
      expiresAt: Date.now() + expiresInMs,
    };
    delete req.session.privilegeMcpOAuth;
    req.session.save((err) => {
      if (err) console.error('[mcpPrivilegeAuth] session save error (post-token):', err.message);
      res.redirect('/pingone-mcp-inspector?source=custom&profile=built-in-privilege-mcp');
    });
  } catch (err) {
    const n = normalizeAxiosError(err, { label: 'Privilege token request' });
    console.error('[mcpPrivilegeAuth] token exchange failed:', n.message);
    failAndRedirect(n.message);
  }
});

module.exports = router;
// Test-only exports (pure helpers — no live network calls).
module.exports._test = { CALLBACK_PATH, callbackUrl, inspectorCallbackUrls };
