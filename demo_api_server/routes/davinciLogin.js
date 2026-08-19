// Backend half of the DaVinci widget login demo (/davinci-login). The widget
// completes the flow entirely client-side down to a standard OIDC code; this
// route exchanges it the way routes/oauthUser.js's end-user callback does
// (NOT routes/oauth.js — that flow auto-creates admin accounts, which is
// wrong for this sandbox), reusing oauthService so the resulting session is
// indistinguishable from a normal login. Does not touch routes/oauth.js or
// routes/oauthUser.js (REGRESSION_PLAN §1).
'use strict';
const crypto = require('crypto');
const express = require('express');
const oauthService = require('../services/oauthService');
const dataStore = require('../data/store');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const router = express.Router();

// Issues the OIDC nonce for one widget flow run. The UI passes it into
// client.start({ query: { nonce } }) — @forgerock/davinci-client merges
// StartOptions.query into the /authorize URL, so PingOne echoes it in the ID
// token — and /callback below verifies the echo against this session.
router.post('/nonce', (req, res) => {
  const nonce = crypto.randomBytes(16).toString('hex');
  req.session.davinciLoginNonce = nonce;
  req.session.save((err) => {
    if (err) {
      console.error('[davinci-login/nonce] Session save FAILED:', err.message);
      return res.status(500).json({ error: 'session_save_failed', message: 'Could not persist nonce.' });
    }
    return res.json({ nonce });
  });
});

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

    const userInfo = await oauthService.getUserInfo(tokenData.access_token);
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
        console.error('[davinci-login/callback] Session regenerate FAILED — aborting login:', regenErr.message);
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
          console.error('[davinci-login/callback] Session save FAILED:', saveErr.message);
          return res.status(500).json({ error: 'session_save_failed', message: 'Could not persist session.' });
        }
        return res.json({ ok: true });
      });
    });
  } catch (err) {
    const normalized = normalizeAxiosError(err, { label: 'DaVinci login token exchange' });
    return res.status(normalized.httpStatus).json({ error: 'davinci_login_exchange_failed', message: normalized.message });
  }
});

module.exports = router;
