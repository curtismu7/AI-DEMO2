/**
 * Enhanced Token Validation Service — JWKS-based JWT signature verification with error classification
 *
 * Validates tokens using PingOne's public JWKS keys. Classifies validation failures
 * into 4 categories (TRANSIENT, USER, CONFIG, UNKNOWN) for intelligent error handling.
 *
 * Error categories:
 *   - USER: Token expired/revoked/invalid → user must re-authenticate
 *   - CONFIG: JWKS unreachable, issuer/audience mismatch → ops/support issue
 *   - TRANSIENT: Temporary fetch failures → retry
 *   - UNKNOWN: Unrecognized error → log fully
 *
 * Includes proactive config validation to catch misconfigurations early.
 */

const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const PingOneErrorClassifier = require('./pingoneErrorClassifier');

const jwksCache = new Map();
const JWKS_TTL_MS = 10 * 60 * 1000;

/**
 * Test JWKS URI connectivity (proactive config validation)
 * @param {string} jwksUri
 * @returns {Promise<void>} Throws if unreachable
 */
async function testJwksUri(jwksUri) {
  return new Promise((resolve, reject) => {
    const url = new URL(jwksUri);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'HEAD',
      timeout: 5000,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode >= 400) {
        reject(new Error(`JWKS URI returned ${res.statusCode}`));
      } else {
        resolve();
      }
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('JWKS probe timeout'));
    });
    req.end();
  });
}

/**
 * Fetch PingOne JWKS and cache the result.
 * @param {string} jwksUri
 * @returns {Promise<Array>} array of JWK objects
 */
async function fetchJwks(jwksUri) {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.keys;
  }

  return new Promise((resolve, reject) => {
    const url = new URL(jwksUri);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Accept: 'application/json' },
    };

    const req = https.request(options, (res) => {
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
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return key.export({ type: 'spki', format: 'pem' });
}

/**
 * Validate a JWT against PingOne JWKS with classification.
 * Attaches error.classification to any error for middleware to use.
 *
 * @param {string} token  Raw JWT
 * @param {object} opts
 * @param {string} opts.jwksUri   e.g. https://auth.pingone.com/{envId}/as/jwks
 * @param {string} [opts.issuer]  Expected issuer (optional but recommended)
 * @param {string} [opts.audience] Expected audience (optional)
 * @returns {Promise<object>} decoded JWT payload
 * @throws {Error} with .classification property attached
 */
async function validateToken(token, { jwksUri, issuer, audience } = {}) {
  try {
    // Decode header to get kid
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header) {
      const err = new Error('Invalid JWT: cannot decode header');
      err.classification = PingOneErrorClassifier.classifyTokenValidationError(err, { jwksUri, issuer, audience });
      throw err;
    }
    const { kid, alg } = decoded.header;

    // Fetch JWKS
    let keys;
    try {
      keys = await fetchJwks(jwksUri);
    } catch (fetchErr) {
      const err = new Error(`Failed to fetch JWKS: ${fetchErr.message}`);
      err.classification = {
        category: 'CONFIG',
        code: 'JWKS_UNAVAILABLE',
        isConfig: true,
        userAction: 'contact-support',
        context: {
          what: 'JWKS endpoint unreachable',
          jwksUri,
          error: fetchErr.message,
        },
      };
      throw err;
    }

    // Find matching key
    let jwk;
    if (kid) {
      jwk = keys.find((k) => k.kid === kid);
      if (!jwk) {
        jwksCache.delete(jwksUri);
        const freshKeys = await fetchJwks(jwksUri);
        jwk = freshKeys.find((k) => k.kid === kid);
        if (!jwk) {
          const err = new Error(`No matching JWKS key found for kid=${kid}`);
          err.classification = {
            category: 'CONFIG',
            code: 'JWKS_UNAVAILABLE',
            isConfig: true,
            userAction: 'contact-support',
          };
          throw err;
        }
      }
    } else {
      jwk = keys.find((k) => k.kty === 'RSA');
    }
    if (!jwk) {
      const err = new Error('No matching JWKS key found (no kid in token, no RSA key in JWKS)');
      err.classification = {
        category: 'CONFIG',
        code: 'JWKS_UNAVAILABLE',
        isConfig: true,
        userAction: 'contact-support',
      };
      throw err;
    }

    const pem = jwkToPem(jwk);

    // Verify options
    const verifyOptions = {
      algorithms: [alg || 'RS256'],
    };
    if (issuer) verifyOptions.issuer = issuer;
    if (audience) verifyOptions.audience = audience;

    return new Promise((resolve, reject) => {
      jwt.verify(token, pem, verifyOptions, (err, payload) => {
        if (err) {
          // Attach classification to jwt.verify errors
          err.classification = PingOneErrorClassifier.classifyTokenValidationError(err, { jwksUri, issuer, audience });
          reject(err);
        } else {
          resolve(payload);
        }
      });
    });
  } catch (err) {
    // If error already has classification, re-throw as-is
    if (!err.classification) {
      err.classification = PingOneErrorClassifier.classifyTokenValidationError(err, { jwksUri, issuer, audience });
    }
    throw err;
  }
}

/**
 * Clear JWKS cache (useful for testing or emergency key rotation)
 */
function clearJwksCache() {
  jwksCache.clear();
}

module.exports = { validateToken, testJwksUri, clearJwksCache };
