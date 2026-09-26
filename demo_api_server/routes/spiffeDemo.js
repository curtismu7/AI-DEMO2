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
const mockSpiffeWorkloadApi = require('../services/mockSpiffeWorkloadApi');

const TRUST_DOMAIN = spiffeTrustDomain.TRUST_DOMAIN;

const DEMO_REGISTRATIONS = [
  {
    workloadId: 'api',
    spiffeId: `spiffe://${TRUST_DOMAIN}/service/api`,
    selectors: { namespace: 'demo', serviceAccount: 'api' },
  },
  {
    workloadId: 'mcp-gateway',
    spiffeId: `spiffe://${TRUST_DOMAIN}/service/mcp-gateway`,
    selectors: { namespace: 'demo', serviceAccount: 'mcp-gateway' },
  },
  {
    workloadId: 'authz-server',
    spiffeId: `spiffe://${TRUST_DOMAIN}/service/authz-server`,
    selectors: { namespace: 'demo', serviceAccount: 'authz-server' },
  },
];

DEMO_REGISTRATIONS.forEach((registration) => {
  mockSpiffeWorkloadApi.registerWorkload(registration);
});

/**
 * Demo workload requests a JWT-SVID from the local mock issuer using its
 * registered workload ID and matching selectors. This P1 flow performs no
 * runtime workload attestation.
 *
 * @flow spiffe
 * @name SPIFFE
 * @rfc https://datatracker.ietf.org/doc/html/draft-ietf-oauth-spiffe-bearer-token-09 SPIFFE Bearer Token
 * @why Real SPIFFE uses workload attestation to issue short-lived identities without distributing long-lived secrets. This P1 demo instead uses a local mock issuer that accepts only registered workload IDs with matching selector values; it does not attest the caller at runtime.
 * @example The demo is like a training badge desk that checks a requested name and department against a registration list before issuing a short-lived badge. The supplied selectors must match, but the desk does not independently inspect or attest the workload presenting them.
 * @ai Agent fleets benefit from short-lived workload identities and cryptographic verification. This P1 flow demonstrates those token and trust checks with a local mock issuer and registered selectors, not runtime workload attestation.
 * @actor workload-a
 * @to local-mock-issuer
 * @step 1
 * @body {"workload_id":"api","selector_context":{"namespace":"demo","serviceAccount":"api"}}
 */
router.post('/svid', express.json(), (req, res) => {
  const { workload_id, selector_context, audience } = req.body || {};
  const hasValidWorkloadId = typeof workload_id === 'string' && workload_id.length > 0;
  const hasValidSelectors = selector_context
    && typeof selector_context === 'object'
    && !Array.isArray(selector_context)
    && Object.keys(selector_context).length > 0
    && Object.values(selector_context).every((value) => (
      typeof value === 'string' && value.trim().length > 0
    ));
  const hasValidAudience = audience === undefined
    || (typeof audience === 'string' && audience.length > 0);
  if (!hasValidWorkloadId || !hasValidSelectors || !hasValidAudience) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'workload_id and selector_context are required; audience must be a non-empty string when provided',
    });
  }

  let svid;
  try {
    svid = mockSpiffeWorkloadApi.issueJwtSvid({
      workloadId: workload_id,
      selectorContext: selector_context,
      audience,
    });
  } catch (err) {
    if (err instanceof mockSpiffeWorkloadApi.WorkloadNotAuthorizedError) {
      return res.status(403).json({ error: 'workload_not_authorized' });
    }
    throw err;
  }

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

/**
 * LIVE PingFederate exchange with a real SPIRE JWT-SVID as actor_token.
 *
 * Distinct from the mock playground above: this requires the opt-in
 * `spiffe` Docker compose profile (real SPIRE server + agent + helper) and
 * PingFederate 13 with the SPIRE JWT Token Processor 2.0 configured
 * (see spiffe/pingfederate/). Gated by ff_spiffe_pf_exchange; off by default
 * so the demo stack behaves exactly as before.
 */
router.post('/pingfederate/exchange', express.json(), async (req, res) => {
  try {
    const result = await require('../services/spiffePingfederateService').exchangeWithPingFederate({
      audience: req.body?.audience,
      scopes: req.body?.scopes,
    });
    // The access token itself is returned for inspection in the playground;
    // it is short-lived and minted for the demo audience.
    res.json({
      exchange: 'pingfederate-spiffe-actor',
      spiffe_id: result.spiffeId,
      actor_issuer: result.issuer,
      access_token: result.accessToken,
    });
  } catch (err) {
    if (err.isConfigError) {
      return res.status(err.httpStatus || 503).json({ error: 'spiffe_pf_unavailable', error_description: err.message, details: err.details });
    }
    return res.status(502).json({ error: 'spiffe_pf_exchange_failed', error_description: err.message });
  }
});

module.exports = router;
