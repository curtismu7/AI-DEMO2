'use strict';

/**
 * DPoP key + proof service (RFC 9449) — zero external deps, Node built-in crypto only.
 *
 * The BFF acts as the DPoP-proofing client on behalf of the agent: it mints a
 * per-session ephemeral P-256 keypair, binds the delegated MCP token to that key
 * (cnf.jkt), and signs a fresh DPoP proof JWT for each hop. This makes a stolen
 * bearer useless to anyone who does not also hold the private key.
 *
 * Simulated mode (PingOne SaaS): the JWT itself is not re-signed, so the key
 * thumbprint (jkt) is carried to the gateway/MCP via the trusted TraT envelope.
 * Native mode (PingOne AIC / PingFederate): cnf.jkt is issued in the token claims.
 * The proof crypto below is identical in both modes — only where jkt lives differs.
 *
 * The explicit JWS construction is intentional: it doubles as a teaching artifact
 * for the demo (you can read exactly how a DPoP proof is built and verified).
 */

const crypto = require('node:crypto');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * RFC 7638 JWK thumbprint (SHA-256, base64url) over the canonical member set.
 * For EC keys the required members in lexicographic order are: crv, kty, x, y.
 */
function jwkThumbprint(jwk) {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

/**
 * Generate an ephemeral P-256 keypair. The private key is exported as PKCS#8 PEM
 * so it survives express-session serialization (KeyObjects are not serializable).
 * Returns { privatePem, publicJwk, jkt }.
 */
function generateDpopKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicJwk,
    jkt: jwkThumbprint(publicJwk),
  };
}

/**
 * RFC 9449 §6 access-token hash: base64url(SHA-256(access_token)). Bound into the
 * proof as `ath` so a proof cannot be replayed with a different access token.
 */
function accessTokenHash(accessToken) {
  return crypto.createHash('sha256').update(accessToken).digest('base64url');
}

/**
 * Sign a DPoP proof JWT (RFC 9449 §4.2) for a single hop.
 * @param {object} p
 * @param {string} p.privatePem  PKCS#8 PEM private key from generateDpopKeypair()
 * @param {object} p.publicJwk   the matching public JWK (embedded in the header)
 * @param {string} p.htu         target URI (no query/fragment), e.g. gateway tool URL
 * @param {string} [p.htm]       HTTP method, default POST
 * @param {string} [p.ath]       access-token hash (accessTokenHash), optional
 * @returns {string} compact JWS
 */
function signDpopProof({ privatePem, publicJwk, htu, htm = 'POST', ath }) {
  const header = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
  };
  const payload = {
    htu,
    htm: String(htm).toUpperCase(),
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    ...(ath ? { ath } : {}),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // ES256 must be raw R||S (JOSE), not DER — dsaEncoding 'ieee-p1363' gives that.
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: crypto.createPrivateKey(privatePem),
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${b64url(sig)}`;
}

/**
 * Get-or-create the per-session ephemeral DPoP keypair. Returns null when there
 * is no session (the caller then skips DPoP — it is best-effort plumbing).
 */
function getSessionDpopKey(req) {
  if (!req || !req.session) return null;
  if (!req.session.dpopKey || !req.session.dpopKey.jkt) {
    req.session.dpopKey = generateDpopKeypair();
  }
  return req.session.dpopKey;
}

module.exports = {
  jwkThumbprint,
  generateDpopKeypair,
  accessTokenHash,
  signDpopProof,
  getSessionDpopKey,
};
