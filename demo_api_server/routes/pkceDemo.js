'use strict';

/**
 * PKCE (RFC 7636) demo routes — self-contained mock, no PingOne dependency.
 *
 * Real admin/customer login already uses PKCE (routes/oauth.js), but that
 * flow is browser-redirect based (302 to PingOne, callback needs a real
 * authorization code) and cannot be scripted step-by-step by the protocol
 * playground's JSON request/response engine. This mirrors the same
 * mechanics — code_challenge in, code out; code_verifier in, token out —
 * as plain POST/JSON so the playground can execute it end to end.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { mintDemoJwt } = require('../utils/demoJwt');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Deterministic function of the challenge — no shared state between steps. */
function deriveCode(codeChallenge) {
  return base64url(crypto.createHash('sha256').update(String(codeChallenge)).digest()).slice(0, 16);
}

/**
 * Client sends its PKCE code_challenge to obtain an authorization code.
 *
 * @flow pkce
 * @name PKCE
 * @actor client-app
 * @to auth-server
 * @step 1
 * @body {"code_challenge":"ewuOoauAc4HDP26uT55nbd_OX32mHAsIb1VtknVbfv8","code_challenge_method":"S256"}
 */
router.post('/authorize', express.json(), (req, res) => {
  const { code_challenge, code_challenge_method } = req.body || {};
  if (!code_challenge || code_challenge_method !== 'S256') {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'code_challenge and code_challenge_method=S256 are required',
    });
  }
  res.json({ code: deriveCode(code_challenge) });
});

/**
 * Client redeems the code with its code_verifier — server recomputes the
 * challenge from the verifier and only issues a token if the derived code
 * matches the one step 1 returned for that challenge.
 *
 * @flow pkce
 * @actor auth-server
 * @to client-app
 * @step 2
 * @body {"code":"vdA2j5Y2ifHKpWEK","code_verifier":"demo-pkce-verifier-9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"}
 */
router.post('/token', express.json(), (req, res) => {
  const { code, code_verifier } = req.body || {};
  if (!code || !code_verifier) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'code and code_verifier are required' });
  }
  const recomputedChallenge = base64url(crypto.createHash('sha256').update(String(code_verifier)).digest());
  if (deriveCode(recomputedChallenge) !== code) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier does not match the code_challenge used to obtain this code' });
  }
  const access_token = mintDemoJwt({
    iss: 'demo-pkce-as',
    sub: 'demo-user',
    aud: 'demo-client',
    scope: 'openid profile',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  res.json({ access_token, token_type: 'Bearer', expires_in: 3600 });
});

module.exports = router;
