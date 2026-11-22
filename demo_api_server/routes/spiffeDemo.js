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
const rateLimit = require('express-rate-limit');
const { requireSession } = require('../middleware/auth');
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

// This route mints a JWT-SVID / PingFederate token and forwards it to the Privilege gateway, so it
// needs a signed-in session (checked before the limiter, so anonymous traffic cannot use up a per-IP
// bucket that signed-in users share) and the caller may not choose where it goes or what it asks for.
// These are the values SpiffePrivilegePage.jsx sends (tests/spiffePrivilegeCallRoute.test.js reads the
// page source and fails if they drift); omitted fields keep the service defaults.
const PRIVILEGE_CALL_ALLOWED = {
  resources: ['/spire-mcp/mcp'],
  audience: 'priv-nhi-l5hp7w677rxl3somiehznpomuyxxlhdr',
  scopes: ['mcp:invoke'],
  methods: ['tools/list'],
};

const privilegeCallLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Per signed-in user (requireSession runs first, so the id is always set). Keying on IP would put
  // everyone behind the SE-cluster ingress or a shared NAT in one bucket (`trust proxy` is 1).
  // 60 stays well above what a page run needs (3 shapes).
  max: 60,
  keyGenerator: (req) => (req.session.user.id ? `user:${req.session.user.id}` : `ip:${req.ip}`),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => ['1', 'true', 'yes'].includes(String(process.env.DISABLE_RATE_LIMIT || '').toLowerCase()),
  message: { error: 'rate_limit_exceeded', error_description: 'Too many calls. Try again in a minute.' },
});

/** Returns the field name of the first caller-chosen value that is not allowed, or null. */
function disallowedPrivilegeCallField(b) {
  if (b.resource !== undefined && !PRIVILEGE_CALL_ALLOWED.resources.includes(b.resource)) return 'resource';
  if (b.audience !== undefined && b.audience !== PRIVILEGE_CALL_ALLOWED.audience) return 'audience';
  if (b.scopes !== undefined
    && !(Array.isArray(b.scopes) && b.scopes.length > 0 && b.scopes.every((s) => PRIVILEGE_CALL_ALLOWED.scopes.includes(s)))) return 'scopes';
  if (b.mcp_method !== undefined && !PRIVILEGE_CALL_ALLOWED.methods.includes(b.mcp_method)) return 'mcp_method';
  return null;
}

/**
 * LIVE Privilege gateway call with a SPIFFE workload identity as the only
 * credential. Complements /pingfederate/exchange above: that one proves PF
 * accepts an SVID in token exchange; this one proves (or measures) whether
 * the Privilege gateway's Non-Human Identity / Pass Agent Token path accepts
 * SPIFFE-issued identity. Three token shapes are comparable; see
 * services/spiffePrivilegeService.js. Gated by ff_spiffe_privilege; off by
 * default. The access token is returned for playground inspection only.
 *
 * @flow spiffe
 * @name SPIFFE
 * @actor workforce-agent
 * @to privilege-gateway
 * @step 3
 * @body {"token_mode":"raw-svid"}
 * @why The Privilege gateway's federated-identity path verifies a caller's JWT against a registered issuer's JWKS — the same contract a SPIRE JWT-SVID satisfies — so an agent's workload identity can be the only credential it presents.
 * @example Like a building whose door reader accepts a badge from a visitor's own company, after checking that company's published key list — no lobby-issued badge needed.
 * @ai Agents get short-lived, attested workload identities instead of static secrets; the gateway decides what the identity may do without minting or storing a key for it.
 */
router.post('/privilege/call', requireSession, privilegeCallLimiter, express.json(), async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const bad = disallowedPrivilegeCallField(body);
  if (bad) {
    return res.status(400).json({ error: 'invalid_request', error_description: `${bad} is not an allowed value for this demo call` });
  }
  try {
    const result = await require('../services/spiffePrivilegeService').callPrivilegeWithWorkloadIdentity({
      tokenMode: body.token_mode,
      resource: body.resource,
      mcpMethod: body.mcp_method,
      audience: body.audience,
      scopes: body.scopes,
    });
    res.json({
      call: 'spiffe-privilege-workload-identity',
      token_mode: result.tokenMode,
      issuer: result.issuer,
      claims: result.claims,
      gateway: {
        url: result.gatewayUrl,
        status: result.gatewayStatus,
        body: result.gatewayBody,
      },
      access_token: result.token,
    });
  } catch (err) {
    if (err.isConfigError) {
      return res.status(err.httpStatus || 503).json({ error: 'spiffe_privilege_unavailable', error_description: err.message, details: err.details });
    }
    return res.status(502).json({ error: 'spiffe_privilege_call_failed', error_description: err.message });
  }
});

module.exports = router;
