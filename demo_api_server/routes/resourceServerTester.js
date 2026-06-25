const express = require('express');
const router = express.Router();
const tester = require('../services/resourceServerTesterService');
const { scrubRawJwts } = require('../services/jwtScrubber');

/**
 * Routes for the interactive Resource Server Tester panel.
 * Mounted at /api/resource-server/test, gated by authenticateToken (session required).
 * The token under test rides in the request body — never in the Authorization header.
 */

const RESOLVE_ERRORS = {
  missing_token: 'Provide a token: pick a session token or paste a JWT.',
  invalid_token_ref: 'Unknown token reference. Use "access" or "id", or paste a JWT.',
  token_not_in_session: 'That token is not present in your session. Sign in again or paste a JWT.',
};

/** Resolve the token under test, sending a 400 if it cannot be resolved. */
function getToken(req, res) {
  const { tokenRef, tokenRaw } = req.body || {};
  const r = tester.resolveToken({ tokenRef, tokenRaw }, req.session);
  if (r.error) {
    res.status(400).json({ error: r.error, message: RESOLVE_ERRORS[r.error] || 'Could not resolve token.' });
    return null;
  }
  return r.token;
}

// POST /api/resource-server/test/reveal — show the raw token under test + decoded claims.
// Deliberately NOT scrubbed with scrubRawJwts: surfacing the raw JWT and naming which token
// it is (session access / ID / pasted) is the whole point of this teaching panel.
router.post('/reveal', (req, res) => {
  // Calls resolveToken directly rather than getToken() because reveal also needs r.source
  // (getToken returns only the token) to label which token is under test.
  const { tokenRef, tokenRaw } = req.body || {};
  const r = tester.resolveToken({ tokenRef, tokenRaw }, req.session);
  if (r.error) {
    return res.status(400).json({ error: r.error, message: RESOLVE_ERRORS[r.error] || 'Could not resolve token.' });
  }
  try {
    const result = tester.reveal(r.token, r.source);
    if (result.error) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    console.error('[resource-server-tester] reveal error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: 'Reveal failed unexpectedly.' });
  }
});

// POST /api/resource-server/test/validate — real RS validation (signature + claims).
router.post('/validate', async (req, res) => {
  const token = getToken(req, res);
  if (!token) return;
  try {
    const result = await tester.validate(token);
    if (result.error) return res.status(400).json(scrubRawJwts(result));
    return res.json(scrubRawJwts(result));
  } catch (err) {
    console.error('[resource-server-tester] validate error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: 'Validation failed unexpectedly.' });
  }
});

// POST /api/resource-server/test/decode — decode + policy check (no signature).
router.post('/decode', (req, res) => {
  const token = getToken(req, res);
  if (!token) return;
  try {
    const result = tester.decode(token);
    if (result.error) return res.status(400).json(scrubRawJwts(result));
    return res.json(scrubRawJwts(result));
  } catch (err) {
    console.error('[resource-server-tester] decode error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: 'Decode failed unexpectedly.' });
  }
});

// POST /api/resource-server/test/probe — live request probe (real loopback HTTP call).
router.post('/probe', async (req, res) => {
  const token = getToken(req, res);
  if (!token) return;
  const { targetPath } = req.body || {};
  try {
    const result = await tester.probe(token, targetPath);
    if (result.error === 'invalid_target') return res.status(400).json(scrubRawJwts(result));
    return res.json(scrubRawJwts(result));
  } catch (err) {
    console.error('[resource-server-tester] probe error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: 'Probe failed unexpectedly.' });
  }
});

module.exports = router;
