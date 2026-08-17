// Backend half of the DaVinci widget login demo (/davinci-login). The widget
// completes the flow entirely client-side down to a standard OIDC code; this
// route exchanges it exactly the way routes/oauth.js's redirect callback does,
// reusing oauthService so the resulting session is indistinguishable from a
// normal login. Does not touch routes/oauth.js (REGRESSION_PLAN §1).
'use strict';
const express = require('express');
const oauthService = require('../services/oauthService');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const router = express.Router();

router.post('/callback', async (req, res) => {
  const { code, codeVerifier, redirectUri } = req.body || {};
  if (!code || !codeVerifier || !redirectUri) {
    return res.status(400).json({ error: 'invalid_request', message: 'code, codeVerifier, and redirectUri are required.' });
  }

  try {
    const tokens = await oauthService.exchangeCodeForToken(code, codeVerifier, redirectUri);
    req.session.oauthTokens = {
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      expiresAt: tokens.expiresAt,
    };
    req.session.user = {
      id: tokens.claims?.sub,
      username: tokens.claims?.preferred_username,
    };
    return res.json({ ok: true });
  } catch (err) {
    const normalized = normalizeAxiosError(err, { label: 'DaVinci login token exchange' });
    return res.status(normalized.httpStatus).json({ error: 'davinci_login_exchange_failed', message: normalized.message });
  }
});

module.exports = router;
