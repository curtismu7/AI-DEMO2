'use strict';
/**
 * /api/path/apikey-info — Phase 266 R2 Path A info-page endpoint.
 *
 * Path A is the only path that terminates at the Gateway (no backend call).
 * The SPA fetches this route after the gateway returns an API_KEY_PATH_MARKER
 * response, to render the masked api-key + explanation on the info page.
 *
 * Path B is no longer served by this file — the SPA fetches
 * /api/resource-server/identity directly (Plan 02 Task 2 added that route to
 * resourceServer.js). There is NO /api/path/dualtoken-info route.
 *
 * Per CONTEXT.md R2 §Path A: masked api-key (last 4 chars only), NO banking
 * data, NO raw JWT. Response passes through scrubRawJwts as defense-in-depth.
 *
 * Per CLAUDE.md token custody: tokens never reach the browser.
 */
const express = require('express');
const router = express.Router();
const { scrubRawJwts } = require('../services/jwtScrubber');
const configStore = require('../services/configStore');

/**
 * Thin auth guard using the session cookie (BFF-side).
 * The SPA uses bffAxios (cookie-based) — no Bearer token on this path.
 */
function requireAuth(req, res, next) {
  if (
    !req.session ||
    !req.session.oauthTokens ||
    !req.session.oauthTokens.accessToken
  ) {
    return res.status(401).json({ error: 'authentication_required' });
  }
  next();
}

/**
 * GET /api/path/apikey-info
 * Returns masked api-key info for the Path A info page.
 * No banking data, no raw JWT.
 */
router.get('/apikey-info', requireAuth, (req, res) => {
  const key  = configStore.getEffective('demo_apikey_backend_service_key') || '';
  const last4 = key.length >= 4 ? key.slice(-4) : 'XXXX';
  const body = {
    credentialPath: 'api_key',
    badge: 'API-KEY PATH',
    color: 'amber',
    apiKeyMaskedLast4: last4,
    message:
      'This request was sent through the Gateway api-key path. ' +
      'The Gateway exchanged your OAuth token for a service API key. ' +
      'No banking data is returned on this path — it demonstrates the credential-swap pattern.',
    returnTo: '/dashboard',
    returnLabel: 'Back to Dashboard',
  };
  return res.json(scrubRawJwts(body));
});

module.exports = router;
