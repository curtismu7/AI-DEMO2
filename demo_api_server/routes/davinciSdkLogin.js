// Backend half of the DaVinci SDK login demo (/davinci-sdk-login).
//
// WHY THIS FILE EXISTS SEPARATELY FROM routes/davinciLogin.js — do not merge them.
//
// The SDK builds the /authorize request itself, using the DaVinci SDK app's own
// clientId (PINGONE_DAVINCI_LOGIN_APP_ID). routes/davinciLogin.js exchanges via
// oauthService, which is a singleton bound to the ADMIN client
// (`client_id: this.config.clientId` → `admin_client_id`). Exchanging a code
// issued to one app as a different client returns invalid_grant, so this path
// needs its own exchange. REGRESSION_PLAN.md's 2026-09-02 entry states the rule
// it protects: "The authorize URL MUST be built with the same oauthService that
// signs the exchange, or client_id will not match."
//
// The two alternatives were both worse: taking clientId from the request body
// would let an unauthenticated caller choose which PingOne app the BFF
// authenticates as, and a session-flag branch would put an `if` inside the nonce
// read-and-delete block of a §1 file whose stated invariant is that the block is
// unchanged.
//
// ponytail: the session-establish block below is duplicated from
// routes/davinciLogin.js rather than extracted — extracting means editing that
// §1 file. Extract to services/davinciSessionLogin.js when a THIRD DaVinci login
// path appears.
//
// The app is a PUBLIC client (tokenEndpointAuthMethod NONE, PKCE S256_REQUIRED),
// which is what Ping's own SDK tutorial specifies — so there is no client secret
// anywhere in this file and nothing to vault.
'use strict';
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const davinciConfig = require('../config/davinci');
const configStore = require('../services/configStore');
const { getTokenEndpoint, getDiscoveryEndpoint } = require('../services/oauthEndpointResolver');
const oauthService = require('../services/oauthService');
const dataStore = require('../data/store');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const router = express.Router();

const SCOPE = 'openid profile email';

// Config-first, headers last. Header derivation once put the INTERNAL upstream
// name into redirect_uri on the live stack (https://demo-api-server:3001/...),
// which PingOne rejects and a browser cannot reach. Mirrors davinciLogin.js.
function sdkRedirectUri(req) {
  const explicit = configStore.getEffective('pingone_davinci_sdk_login_redirect_uri');
  if (explicit) return explicit;

  const publicBase = configStore.getEffective('pingone_public_app_url');
  if (publicBase) return `${String(publicBase).replace(/\/+$/, '')}/davinci-sdk-login`;

  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}/davinci-sdk-login`;
}

// POST /api/davinci-sdk-login/start
//
// Arms the single-use nonce and returns the non-secret config the SDK needs.
//
// Unlike the widget's /sdk-token this makes NO upstream call: the SDK talks to
// PingOne directly, so there is no DaVinci SDK token to mint and no reason to
// require companyId/policyId/apiKey here.
//
// The nonce IS returned to the browser, which the widget path deliberately
// avoids. That is fine and unavoidable: the SDK builds the authorize request, so
// the nonce must travel to be put on it — and an OIDC nonce is a public
// authorize parameter by design (OIDC Core §3.1.2.1). Its security property is
// that the SERVER remembers what it expects and spends it once, and neither half
// of that is in the browser.
router.post('/start', (req, res) => {
  const { appId } = davinciConfig.login;
  if (!appId) {
    // Name the exact key and where it lives. A blanket "set these" cannot
    // distinguish a missing .env entry from a value that never reached
    // configStore, and the two have different fixes (see /sdk-token's comment).
    return res.status(503).json({
      error: 'davinci_sdk_not_configured',
      message: 'DaVinci SDK login is not configured — missing: PINGONE_DAVINCI_LOGIN_APP_ID (.env or configStore key pingone_davinci_login_app_id).',
      missing: ['PINGONE_DAVINCI_LOGIN_APP_ID (.env or configStore pingone_davinci_login_app_id)'],
    });
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectUri = sdkRedirectUri(req);

  // Session keys are distinct from the widget path's so that a user with both
  // pages open cannot have one consume the other's armed nonce.
  req.session.davinciSdkLoginNonce = nonce;
  req.session.davinciSdkLoginRedirectUri = redirectUri;
  req.session.save((err) => {
    if (err) {
      console.error('[davinci-sdk-login/start] Session save FAILED:', err.message);
      return res.status(500).json({ error: 'session_save_failed', message: 'Could not persist nonce.' });
    }
    return res.json({
      clientId: appId,
      redirectUri,
      scope: SCOPE,
      wellknown: getDiscoveryEndpoint(),
      nonce,
    });
  });
});

// POST /api/davinci-sdk-login/callback   { code, codeVerifier }
//
// The SDK generated the PKCE verifier in the browser and never reads it back, so
// the page posts it alongside the code. redirect_uri is derived HERE and a
// body-supplied one is ignored: the browser built the authorize request, so
// honouring a body value would let a caller steer redirect_uri at the token
// endpoint. /start is what told the browser which string to use, so both sides
// compute the same value independently.
router.post('/callback', async (req, res) => {
  const body = req.body || {};
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const codeVerifier = typeof body.codeVerifier === 'string' ? body.codeVerifier.trim() : '';
  if (!code || !codeVerifier) {
    return res.status(400).json({ error: 'invalid_request', message: 'code and codeVerifier are required.' });
  }
  // Trust-boundary caps. Anything longer is not a real code/verifier and would
  // go straight into the upstream call.
  if (code.length > 4096 || codeVerifier.length > 256) {
    return res.status(400).json({ error: 'invalid_request', message: 'code or codeVerifier is too long.' });
  }

  const { appId } = davinciConfig.login;
  if (!appId) {
    return res.status(503).json({ error: 'davinci_sdk_not_configured', message: 'DaVinci SDK login is not configured.' });
  }

  // Nonce is single-use: read-and-delete BEFORE the exchange so a failed attempt
  // cannot retry against the same value (mirrors routes/oauth.js).
  const expectedNonce = req.session.davinciSdkLoginNonce;
  const redirectUri = req.session.davinciSdkLoginRedirectUri || sdkRedirectUri(req);
  delete req.session.davinciSdkLoginNonce;
  delete req.session.davinciSdkLoginRedirectUri;
  if (!expectedNonce) {
    return res.status(401).json({ error: 'nonce_missing', message: 'No login flow was started in this session. Restart the sign-in.' });
  }

  try {
    // Public client: client_id in the body, PKCE proves possession, no secret.
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: appId,
    });
    const { data: tokenData } = await axios.post(getTokenEndpoint(), form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    });

    // OIDC Core §3.1.3.7: we sent a nonce, so the ID token MUST echo it.
    // Missing or mismatched means a possibly replayed/substituted token — fail,
    // never warn-and-proceed (same rule as routes/oauthUser.js post-#2043).
    let idNonce = null;
    try {
      idNonce = JSON.parse(
        Buffer.from(String(tokenData.id_token || '').split('.')[1] || '', 'base64url').toString(),
      ).nonce || null;
    } catch (_) { /* unparseable ID token → idNonce stays null → rejected below */ }
    if (idNonce !== expectedNonce) {
      console.error('[davinci-sdk-login/callback] ID token nonce %s — possible replay', idNonce ? 'mismatch' : 'missing');
      return res.status(401).json({
        error: idNonce ? 'nonce_mismatch' : 'nonce_missing',
        message: 'ID token failed replay verification. Restart the sign-in.',
      });
    }

    const userInfo = await oauthService.getUserInfo(tokenData.access_token);
    const oauthUser = oauthService.createUserFromOAuth(userInfo);

    // Demo customer-login sandbox: authenticate an EXISTING demo user only.
    // Unlike routes/oauth.js's admin flow, never auto-create or auto-admin an
    // account from an arbitrary DaVinci login.
    const user = dataStore.getUserByUsername(oauthUser.username);
    if (!user) {
      return res.status(404).json({ error: 'user_not_found', message: `No demo user found for "${oauthUser.username}".` });
    }

    // Regenerate before storing credentials to prevent session fixation
    // (mirrors routes/oauth.js and routes/oauthUser.js). Failure is fatal.
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error('[davinci-sdk-login/callback] Session regenerate FAILED — aborting login:', regenErr.message);
        return res.status(500).json({ error: 'session_regenerate_failed', message: 'Could not establish a session.' });
      }

      req.session.oauthTokens = {
        accessToken: tokenData.access_token,
        idToken: tokenData.id_token || null,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + (tokenData.expires_in * 1000),
        tokenType: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || null,
      };
      req.session.user = user;

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[davinci-sdk-login/callback] Session save FAILED:', saveErr.message);
          return res.status(500).json({ error: 'session_save_failed', message: 'Could not persist session.' });
        }
        return res.json({ ok: true });
      });
    });
  } catch (err) {
    const normalized = normalizeAxiosError(err, { label: 'DaVinci SDK login token exchange', timeoutMs: 10_000 });
    // normalizeAxiosError only derives httpStatus for an axios-shaped error.
    // Anything else thrown in the block above (getUserInfo, a claim-mapping
    // fault, a plain programming error) leaves it undefined, and
    // res.status(undefined) throws RangeError INSIDE the catch — turning a
    // handled upstream failure into an unhandled crash mid-response. Default it.
    const status = Number.isInteger(normalized.httpStatus) ? normalized.httpStatus : 502;
    console.error('[davinci-sdk-login/callback] exchange failed:', normalized.message);
    return res.status(status).json({ error: 'davinci_sdk_login_exchange_failed', message: normalized.message });
  }
});

module.exports = router;
