'use strict';

/**
 * Safe JWT payload decoder — decodes the base64url middle section without signature verification.
 * Use only when the JWT has already been cryptographically verified (via introspection,
 * signature validation, etc.). Do NOT use this to parse untrusted JWTs.
 *
 * @module utils/jwtDecoder
 */

/**
 * Decode a base64url-encoded string to a UTF-8 string.
 * Handles padding normalization (base64url omits trailing '=').
 *
 * @param {string} base64url — base64url-encoded string (e.g., JWT payload)
 * @returns {string} UTF-8 decoded string
 * @throws {Error} if the input is not valid base64url
 */
function decodeBase64Url(base64url) {
  if (typeof base64url !== 'string') {
    throw new TypeError('Expected a string');
  }
  // Restore padding for standard base64 decoding
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + padding;
  try {
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch (err) {
    throw new Error(`Invalid base64url: ${err.message}`);
  }
}

/**
 * Parse a JWT's payload (the middle '.' -separated section) into a JavaScript object.
 * Does NOT verify the signature — use only with previously-verified JWTs.
 *
 * @param {string} jwt — complete JWT string (header.payload.signature)
 * @returns {object} decoded JWT payload as a JavaScript object
 * @throws {Error} if the JWT format is invalid or payload is not valid JSON
 */
function parseJwtPayload(jwt) {
  if (typeof jwt !== 'string') {
    throw new TypeError('Expected a JWT string');
  }
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: expected 3 parts separated by "."');
  }
  const payloadStr = decodeBase64Url(parts[1]);
  try {
    return JSON.parse(payloadStr);
  } catch (err) {
    throw new Error(`Invalid JWT payload JSON: ${err.message}`);
  }
}

/**
 * Parse a JWT's header (the first '.'-separated section) into an object.
 * Does NOT verify the signature — use only with previously-verified JWTs.
 *
 * Exists so callers that want to SHOW a token (alg, kid, typ) stop hand-rolling
 * `Buffer.from(parts[0], 'base64')`. That spelling is not spec-correct — JWT
 * segments are base64URL — though Node's decoder is lenient enough to accept it
 * in practice, so this is about having one tested decoder, not about fixing
 * wrong output. jwtDecoder.test.js pins that equivalence explicitly.
 *
 * @param {string} jwt — complete JWT string (header.payload.signature)
 * @returns {object} decoded JWT header as a JavaScript object
 * @throws {Error} if the JWT format is invalid or the header is not valid JSON
 */
function parseJwtHeader(jwt) {
  if (typeof jwt !== 'string') {
    throw new TypeError('Expected a JWT string');
  }
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: expected 3 parts separated by "."');
  }
  const headerStr = decodeBase64Url(parts[0]);
  try {
    return JSON.parse(headerStr);
  } catch (err) {
    throw new Error(`Invalid JWT header JSON: ${err.message}`);
  }
}

/**
 * Extract a claim from a JWT's payload by key, with fallback to a default value.
 *
 * @param {string} jwt — complete JWT string
 * @param {string} claimKey — claim name (e.g., 'sub', 'aud', 'custom_claim')
 * @param {*} defaultValue — returned if the claim is not present (default: undefined)
 * @returns {*} the claim value, or defaultValue if not present
 * @throws {Error} if JWT parsing fails
 */
function getJwtClaim(jwt, claimKey, defaultValue) {
  const payload = parseJwtPayload(jwt);
  return payload[claimKey] ?? defaultValue;
}

module.exports = {
  decodeBase64Url,
  parseJwtPayload,
  parseJwtHeader,
  getJwtClaim,
};
