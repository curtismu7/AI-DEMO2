'use strict';

/**
 * spiffeActorToken — verify a JWT-SVID against a SPIFFE trust bundle so it can
 * be presented as `actor_token` in an RFC 8693 exchange.
 *
 * WHY THIS EXISTS HERE. PingOne cloud has no trusted-external-issuer object, so
 * a SPIRE-issued SVID can never be an actor_token there — see docs/SPIFFE_PLAN.md.
 * PingFederate's JWT Token Processor 2.0 CAN do exactly this against SPIRE's
 * OIDC Discovery Provider. This service is the parity mock of PingOne's API
 * surface, so it is the honest place to show that behaviour: the demo line is
 * "PingOne cloud is a closed trust domain; PingFederate can do this, and here
 * is that behaviour", not "we mocked SPIFFE".
 *
 * The bundle is fetched over HTTP rather than shared in-process. That is how a
 * verifier really gets a trust domain's keys, and requiring demo_api_server
 * from this service would be exactly the cross-package coupling the
 * vault-decoupling plan exists to remove.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const TRUST_DOMAIN = process.env.SPIFFE_TRUST_DOMAIN || 'demo.local';
const ISSUER = `spire-demo://${TRUST_DOMAIN}`;
const BUNDLE_URL = process.env.SPIFFE_JWKS_URL
  || 'https://demo-api-server:3001/api/demo/spiffe/jwks';
/** Short enough that a rotated CA key is picked up within a demo, long enough not to hammer. */
const BUNDLE_TTL_MS = 60_000;

let _cache = { keys: null, fetchedAt: 0 };

/** Overridable so tests never touch the network. */
let _fetchBundle = async () => {
  const resp = await axios.get(BUNDLE_URL, {
    timeout: 3000,
    // The BFF serves this over mkcert TLS; this is a demo trust domain, not a
    // production CA, and the bundle is public key material either way.
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
  });
  return resp.data;
};

function _setBundleFetcherForTest(fn) {
  _fetchBundle = fn;
  _cache = { keys: null, fetchedAt: 0 };
}

async function getBundleKeys() {
  const fresh = _cache.keys && (Date.now() - _cache.fetchedAt) < BUNDLE_TTL_MS;
  if (fresh) return _cache.keys;
  const body = await _fetchBundle();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  _cache = { keys, fetchedAt: Date.now() };
  return keys;
}

/** A SPIFFE ID is `spiffe://<trust-domain>/<path>` — the path is required. */
function isSpiffeId(value) {
  return typeof value === 'string' && value.startsWith(`spiffe://${TRUST_DOMAIN}/`);
}

/**
 * Verify a JWT-SVID against the trust bundle.
 *
 * Algorithm is PINNED to RS256, because the bundle is public by design: an
 * unpinned verifier can accept an HS256 token signed with the published public
 * key as the HMAC secret, letting the attacker name any SPIFFE ID they like.
 *
 * Measured honestly: jsonwebtoken v9 already refuses that (it will not use a
 * public KeyObject as an HMAC secret), so removing this pin leaves every test
 * in spiffeActorToken.test.js green. It is defence in depth against a library
 * swap or downgrade, not load-bearing today. Either way, never read the token's
 * own `alg` to decide how to verify it.
 *
 * Fails CLOSED on every path, including an unreachable bundle: no trust
 * bundle means no basis to trust anything, so an outage must not become an
 * accept.
 *
 * @returns {Promise<{ valid: boolean, spiffeId: string|null, reason: string|null }>}
 */
async function verifySvid(svid) {
  let keys;
  try {
    keys = await getBundleKeys();
  } catch (err) {
    return { valid: false, spiffeId: null, reason: `trust bundle unreachable: ${err.message}` };
  }
  if (!keys.length) {
    return { valid: false, spiffeId: null, reason: 'trust bundle empty' };
  }

  for (const jwk of keys) {
    let pub;
    try {
      pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      continue; // malformed key in the bundle — try the next
    }
    try {
      const claims = jwt.verify(svid, pub, { algorithms: ['RS256'], issuer: ISSUER });
      if (!isSpiffeId(claims.sub)) {
        return { valid: false, spiffeId: null, reason: 'sub is not a SPIFFE ID in this trust domain' };
      }
      return { valid: true, spiffeId: claims.sub, reason: null };
    } catch (err) {
      // Wrong key for this token is expected while scanning a multi-key bundle;
      // keep the last error so a single-key bundle reports something useful.
      var lastError = err; // eslint-disable-line no-var
    }
  }

  return {
    valid: false,
    spiffeId: null,
    reason: (typeof lastError !== 'undefined' && lastError?.message) || 'no key in the bundle verified this SVID',
  };
}

module.exports = {
  TRUST_DOMAIN,
  ISSUER,
  verifySvid,
  isSpiffeId,
  _setBundleFetcherForTest,
};
