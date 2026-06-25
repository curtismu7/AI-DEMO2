'use strict';

/**
 * tokenUtils.js — Shared JWT decoding utilities (display-only, no signature verification)
 *
 * Used by instrumented services to decode token payloads for event metadata.
 * NEVER returns raw token strings. Returns null for invalid/missing tokens.
 *
 * No imports from services, routes, or middleware — zero circular-dependency risk.
 */

/**
 * Decode a JWT without signature verification.
 * Returns { header, claims } or null if the token is missing, non-string, or malformed.
 * Safe to call on any value — never throws.
 *
 * @param {*} token - JWT string to decode
 * @returns {{ header: object, claims: object } | null}
 */
function decodeJwt(token) {
  if (!token || typeof token !== 'string') { return null; }
  try {
    const parts = token.split('.');
    if (parts.length !== 3) { return null; }
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return { header, claims };
  } catch (_e) {
    return null;
  }
}

/**
 * Sanitize a PingOne API response body for safe logging.
 * Strips raw token strings and client secrets. Keeps status, claims summary, error codes.
 *
 * @param {object} body - PingOne response body
 * @returns {object} Safe object with token fields removed
 */
function sanitizePingOneResponse(body) {
  if (!body || typeof body !== 'object') { return {}; }
  // eslint-disable-next-line no-unused-vars
  const { access_token, id_token, refresh_token, client_secret, ...safe } = body;
  return safe;
}

module.exports = { decodeJwt, sanitizePingOneResponse };
