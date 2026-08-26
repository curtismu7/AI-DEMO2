'use strict';

/**
 * SPIFFE demo routes.
 *
 * Real SPIFFE issues SVIDs over a local Workload API (typically a Unix
 * domain socket) and workloads present them via mTLS — there is no bearer
 * HTTP call in production SPIFFE, and PingOne does not run a SPIFFE
 * Workload API at all. This simulates the claim shape (trust domain,
 * SPIFFE ID, short-lived SVID) as two HTTP steps purely so the playground
 * can show what a workload receives and what a peer checks — not as a
 * model of how SPIFFE is actually transported.
 *
 * What is simulated is the ISSUER: no SPIRE server, no workload attestation,
 * so holding an SVID here proves nothing about what the caller really is.
 * What is REAL is the cryptography. /verify used to base64-decode the token
 * and check nothing else, so a hand-made `alg: none` token naming any identity
 * was accepted — the endpoint's entire job is to answer "trust this peer?" and
 * it answered yes to anything. Signature, expiry, issuer and SPIFFE-ID are all
 * enforced now; see services/spiffeTrustDomain.js.
 */
const express = require('express');
const router = express.Router();
const spiffeTrustDomain = require('../services/spiffeTrustDomain');

const TRUST_DOMAIN = spiffeTrustDomain.TRUST_DOMAIN;

/**
 * Workload fetches its JWT-SVID from the (simulated) SPIRE agent.
 *
 * @flow spiffe
 * @name SPIFFE
 * @rfc https://datatracker.ietf.org/doc/html/draft-ietf-oauth-spiffe-bearer-token-09 SPIFFE Bearer Token
 * @why SPIFFE gives workloads cryptographic identity from the platform itself: a SPIRE agent attests what the workload is (this pod, this binary, this node) and issues it a short-lived JWT-SVID. No API keys baked into images, no secrets in environment variables, automatic rotation.
 * @example An employee badge issued by building security after checking your employment records — versus a door code taped under the desk. A leaked container image contains no credential worth stealing, because identity is attested at runtime, not stored.
 * @ai Agent fleets scale up and down constantly. Platform-attested identity means each agent instance proves what it is without anyone provisioning or rotating a secret for it.
 * @actor workload-a
 * @to spire-agent
 * @step 1
 * @body {"spiffe_id":"spiffe://demo.local/service/payments"}
 */
router.post('/svid', express.json(), (req, res) => {
  const { spiffe_id } = req.body || {};
  if (!spiffe_id || !spiffe_id.startsWith(`spiffe://${TRUST_DOMAIN}/`)) {
    return res.status(400).json({ error: 'invalid_request', error_description: `spiffe_id must be under trust domain ${TRUST_DOMAIN}` });
  }
  const svid = spiffeTrustDomain.issueSvid(spiffe_id);
  res.json({ svid, svid_type: 'jwt-svid', trust_domain: TRUST_DOMAIN });
});

/**
 * The trust bundle. A peer needs the trust domain's PUBLIC key to check an
 * SVID — publishing it is what makes this a bundle rather than a shared secret.
 * Real SPIRE exposes the equivalent via its OIDC Discovery Provider.
 */
router.get('/jwks', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ keys: [spiffeTrustDomain.publicJwk()] });
});

/**
 * Peer workload validates the presented SVID against the expected trust
 * domain before accepting the call.
 *
 * @flow spiffe
 * @actor workload-b
 * @to workload-a
 * @step 2
 * @body {"svid":"demo.placeholder.svid","expected_trust_domain":"demo.local"}
 */
router.post('/verify', express.json(), (req, res) => {
  const { svid, expected_trust_domain } = req.body || {};
  if (!svid || !expected_trust_domain) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'svid and expected_trust_domain are required' });
  }
  // Cryptographic verification against the trust bundle — signature, expiry,
  // issuer, then the SPIFFE ID's trust domain. A decode-only check here let any
  // hand-made token name any identity.
  const { valid, claims, reason } = spiffeTrustDomain.verifySvid(svid, {
    expectedTrustDomain: expected_trust_domain,
  });

  res.json({
    valid,
    peer_spiffe_id: valid ? claims.sub : null,
    // Surfaced so the playground can show WHY a peer was refused; safe to
    // return because it describes the presented token, not the trust domain key.
    reason,
  });
});

module.exports = router;
