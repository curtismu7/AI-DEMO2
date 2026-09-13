// Backend half of the DaVinci widget login demo (/davinci-login-guide).
//
// The widget renders the flow's own screens in-page. The flow ends with the
// PingOne Authentication connector's "Return Success Response (Widget Flows)",
// which creates the PingOne session and hands OIDC tokens straight back to the
// page's successCallback. The page posts them to POST /widget-session, which
// verifies them and establishes the BFF session. There is no /authorize hop.
//
// Why no hop: the widget's calls to auth.pingone.com are cross-site, so the
// PingOne session cookie (ST) they receive never reaches a top-level
// /as/authorize. Measured 2026-09-13 in a fresh Chrome: Set-Cookie ST arrived,
// was not reported blocked, and was absent from the cookie jar when /authorize
// was sent, so PingOne showed its hosted sign-on page instead of issuing a
// code. Safari and Firefox block such cookies by default anyway.
//
// POST /callback (code exchange) stays for a client that runs its own PKCE.
// Session establishment mirrors routes/oauthUser.js's end-user callback (NOT
// routes/oauth.js — that flow auto-creates admin accounts, which is wrong for
// this sandbox). Does not touch routes/oauth.js or routes/oauthUser.js
// (REGRESSION_PLAN §1).
'use strict';
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const davinciConfig = require('../config/davinci');
const configStore = require('../services/configStore');
const { getDiscoveryEndpoint } = require('../services/oauthEndpointResolver');
const oauthService = require('../services/oauthService');
const tokenVerificationService = require('../services/tokenVerificationService');
const dataStore = require('../data/store');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const router = express.Router();

const ORCHESTRATE_BASE = 'https://orchestrate-api.pingone.com/v1';

// Arms one login run: the single-use nonce /widget-session and /callback
// verify. It goes to the flow as a parameter and comes back as the ID token's
// nonce claim; it is never returned to the browser.
function armLoginNonce(req, cb) {
  const nonce = crypto.randomBytes(16).toString('hex');
  req.session.davinciLoginNonce = nonce;
  req.session.save((err) => cb(err, nonce));
}

// Looks up an EXISTING demo user for the tokens and starts a fresh session
// holding them. Shared by /callback and /widget-session so the two sign-ins
// cannot drift apart.
async function establishSession(req, res, tokens, label) {
  const userInfo = await oauthService.getUserInfo(tokens.accessToken);
  const oauthUser = oauthService.createUserFromOAuth(userInfo);

  // This is a demo customer-login sandbox — authenticate an EXISTING demo user only
  // (mirrors routes/oauthUser.js's lookup). Unlike routes/oauth.js's admin flow, never
  // auto-create or auto-admin an account from an arbitrary DaVinci login.
  const user = dataStore.getUserByUsername(oauthUser.username);
  if (!user) {
    return res.status(404).json({ error: 'user_not_found', message: `No demo user found for "${oauthUser.username}".` });
  }

  // Regenerate session before storing credentials to prevent session fixation
  // (mirrors routes/oauth.js and routes/oauthUser.js). Failure is fatal.
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      console.error(`[davinci-login/${label}] Session regenerate FAILED — aborting login:`, regenErr.message);
      return res.status(500).json({ error: 'session_regenerate_failed', message: 'Could not establish a session.' });
    }

    req.session.oauthTokens = tokens;
    req.session.user = user;

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error(`[davinci-login/${label}] Session save FAILED:`, saveErr.message);
        return res.status(500).json({ error: 'session_save_failed', message: 'Could not persist session.' });
      }
      // The username rides back with the result, as routes/davinciSdkLogin.js
      // does: GET /api/auth/me looks the user up by the token's sub and is not
      // guaranteed to find this record, so the page must not ask it.
      return res.json({ ok: true, username: user.username || null });
    });
  });
}

// Mints a DaVinci SDK token for one widget run (davinci.skRenderScreen's
// config.accessToken). The DaVinci API key is a secret and MUST stay
// server-side, so the widget config is assembled here rather than in the
// bundle. The nonce goes into `parameters` — the flow declares it in its Input
// Schema and its final node copies it into the ID token's nonce claim, which
// /widget-session verifies. It is deliberately NOT returned to the caller: the
// browser never needs it and cannot tamper with what it never sees.
router.post('/sdk-token', async (req, res) => {
  // Optional in the flow's Input Schema: the flow's own Sign On screen collects
  // it, so the widget page no longer does. Validated here rather than passed
  // through: this is the trust boundary, and an object or a huge string would
  // go straight into the upstream call.
  const rawUsername = (req.body || {}).username;
  if (rawUsername !== undefined && typeof rawUsername !== 'string') {
    return res.status(400).json({ error: 'invalid_request', message: 'username must be a string.' });
  }
  const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
  if (username.length > 320) {
    return res.status(400).json({ error: 'invalid_request', message: 'username is too long.' });
  }

  const { companyId, apiKey, policyIdV1, policyIdV2 } = davinciConfig.login;
  const version = configStore.getEffective('davinci_login_flow_version') || 'v1';
  const policyId = version === 'v2' ? policyIdV2 : policyIdV1;

  // Name the specific gap: a blanket "set these three" cannot distinguish a
  // missing .env entry from a vaulted secret that never reached configStore,
  // and the two have completely different fixes.
  const missing = [
    !companyId && 'PINGONE_DAVINCI_LOGIN_COMPANY_ID (.env)',
    !policyId && `PINGONE_DAVINCI_LOGIN_POLICY_ID_${version.toUpperCase()} (.env)`,
    !apiKey && 'PINGONE_DAVINCI_API_KEY (vault)',
  ].filter(Boolean);
  if (missing.length) {
    return res.status(503).json({
      error: 'davinci_not_configured',
      message: `DaVinci login is not configured — missing: ${missing.join(', ')}.`,
    });
  }

  armLoginNonce(req, async (err, nonce) => {
    if (err) {
      console.error('[davinci-login/sdk-token] Session save FAILED:', err.message);
      return res.status(500).json({ error: 'session_save_failed', message: 'Could not persist nonce.' });
    }
    try {
      // `username` is optional in the flow's Input Schema — only send it when
      // supplied, since DaVinci rejects any undeclared property with "data has
      // additional properties" for anything NOT declared, but an empty string
      // for an optional field is a value, not an omission.
      const parameters = username ? { nonce, username } : { nonce };
      const { data } = await axios.post(
        `${ORCHESTRATE_BASE}/company/${companyId}/sdktoken`,
        { policyId, parameters },
        { headers: { 'X-SK-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: 10_000 }
      );
      if (!data || !data.access_token) {
        console.error('[davinci-login/sdk-token] DaVinci returned no access_token');
        return res.status(502).json({ error: 'davinci_sdk_token_failed', message: 'DaVinci did not return an SDK token.' });
      }
      // Everything here is non-secret widget config; neither the API key nor
      // the nonce is among it.
      return res.json({
        accessToken: data.access_token,
        companyId,
        policyId,
        flowVersion: version,
        apiRoot: `${new URL(getDiscoveryEndpoint()).origin}/`,
      });
    } catch (e) {
      const normalized = normalizeAxiosError(e, { label: 'DaVinci SDK token', timeoutMs: 10_000 });
      return res.status(normalized.httpStatus).json({ error: 'davinci_sdk_token_failed', message: normalized.message });
    }
  });
});

// POST /api/davinci-login/widget-session   { idToken, accessToken }
//
// The flow's "Return Success Response (Widget Flows)" node returned these to
// the page, so they crossed the browser and nothing about them is trusted until
// checked here: both signatures against PingOne's JWKS, the ID token issued to
// this app and echoing the nonce this session armed, the access token issued
// for this API, and both naming the same user.
router.post('/widget-session', async (req, res) => {
  const { idToken, accessToken } = req.body || {};
  if (typeof idToken !== 'string' || typeof accessToken !== 'string' || !idToken || !accessToken) {
    return res.status(400).json({ error: 'invalid_request', message: 'idToken and accessToken are required.' });
  }
  // Trust-boundary cap: anything longer is not a real PingOne token.
  if (idToken.length > 16_384 || accessToken.length > 16_384) {
    return res.status(400).json({ error: 'invalid_request', message: 'idToken or accessToken is too long.' });
  }

  // Single-use: consumed before any check, so a rejected attempt cannot retry
  // against the same value.
  const expectedNonce = req.session.davinciLoginNonce;
  delete req.session.davinciLoginNonce;
  if (!expectedNonce) {
    return res.status(401).json({ error: 'nonce_missing', message: 'No login flow was started in this session. Restart the sign-in.' });
  }

  try {
    const [id, access] = await Promise.all([
      tokenVerificationService.verifyExchangedToken(idToken),
      tokenVerificationService.verifyExchangedToken(accessToken),
    ]);
    // verifyExchangedToken fails OPEN by default (verified:false, no throw), and
    // its introspection fallback reports verified:true with claims that carry no
    // nonce or ID-token audience. Only a JWKS-verified signature counts here.
    const jwksVerified = (r) => r.verified === true && r.fallbackMethod === 'jwks';
    if (!jwksVerified(id) || !jwksVerified(access)) {
      console.error('[davinci-login/widget-session] token not verified: %s',
        id.error || id.warning || access.error || access.warning || 'not JWKS-verified');
      return res.status(401).json({ error: 'token_unverified', message: 'Sign-in tokens failed verification. Restart the sign-in.' });
    }
    const idClaims = id.claims;
    const atClaims = access.claims;
    const audiences = (claims) => [].concat(claims.aud || []);

    // OIDC Core §3.1.3.7: the nonce this session armed MUST come back. Missing
    // or mismatched = possible replayed/substituted token — fail, never
    // warn-and-proceed (same rule as routes/oauthUser.js post-#2043).
    if (idClaims.nonce !== expectedNonce) {
      console.error('[davinci-login/widget-session] ID token nonce %s — possible replay', idClaims.nonce ? 'mismatch' : 'missing');
      return res.status(401).json({ error: idClaims.nonce ? 'nonce_mismatch' : 'nonce_missing', message: 'ID token failed replay verification. Restart the sign-in.' });
    }
    const clientId = oauthService.config?.clientId;
    if (!clientId || !audiences(idClaims).includes(clientId)) {
      return res.status(401).json({ error: 'audience_mismatch', message: 'The ID token was not issued to this app.' });
    }
    // middleware/auth.js rejects any other audience on every later call, so a
    // mismatch here would sign the user in to a session that cannot be used.
    // Same env names it reads; unset means unenforced there too.
    const bffAudience = process.env.PINGONE_RESOURCE_BFF_URI || process.env.ENDUSER_AUDIENCE;
    if (bffAudience && !audiences(atClaims).includes(bffAudience)) {
      return res.status(401).json({ error: 'audience_mismatch', message: 'The access token was not issued for this API.' });
    }
    if (!idClaims.sub || idClaims.sub !== atClaims.sub) {
      return res.status(401).json({ error: 'subject_mismatch', message: 'The sign-in tokens name different users.' });
    }

    // The widget returns no refresh token, so the session lasts as long as the
    // access token does.
    await establishSession(req, res, {
      accessToken,
      idToken,
      refreshToken: null,
      expiresAt: atClaims.exp * 1000,
      tokenType: 'Bearer',
      scope: atClaims.scope || null,
    }, 'widget-session');
  } catch (err) {
    const normalized = normalizeAxiosError(err, { label: 'DaVinci widget session' });
    const status = Number.isInteger(normalized.httpStatus) ? normalized.httpStatus : 502;
    return res.status(status).json({ error: 'davinci_widget_session_failed', message: normalized.message });
  }
});

// POST /api/davinci-login/callback   { code, codeVerifier, redirectUri }
//
// For a client that runs its own PKCE and redirect. The widget page does not
// use it (see /widget-session).
router.post('/callback', async (req, res) => {
  const { code, codeVerifier, redirectUri } = req.body || {};
  if (!code || !codeVerifier || !redirectUri) {
    return res.status(400).json({ error: 'invalid_request', message: 'code, codeVerifier, and redirectUri are required.' });
  }

  // Nonce is single-use: read-and-delete before the exchange so a failed
  // attempt can't retry against the same value (mirrors routes/oauth.js).
  const expectedNonce = req.session.davinciLoginNonce;
  delete req.session.davinciLoginNonce;
  if (!expectedNonce) {
    return res.status(401).json({ error: 'nonce_missing', message: 'No login flow was started in this session. Restart the sign-in.' });
  }

  try {
    // Raw PingOne token response (snake_case) — see oauthService.exchangeCodeForToken,
    // which does `return tokenResponse.data;`. No `.claims` property exists on this.
    const tokenData = await oauthService.exchangeCodeForToken(code, codeVerifier, redirectUri);

    // OIDC Core §3.1.3.7: we sent a nonce on the authorize request, so the ID
    // token MUST carry the same one back. Missing or mismatched = possible
    // replayed/substituted token — fail, never warn-and-proceed (same rule as
    // routes/oauthUser.js post-#2043).
    let idNonce = null;
    try {
      idNonce = JSON.parse(Buffer.from(String(tokenData.id_token || '').split('.')[1] || '', 'base64url').toString()).nonce || null;
    } catch (_) { /* unparseable ID token → idNonce stays null → rejected below */ }
    if (idNonce !== expectedNonce) {
      console.error('[davinci-login/callback] ID token nonce %s — possible replay', idNonce ? 'mismatch' : 'missing');
      return res.status(401).json({ error: idNonce ? 'nonce_mismatch' : 'nonce_missing', message: 'ID token failed replay verification. Restart the sign-in.' });
    }

    await establishSession(req, res, {
      accessToken: tokenData.access_token,
      idToken: tokenData.id_token || null,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      tokenType: tokenData.token_type || 'Bearer',
      scope: tokenData.scope || null,
    }, 'callback');
  } catch (err) {
    const normalized = normalizeAxiosError(err, { label: 'DaVinci login token exchange' });
    return res.status(normalized.httpStatus).json({ error: 'davinci_login_exchange_failed', message: normalized.message });
  }
});

module.exports = router;
