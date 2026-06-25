const express = require('express');
const router = express.Router();
const oauthService = require('../services/oauthService');
const tester = require('../services/resourceServerTesterService');
const { scrubRawJwts } = require('../services/jwtScrubber');

/**
 * Routes for the Client Credentials variant of the Resource Server Tester.
 * Mounted at /api/resource-server-cc/test, gated by authenticateToken (any authenticated
 * user — matching the CC summary route, which is a teaching demo open to all logged-in
 * users; the machine token is fetched server-side, not the caller's own).
 *
 * Token under test resolution:
 *   - tokenRaw (pasted JWT) → used as-is
 *   - otherwise → a Client Credentials token fetched server-side (the same M2M token the
 *     /summary page demonstrates). Never returned to the browser, only its verdict/claims.
 *
 * Validation reuses resourceServerTesterService — the SAME banking resource server rules.
 * A CC token typically REJECTs here (no user-delegated scope, different audience), which is
 * the intended teaching contrast with the user-delegated OIDC path.
 */

/** Resolve the token under test: a pasted JWT, else a server-fetched CC token. */
async function getToken(req, res) {
  const tokenRaw = req.body && req.body.tokenRaw;
  if (typeof tokenRaw === 'string' && tokenRaw.trim()) {
    return tokenRaw.trim();
  }
  try {
    return await oauthService.getAgentClientCredentialsToken();
  } catch (err) {
    res.status(502).json({
      error: 'cc_token_unavailable',
      message: `Could not fetch a Client Credentials token: ${err.message}`,
    });
    return null;
  }
}

/**
 * Shared handler: resolve the token, run `produce(token, req)` (the per-mode service call),
 * and respond. `badIf` decides which result is a 400 vs 200.
 */
function handle(mode, produce, badIf) {
  return async (req, res) => {
    const token = await getToken(req, res);
    if (!token) return; // getToken already sent 400/502
    try {
      const result = await produce(token, req);
      return res.status(badIf(result) ? 400 : 200).json(scrubRawJwts(result));
    } catch (err) {
      console.error(`[resource-server-tester-cc] ${mode} error:`, err.message);
      return res.status(500).json({ error: 'internal_error', message: `${mode} failed unexpectedly.` });
    }
  };
}

router.post('/validate', handle('validate', (t) => tester.validate(t), (r) => !!r.error));
router.post('/decode', handle('decode', (t) => tester.decode(t), (r) => !!r.error));
router.post('/probe', handle('probe', (t, req) => tester.probe(t, req.body && req.body.targetPath), (r) => r.error === 'invalid_target'));

// POST /api/resource-server-cc/test/reveal — show the raw token under test + decoded claims.
// Deliberately NOT scrubbed (unlike validate/decode/probe above): surfacing the raw JWT is
// the whole point of this teaching panel. Labels the token 'cc' (server-fetched machine
// token) or 'pasted'.
router.post('/reveal', async (req, res) => {
  const token = await getToken(req, res);
  if (!token) return; // getToken already sent 502
  const source = (typeof req.body?.tokenRaw === 'string' && req.body.tokenRaw.trim()) ? 'pasted' : 'cc';
  try {
    const result = tester.reveal(token, source);
    if (result.error) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    console.error('[resource-server-tester-cc] reveal error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: 'Reveal failed unexpectedly.' });
  }
});

module.exports = router;
