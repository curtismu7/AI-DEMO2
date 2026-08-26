'use strict';

/**
 * spiffeTrustDomain — the demo trust domain's signing key and SVID validation.
 *
 * Stands in for a SPIRE server's CA. What is simulated is the ISSUER: there is
 * no SPIRE server and no workload attestation, so possession of an SVID here
 * proves nothing about what the caller actually is. What is REAL is the
 * cryptography — signature, expiry, issuer and SPIFFE-ID checks — because that
 * is the half that fails silently when it is fake.
 *
 * Deliberately its own key, not the BFF's client-auth key from
 * clientAssertionService: a trust domain's CA is a separate thing from a
 * client's authentication key, and conflating them would teach the wrong model.
 *
 * Key is generated in-process and lives for the process lifetime. Restarting
 * the BFF invalidates outstanding SVIDs, which is correct for a demo CA and
 * matches SPIRE's own short-lived-everything posture.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TRUST_DOMAIN = 'demo.local';
const ISSUER = `spire-demo://${TRUST_DOMAIN}`;
/** Seconds. SPIRE issues minutes-long SVIDs; 5 minutes is in that spirit. */
const SVID_TTL_SECONDS = 300;

let cached = null;

/** RSA-2048 is slow to generate (~100ms), so do it once, lazily. */
function keys() {
  if (cached) return cached;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  // Deterministic kid from the public key, so it is stable for this process
  // and meaningful to anyone comparing the bundle to a token header.
  const kid = crypto.createHash('sha256')
    .update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
    .digest('base64url')
    .slice(0, 16);
  cached = { privateKey, publicKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
  return cached;
}

/** The trust bundle: PUBLIC key material only. */
function publicJwk() {
  return keys().jwk;
}

/** A SPIFFE ID is `spiffe://<trust-domain>/<path>` — the path is required. */
function isSpiffeId(value, trustDomain = TRUST_DOMAIN) {
  return typeof value === 'string' && value.startsWith(`spiffe://${trustDomain}/`);
}

/** Mint a JWT-SVID for a workload. */
function issueSvid(spiffeId, { audience = TRUST_DOMAIN } = {}) {
  const { privateKey, jwk } = keys();
  return jwt.sign(
    { sub: spiffeId, iss: ISSUER, aud: [audience] },
    privateKey,
    { algorithm: 'RS256', expiresIn: SVID_TTL_SECONDS, keyid: jwk.kid },
  );
}

/**
 * Verify an SVID against the trust bundle.
 *
 * Algorithm is PINNED to RS256. Measured honestly: jsonwebtoken v9 ALREADY
 * rejects both `alg: none` and the algorithm-confusion attack (HS256 signed
 * with the published public key as the HMAC secret) because it checks key type
 * against algorithm — removing the pin leaves every test in
 * tests/spiffeDemo.test.js green. The pin is kept as defence in depth against a
 * library swap or downgrade, not because it is load-bearing today. Do not read
 * the token's own `alg` to decide how to verify it.
 *
 * @returns {{ valid: boolean, claims: object|null, reason: string|null }}
 */
function verifySvid(svid, { expectedTrustDomain = TRUST_DOMAIN } = {}) {
  const { publicKey } = keys();
  let claims;
  try {
    claims = jwt.verify(svid, publicKey, { algorithms: ['RS256'], issuer: ISSUER });
  } catch (err) {
    // jsonwebtoken distinguishes expiry from a bad signature; both are refusals,
    // but the reason is worth surfacing for the teaching UI.
    return { valid: false, claims: null, reason: err?.message || 'verification_failed' };
  }

  if (!isSpiffeId(claims.sub, expectedTrustDomain)) {
    return { valid: false, claims: null, reason: 'spiffe_id_outside_expected_trust_domain' };
  }

  return { valid: true, claims, reason: null };
}

module.exports = {
  TRUST_DOMAIN,
  ISSUER,
  SVID_TTL_SECONDS,
  publicJwk,
  isSpiffeId,
  issueSvid,
  verifySvid,
};
