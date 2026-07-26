'use strict';

const crypto = require('node:crypto');

/**
 * Derive a stable 32-hex-char W3C trace-id from a correlation id.
 *
 * Deterministic, not reversible: a UUID correlation id reuses its own hex
 * digits so the two identifiers stay visibly linked in Jaeger; anything else
 * is hashed. Extracted from outboundTracing.buildTraceparent so the ledger can
 * record the same trace-id that goes out on the `traceparent` header, making a
 * ledger row deep-linkable to its Jaeger trace.
 *
 * @param {string} correlationId
 * @returns {string} 32 lowercase hex chars
 */
function traceIdFromCorrelation(correlationId) {
  const hex = String(correlationId).replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.length >= 32
    ? hex.slice(0, 32)
    : crypto.createHash('sha256').update(String(correlationId)).digest('hex').slice(0, 32);
}

module.exports = { traceIdFromCorrelation };
