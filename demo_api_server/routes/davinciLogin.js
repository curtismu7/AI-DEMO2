// Backend half of the DaVinci widget login demo (/davinci-login). The widget
// completes the flow entirely client-side down to a standard OIDC code; this
// route exchanges it the way routes/oauthUser.js's end-user callback does
// (NOT routes/oauth.js — that flow auto-creates admin accounts, which is
// wrong for this sandbox), reusing oauthService so the resulting session is
// indistinguishable from a normal login. Does not touch routes/oauth.js or
// routes/oauthUser.js (REGRESSION_PLAN §1).
'use strict';
const express = require('express');
const oauthService = require('../services/oauthService');
const dataStore = require('../data/store');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const router = express.Router();

router.post('/callback', async (req, res) => {
  const { code, codeVerifier, redirectUri } = req.body || {};
  if (!code || !codeVerifier || !redirectUri) {
    return res.status(400).json({ error: 'invalid_request', message: 'code, codeVerifier, and redirectUri are required.' });
  }

  try {
    // Raw PingOne token response (snake_case) — see oauthService.exchangeCodeForToken,
    // which does `return tokenResponse.data;`. No `.claims` property exists on this.
    const tokenData = await oauthService.exchangeCodeForToken(code, codeVerifier, redirectUri);

    // NOTE — no nonce/replay verification on the ID token here (unlike routes/oauth.js's
    // nonce check against idPayload.nonce). The @forgerock/davinci-client SDK used by
    // demo_api_ui/src/lib/davinciWidgetClient.js doesn't expose a way to set or round-trip
    // an OIDC nonce through PingOne's DaVinci orchestration (checked README + dist/src —
    // no `nonce` support), so there's nothing to verify against yet without new SDK/widget
    // plumbing. Logged as tech debt in TECH_DEBT.md (2026-08-17 entry); routes/oauth.js's
    // nonce check is the reference pattern for a future fix.
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
