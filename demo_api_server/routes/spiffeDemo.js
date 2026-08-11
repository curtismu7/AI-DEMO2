'use strict';

/**
 * SPIFFE demo routes — self-contained mock, illustrative only.
 *
 * Real SPIFFE issues SVIDs over a local Workload API (typically a Unix
 * domain socket) and workloads present them via mTLS — there is no bearer
 * HTTP call in production SPIFFE, and PingOne does not run a SPIFFE
 * Workload API at all. This simulates the claim shape (trust domain,
 * SPIFFE ID, short-lived SVID) as two HTTP steps purely so the playground
 * can show what a workload receives and what a peer checks — not as a
 * model of how SPIFFE is actually transported.
 */
const express = require('express');
const router = express.Router();
const { mintDemoJwt, decodeDemoJwt } = require('../utils/demoJwt');

const TRUST_DOMAIN = 'demo.local';

/**
 * Workload fetches its JWT-SVID from the (simulated) SPIRE agent.
 *
 * @flow spiffe
 * @name SPIFFE
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
  const svid = mintDemoJwt({
    sub: spiffe_id,
    iss: `spire-demo://${TRUST_DOMAIN}`,
    aud: [TRUST_DOMAIN],
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  res.json({ svid, svid_type: 'jwt-svid', trust_domain: TRUST_DOMAIN });
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
  const claims = decodeDemoJwt(svid);
  const peerTrustDomain = claims?.sub ? String(claims.sub).split('/')[2] : null;
  const valid = !!claims && peerTrustDomain === expected_trust_domain;
  res.json({ valid, peer_spiffe_id: claims?.sub || null });
});

module.exports = router;
