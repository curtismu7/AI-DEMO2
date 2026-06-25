'use strict';

/**
 * Outbound correlation/trace propagation (brady2 audit #4).
 *
 * Registers a single axios request interceptor on the default axios instance so
 * that every outbound HTTP call the BFF makes — PingOne token/exchange/revoke,
 * introspection, the banking API, etc. — carries the current request's
 * correlation ID and a W3C `traceparent`. This closes the leg the audit flagged:
 * the BFF already propagated correlation BFF→gateway→MCP, but external (PingOne)
 * calls were untraceable.
 *
 * The correlation ID is read from the AsyncLocalStorage store populated by
 * correlationIdMiddleware, so no call site needs to thread it through. Existing
 * headers are never overwritten. Registration is idempotent.
 */

const crypto = require('node:crypto');
const axios = require('axios');
const { getCorrelationId } = require('./correlationContext');

let _registered = false;

/**
 * Build a W3C traceparent (`00-<32hex traceId>-<16hex spanId>-01`) from the
 * correlation ID. When the correlation ID is a UUID we reuse its 32 hex digits
 * as the trace-id so the two identifiers stay visibly linked; otherwise we hash
 * it to 32 hex. The span-id is fresh per outbound call.
 */
function buildTraceparent(correlationId) {
  const hex = String(correlationId).replace(/[^0-9a-f]/gi, '').toLowerCase();
  const traceId =
    hex.length >= 32
      ? hex.slice(0, 32)
      : crypto.createHash('sha256').update(String(correlationId)).digest('hex').slice(0, 32);
  const spanId = crypto.randomBytes(8).toString('hex');
  return `00-${traceId}-${spanId}-01`;
}

function registerOutboundTracing() {
  if (_registered) return;
  // axios may be mocked in tests without interceptors — skip silently rather than
  // crashing on `undefined.request.use`. Don't set _registered so a real axios
  // can register on a subsequent call if needed.
  if (!axios.interceptors?.request) return;
  _registered = true;
  axios.interceptors.request.use((config) => {
    const cid = getCorrelationId();
    if (!cid) return config;
    config.headers = config.headers || {};
    const has = (name) =>
      Object.keys(config.headers).some((k) => k.toLowerCase() === name);
    if (!has('x-correlation-id')) config.headers['X-Correlation-ID'] = cid;
    if (!has('x-request-id')) config.headers['X-Request-ID'] = cid;
    if (!has('traceparent')) config.headers['traceparent'] = buildTraceparent(cid);
    return config;
  });
}

module.exports = { registerOutboundTracing, buildTraceparent };
