'use strict';

const { sanitizeAxiosCause } = require('./sanitizeAxiosCause');

/**
 * Normalize a raw axios error into a stable, credential-safe Error so services
 * and routes never leak axios internals (`.config` carries Bearer/Basic creds
 * and token-call bodies; `.request`/`.response` are bulky) or a bare transport
 * code. Callers throw the returned Error; routes can read `.httpStatus` for the
 * response status and `.message` for a safe summary.
 *
 * Shapes:
 *   - transport timeout (ECONNABORTED/ETIMEDOUT) → code UPSTREAM_TIMEOUT, httpStatus 504
 *   - connection failure (ECONNREFUSED/ENOTFOUND/EHOSTUNREACH/ECONNRESET)
 *                                                → code UPSTREAM_UNREACHABLE, httpStatus 503
 *   - HTTP error response → code UPSTREAM_HTTP_ERROR, httpStatus = upstream status,
 *                           `upstreamStatus` + `upstreamBody` for callers that need them
 *   - anything else (already a custom Error, e.g. TOKEN_INACTIVE, or a non-Error
 *     throw) → returned unchanged so existing handlers still recognize it
 *
 * @param {*} err caught error
 * @param {{label?: string, timeoutMs?: number, codes?: {timeout?: string, unreachable?: string}}} [opts]
 *   label prefixes the message (e.g. "PingOne token request"); timeoutMs is echoed
 *   in the timeout message; codes overrides the transport code names (e.g. the
 *   gateway client's GATEWAY_TIMEOUT/GATEWAY_UNREACHABLE).
 * @returns {Error}
 */
function normalizeAxiosError(err, { label = 'Upstream request', timeoutMs, codes } = {}) {
  const timeoutCode = (codes && codes.timeout) || 'UPSTREAM_TIMEOUT';
  const unreachableCode = (codes && codes.unreachable) || 'UPSTREAM_UNREACHABLE';
  const code = err && err.code;

  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    const e = new Error(`${label} timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}`);
    e.code = timeoutCode;
    e.httpStatus = 504;
    e.cause = sanitizeAxiosCause(err);
    return e;
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
    const e = new Error(`${label} unreachable (${code})`);
    e.code = unreachableCode;
    e.httpStatus = 503;
    e.cause = sanitizeAxiosCause(err);
    return e;
  }
  if (err && err.response) {
    const status = err.response.status;
    const body = err.response.data;
    const detail =
      (body && (body.error_description || body.message || body.error)) || err.message;
    const e = new Error(`${label} failed (${status}): ${detail}`);
    e.code = 'UPSTREAM_HTTP_ERROR';
    e.httpStatus = status;
    e.upstreamStatus = status;
    e.upstreamBody = body;
    e.cause = sanitizeAxiosCause(err);
    return e;
  }
  // Not an axios transport/HTTP error — leave it alone so callers that special-case
  // their own codes (e.g. TOKEN_INACTIVE) or non-Error throws keep working.
  return err instanceof Error ? err : Object.assign(new Error(String(err)), { cause: err });
}

module.exports = { normalizeAxiosError };
