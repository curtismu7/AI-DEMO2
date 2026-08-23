/**
 * PingOne Token Validation Service — JWKS-based JWT signature verification (RFC 7515/7517/7518).
 *
 * This is ONE of two validation strategies the BFF supports (see ADR 0005):
 *
 *   1. JWT mode (this file) — verifies the token's cryptographic signature offline using
 *      PingOne's public JWKS keys. Fast; works without a live PingOne call per request.
 *      Trade-off: a revoked token still passes until it expires (no revocation check).
 *
 *   2. Introspection mode (tokenIntrospectionService.js) — calls PingOne's RFC 7662
 *      /as/introspect endpoint on every request. Detects revocation in near-real-time.
 *      Trade-off: adds one PingOne round-trip per API call.
 *
 * The active mode is read from configStore at runtime (admin Config UI toggles it live).
 * middleware/auth.js calls the correct service based on that setting.
 *
 * For learners: the toggle lets you see what happens when a token is revoked but the
 * server only checks the signature — it keeps working until exp. That's the JWT-mode risk.
 */
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Simple in-memory JWKS cache — refreshed after TTL
const jwksCache = new Map();
const JWKS_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch PingOne JWKS and cache the result.
 * @param {string} jwksUri
 * @param {object} [opts]
 * @param {boolean} [opts.allowHttp] Skip the HTTPS-only guard for this one fetch —
 *   ONLY for oauth-mcp's own embedded-AS JWKS, reachable exclusively over the
 *   internal Docker network (never internet-facing) and served over plain HTTP
 *   there today. Every other caller (PingOne) stays HTTPS-only, unchanged.
 * @returns {Promise<Array>} array of JWK objects
 */
async function fetchJwks(jwksUri, { allowHttp = false } = {}) {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.keys;
  }

  // Enforce HTTPS — JWKS must never be fetched over plaintext to prevent MITM
  // injection of attacker-controlled signing keys.
  const url = new URL(jwksUri);
  const isAllowedHttp = allowHttp && url.protocol === 'http:';
  if (url.protocol !== 'https:' && !isAllowedHttp) {
    throw new Error(`JWKS URI must use HTTPS (got ${url.protocol}). Refusing to fetch signing keys over insecure transport.`);
  }

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Accept: 'application/json' },
    };

    const transport = isAllowedHttp ? http : https;
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const keys = parsed.keys || [];
          jwksCache.set(jwksUri, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
          resolve(keys);
        } catch (err) {
          reject(new Error(`Failed to parse JWKS response: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('JWKS fetch timed out'));
    });
    req.end();
  });
}

/**
 * Convert a JWK (RS256) to a PEM public key string.
 * @param {object} jwk
 * @returns {string} PEM
 */
function jwkToPem(jwk) {
  // Use Node.js native key import
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return key.export({ type: 'spki', format: 'pem' });
}

/**
 * Validate a JWT against PingOne JWKS.
 * Throws if invalid; returns the decoded payload if valid.
 *
 * @param {string} token  Raw JWT
 * @param {object} opts
 * @param {string} opts.jwksUri   e.g. https://auth.pingone.com/{envId}/as/jwks
 * @param {string} [opts.issuer]  Expected issuer (optional but recommended)
 * @param {string} [opts.audience] Expected audience (optional)
 * @param {boolean} [opts.allowHttp] See fetchJwks — internal oauth-mcp JWKS only.
 * @returns {Promise<object>} decoded JWT payload
 */
async function validateToken(token, { jwksUri, issuer, audience, allowHttp = false } = {}) {
  // Decode header to get kid
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || !decoded.header) {
    throw new Error('Invalid JWT: cannot decode header');
  }
  const { kid } = decoded.header;

  // Fetch JWKS
  const keys = await fetchJwks(jwksUri, { allowHttp });

  // Find matching key
  let jwk;
  if (kid) {
    jwk = keys.find((k) => k.kid === kid);
    // If kid is present but matches nothing, reject — don't fall back to an arbitrary key.
    // A recognised kid that matches no JWK means the token was signed by an unknown key.
    if (!jwk) {
      // kid not found in cached JWKS — the IdP may have rotated its signing key.
      // Invalidate the cache and re-fetch once before hard-rejecting, so a rotation
      // doesn't cause a 10-minute 401 outage for the full cache TTL.
      jwksCache.delete(jwksUri);
      const freshKeys = await fetchJwks(jwksUri, { allowHttp });
      jwk = freshKeys.find((k) => k.kid === kid);
      if (!jwk) {
        throw new Error(`No matching JWKS key found for kid=${kid}`);
      }
    }
  } else {
    // No kid in token header — fall back to first RSA key (common in older IdP configurations).
    jwk = keys.find((k) => k.kty === 'RSA');
  }
  if (!jwk) {
    throw new Error(`No matching JWKS key found (no kid in token, no RSA key in JWKS)`);
  }

  const pem = jwkToPem(jwk);

  // Verify options — the allow-list is a fixed, server-controlled value.
  // NEVER derive it from the token's own (unverified) header: doing so lets
  // an attacker pick their own verification algorithm (CWE-347, the classic
  // RS256->HS256 signing-key confusion attack). PingOne only ever issues
  // RS256-signed tokens (see jwkToPem above and jwksService.js), so RS256 is
  // the only algorithm this server will accept.
  const verifyOptions = {
    algorithms: ['RS256'],
  };
  if (issuer) verifyOptions.issuer = issuer;
  if (audience) verifyOptions.audience = audience;

  return new Promise((resolve, reject) => {
    jwt.verify(token, pem, verifyOptions, (err, payload) => {
      if (err) reject(err);
      else resolve(payload);
    });
  });
}

module.exports = { validateToken };
