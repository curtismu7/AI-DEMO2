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
const { PingOneProvisionService } = require('../services/pingoneProvisionService');

const APP_NAME = 'PingOne MCP Server';
const CALLBACK_PATH = '/api/mcp/inspector/pingone-admin/callback';

// Cached for the process lifetime — same find-or-create app, reused across logins.
let _appCache = null;

/**
 * Session-cookie admin gate. This router is mounted under /api/mcp/inspector
 * WITHOUT authenticateToken, so middleware/auth.requireAdmin (req.user) would
 * 401 every browser redirect. Match /api/mcp/audit: session.user.role.
 */
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
      message: 'Admin session required for PingOne MCP admin login.',
    });
  }
  return next();
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function authorizeEndpoint(region, environmentId) {
  return `https://auth.pingone.${region}/${environmentId}/as/authorize`;
}

function tokenEndpoint(region, environmentId) {
  return `https://auth.pingone.${region}/${environmentId}/as/token`;
}

function callbackUrl(req) {
  const configured = configStore.getEffective('PUBLIC_APP_URL') || process.env.PUBLIC_APP_URL;
  const origin = configured ? configured.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
  return `${origin}${CALLBACK_PATH}`;
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
 * Find-or-create the "PingOne MCP Server" app (idempotent — createApplication
 * patches drift on an existing app rather than duplicating it) and make sure
 * our callback URL is in its redirectUris alongside any existing ones
 * (additive — never removes a URI another tool registered, e.g. Claude Code's
 * loopback callback).
 */
async function ensureApp(req) {
  if (_appCache) return _appCache;
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
  const cb = callbackUrl(req);
  const existingRedirects = Array.isArray(app.redirectUris) ? app.redirectUris : [];
  let clientId = app.clientId;
  if (!existingRedirects.includes(cb)) {
    const updated = await provisioner.updateApplication(app.id, {
      redirectUris: [...existingRedirects, cb],
    });
    clientId = updated.clientId || clientId;
  }

  _appCache = { id: app.id, clientId, region, environmentId };
  return _appCache;
}

// GET /api/mcp/inspector/pingone-admin/login — admin session required (this
// mints a token carrying the signed-in user's PingOne admin roles; only
// meaningful for our own demo admin). Uses session.user.role — see
// requireAdminSession above (req.user is unset on this mount).
router.get('/login', requireAdminSession, async (req, res) => {
  try {
    const app = await ensureApp(req);
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const redirectUri = callbackUrl(req);

    req.session.pingoneMcpAdminOAuth = { state, codeVerifier, redirectUri };

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: app.clientId,
      redirect_uri: redirectUri,
      scope: 'openid',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      login_hint: 'demoAdmin',
    });

    req.session.save((err) => {
      if (err) {
        console.error('[mcpPingOneAdminAuth] session save error:', err.message);
        return res.status(500).json({ error: 'login_init_failed', message: err.message });
      }
      res.redirect(`${authorizeEndpoint(app.region, app.environmentId)}?${params.toString()}`);
    });
  } catch (err) {
    console.error('[mcpPingOneAdminAuth] /login error:', err.message);
    res.redirect(`/mcp-inspector?pingone_admin_error=${encodeURIComponent(err.message)}`);
  }
});

// GET /api/mcp/inspector/pingone-admin/callback
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  const pending = req.session?.pingoneMcpAdminOAuth;

  const failAndRedirect = (message) => {
    delete req.session.pingoneMcpAdminOAuth;
    res.redirect(`/mcp-inspector?pingone_admin_error=${encodeURIComponent(message)}`);
  };

  if (error) return failAndRedirect(errorDescription || error);
  if (!pending || !state || state !== pending.state) return failAndRedirect('invalid_state');
  if (!code) return failAndRedirect('missing_code');

  try {
    const app = await ensureApp(req);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: app.clientId,
      code_verifier: pending.codeVerifier,
    });
    const resp = await axios.post(tokenEndpoint(app.region, app.environmentId), body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    const expiresInMs = (resp.data.expires_in || 3600) * 1000;
    req.session.pingoneMcpAdminToken = {
      accessToken: resp.data.access_token,
      expiresAt: Date.now() + expiresInMs,
    };
    delete req.session.pingoneMcpAdminOAuth;
    req.session.save((err) => {
      if (err) console.error('[mcpPingOneAdminAuth] session save error (post-token):', err.message);
      res.redirect('/mcp-inspector');
    });
  } catch (err) {
    const detail = err.response?.data?.error_description || err.response?.data?.error || err.message;
    console.error('[mcpPingOneAdminAuth] token exchange failed:', detail);
    failAndRedirect(detail);
  }
});

module.exports = router;
