'use strict';
/**
 * Ship one transaction hop to the BFF ledger, fire-and-forget.
 *
 * The mock Authorization Server's existing audit sink (logger.auditDecision)
 * writes to stdout only — nothing in the repo reads it. This emitter is the
 * machine-readable path the invariant engine and reconciler consume.
 * Never awaited and never throws: a decision must never be delayed or failed
 * by auditing.
 */
const { getCorrelationId } = require('./correlationContext');

const SERVICE = 'authz-server';

let _fetch;

/** Test seam — inject a fetch double. Pass undefined to restore global fetch. */
function __setFetchForTests(fn) {
  _fetch = fn;
}

function emitHop(hop) {
  try {
    const url = process.env.BFF_TRANSACTION_HOP_URL;
    const secret = process.env.BFF_INTERNAL_SECRET;
    if (!url || !secret) return;
    const correlationId = hop.correlationId || getCorrelationId();
    if (!correlationId) return;

    const doFetch = _fetch || globalThis.fetch;
    if (!doFetch) return;

    doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-gateway-secret': secret },
      body: JSON.stringify({ ...hop, correlationId, service: SERVICE }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => { /* swallow */ });
  } catch {
    /* swallow */
  }
}

module.exports = { emitHop, __setFetchForTests, SERVICE };
