'use strict';

/**
 * DPoP (RFC 9449) demo routes — self-contained mock, no PingOne dependency.
 *
 * The real /api/auth/oauth/token + /api/auth/gateway/verify-dpop routes
 * (routes/dpopRequest.js) require a `DPoP` proof HEADER, which the protocol
 * playground's execution engine (services/executionEngine.js) has no way to
 * populate from a static @body annotation. This mirrors the same mechanics
 * — dpop_proof in, access_token out; access_token + same dpop_proof in,
 * verified out — as plain POST/JSON body fields instead, matching PKCE's
 * pattern so the playground can execute it end to end.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Deterministic function of the proof — no shared state between steps. */
function deriveToken(dpopProof) {
  return base64url(crypto.createHash('sha256').update(String(dpopProof)).digest()).slice(0, 32);
}

/**
 * Request an access token with a DPoP proof. Client sends a DPoP proof to
 * bind the token to a specific key pair.
 *
 * @flow dpop
 * @name DPoP
 * @rfc https://datatracker.ietf.org/doc/html/rfc9449 RFC 9449
 * @why DPoP (Demonstrating Proof of Possession) fixes the bearer-token problem: a plain bearer token is like cash — whoever holds it can spend it. DPoP binds the access token to a private key the client keeps, and every API call must carry a fresh proof signed with that key, so the token alone is worthless to anyone who steals it.
 * @example An access token leaks through a logging pipeline or a compromised proxy. Against a DPoP-protected API the replay fails: the attacker has the token but cannot produce the signed proof, because the private key never left the legitimate client.
 * @ai Agent tokens pass through many hands — queues, tool servers, traces, logs. Sender-constraining them means an exfiltrated token from any of those hops cannot be replayed by whoever finds it.
 * @actor client-app
 * @to gateway
 * @step 1
 * @body {"dpop_proof":"demo-dpop-proof-9f8a7b6c5d4e3f2a"}
 */
router.post('/token', express.json(), (req, res) => {
  const { dpop_proof } = req.body || {};
  if (!dpop_proof) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'dpop_proof is required' });
  }
  res.json({ access_token: deriveToken(dpop_proof), token_type: 'DPoP', expires_in: 3600 });
});

/**
 * Verify DPoP proof on gateway. Gateway validates that the DPoP proof is
 * valid and matches the token being used.
 *
 * @flow dpop
 * @actor gateway
 * @to client-app
 * @step 2
 * @body {"access_token":":access_token","dpop_proof":"demo-dpop-proof-9f8a7b6c5d4e3f2a"}
 */
router.post('/verify-dpop', express.json(), (req, res) => {
  const { access_token, dpop_proof } = req.body || {};
  if (!access_token || !dpop_proof) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'access_token and dpop_proof are required' });
  }
  if (deriveToken(dpop_proof) !== access_token) {
    return res.status(400).json({ error: 'invalid_dpop_proof', error_description: 'dpop_proof does not match the access_token it bound' });
  }
  res.json({ valid: true, reason: 'DPoP proof verified', token_thumbprint: base64url(crypto.createHash('sha256').update(String(dpop_proof)).digest()).slice(0, 16) });
});

module.exports = router;
