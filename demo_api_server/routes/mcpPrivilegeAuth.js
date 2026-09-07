'use strict';
/**
 * mcpPrivilegeAuth.js — Authorization Code + PKCE login for the built-in
 * `transport: 'privilege'` profiles in the Generic MCP Inspector
 * (routes/mcpInspector.js, services/mcpProfileStore.js).
 *
 * One login per door, not one shared login. Confirmed live 2026-09-07 against
 * the current single AI Gateway (privilege/CURRENT-CONFIGURATION.md): each
 * Agentic App is its OWN OAuth authorization server —
 * `https://mcpgw.ai-demo.ping-devops.com/<app>/.well-known/oauth-authorization-server`
 * returns a distinct `issuer`/`authorization_endpoint`/`token_endpoint`/
 * `registration_endpoint` per app. That is a change from the older per-owner
 * gateway this file used to target (a single shared `/external` issuer good
 * for every app, per privilege/AGENTLESS-CONFIGURATION.md's 2026-08-24 entry).
 * A token minted against one door's issuer is not expected to validate on
 * another, so this file registers a client and mints a token per profileId,
 * caching each independently — the same discover-once-per-target shape
 * mcpPingOneAdminAuth.js uses for its one PingOne app, just keyed by door.
 *
 * Every door still uses Dynamic Client Registration (RFC 7591): none of them
 * are a pre-registered PingOne "Application" object.
 */
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const router = express.Router();
const configStore = require('../services/configStore');
const mcpProfileStore = require('../services/mcpProfileStore');
const { requireSession } = require('../middleware/auth');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const CALLBACK_PATH = '/api/mcp/inspector/privilege/callback';

// Cached for the process lifetime, one entry per profileId — same
// discover-once, reuse-forever shape as mcpPingOneAdminAuth.js's _appCache.
const _clientCache = new Map();

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

/** A privilege-transport profile's own issuer: <gateway>/<door>/mcp -> <gateway>/<door>. */
function issuerForProfile(profile) {
  const u = new URL(profile.url);
  return `${u.origin}${u.pathname.replace(/\/mcp$/, '')}`;
}

/** Discover profileId's door's OAuth endpoints, then register a public PKCE client for it. */
async function ensureClient(req, profileId) {
  if (_clientCache.has(profileId)) return _clientCache.get(profileId);

  const profile = mcpProfileStore.getProfile(profileId);
  if (!profile || profile.transport !== 'privilege' || !profile.url) {
    const err = new Error(`"${profileId}" is not a known Privilege door profile.`);
    err.code = 'unknown_privilege_profile';
    throw err;
  }
  const issuer = issuerForProfile(profile);

  const { data: metadata } = await axios.get(
    `${issuer}/.well-known/oauth-authorization-server`,
    { timeout: 10000 },
  );
  const { data: registration } = await axios.post(
    metadata.registration_endpoint,
    {
      redirect_uris: inspectorCallbackUrls(req),
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_name: `AI-DEMO2 MCP Inspector (${profile.label || profileId})`,
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10000 },
  );

  const client = {
    clientId: registration.client_id,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
  };
  _clientCache.set(profileId, client);
  return client;
}

// GET /api/mcp/inspector/privilege/login?profile=<id> — any signed-in session
// (user or admin), not admin-only, not anonymous — see requireSession
// (middleware/auth.js, session-cookie based since this router is mounted
// without authenticateToken; see mcpInspector.js's own use of it). `profile`
// must name one of the seeded transport:'privilege' profiles
// (mcpProfileStore.js) — there is no login without a door.
router.get('/login', requireSession, async (req, res) => {
  const profileId = typeof req.query.profile === 'string' ? req.query.profile.trim() : '';
  if (!profileId) {
    return res.status(400).json({
      error: 'profile_required',
      message: 'A ?profile=<id> query param naming the Privilege door is required.',
    });
  }
  try {
    const client = await ensureClient(req, profileId);
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const redirectUri = callbackUrl(req);

    req.session.privilegeMcpOAuth = { state, codeVerifier, redirectUri, profileId };

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
    const profileParam = `&profile=${encodeURIComponent(profileId)}`;
    res.redirect(`/pingone-mcp-inspector?source=custom${profileParam}&privilege_error=${encodeURIComponent(err.message)}`);
  }
});

// GET /api/mcp/inspector/privilege/callback
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  const pending = req.session?.privilegeMcpOAuth;

  const failAndRedirect = (message, profileId) => {
    delete req.session.privilegeMcpOAuth;
    const profileParam = profileId ? `&profile=${encodeURIComponent(profileId)}` : '';
    res.redirect(`/pingone-mcp-inspector?source=custom${profileParam}&privilege_error=${encodeURIComponent(message)}`);
  };

  if (error) return failAndRedirect(errorDescription || error, pending?.profileId);
  if (!pending || !state || state !== pending.state) return failAndRedirect('invalid_state', pending?.profileId);
  if (!code) return failAndRedirect('missing_code', pending.profileId);

  const { profileId } = pending;
  try {
    const client = await ensureClient(req, profileId);
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
    req.session.privilegeMcpTokens = req.session.privilegeMcpTokens || {};
    req.session.privilegeMcpTokens[profileId] = {
      accessToken: resp.data.access_token,
      expiresAt: Date.now() + expiresInMs,
    };
    delete req.session.privilegeMcpOAuth;
    req.session.save((err) => {
      if (err) console.error('[mcpPrivilegeAuth] session save error (post-token):', err.message);
      res.redirect(`/pingone-mcp-inspector?source=custom&profile=${encodeURIComponent(profileId)}`);
    });
  } catch (err) {
    const n = normalizeAxiosError(err, { label: 'Privilege token request' });
    console.error('[mcpPrivilegeAuth] token exchange failed:', n.message);
    failAndRedirect(n.message, profileId);
  }
});

module.exports = router;
// Test-only exports (pure helpers — no live network calls).
module.exports._test = { CALLBACK_PATH, callbackUrl, inspectorCallbackUrls, issuerForProfile, _clientCache };
