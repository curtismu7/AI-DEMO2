'use strict';

const { sanitizeAxiosCause } = require('./sanitizeAxiosCause');

/**
 * Normalize a raw axios error into a stable, credential-safe Error so callers
 * never leak axios internals (`.config` carries Bearer/Basic creds) or a bare
 * transport code.
 *
 * @param {*} err caught error
 * @param {{label?: string, timeoutMs?: number}} [opts]
 * @returns {Error}
 */
function normalizeAxiosError(err, { label = 'Upstream request', timeoutMs } = {}) {
  const code = err && err.code;

  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    const e = new Error(`${label} timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}`);
    e.code = 'UPSTREAM_TIMEOUT';
    e.httpStatus = 504;
    e.cause = sanitizeAxiosCause(err);
    return e;
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
    const e = new Error(`${label} unreachable (${code})`);
    e.code = 'UPSTREAM_UNREACHABLE';
    e.httpStatus = 503;
    e.cause = sanitizeAxiosCause(err);
    return e;
  }
  if (err && err.response) {
    const status = err.response.status;
    const body = err.response.data;
    const detail = (body && (body.error_description || body.message || body.error)) || err.message;
    const e = new Error(`${label} failed (${status}): ${detail}`);
    e.code = 'UPSTREAM_HTTP_ERROR';
    e.httpStatus = status;
    e.upstreamStatus = status;
    e.upstreamBody = body;
    e.cause = sanitizeAxiosCause(err);
    return e;
  }
  return err instanceof Error ? err : Object.assign(new Error(String(err)), { cause: err });
}

module.exports = { normalizeAxiosError };
