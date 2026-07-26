'use strict';
/**
 * BFF in-process transaction-hop emitter.
 *
 * The BFF writes straight to the ledger — no HTTP round trip, unlike the
 * remote services which POST to /internal/transaction-hop. Fail-open by
 * contract: a dead ledger drops hops and never disturbs the request path.
 */
const ledger = require('./lmdb/transactionLedger.lmdb');
const { getCorrelationId } = require('../utils/correlationContext');

const SERVICE = 'demo-api-server';

/**
 * @param {object} hop  { phase, op?, identity?, decision?, durationMs?, status?, correlationId?, service? }
 */
function emitHop(hop) {
  try {
    const correlationId = hop.correlationId || getCorrelationId();
    // No correlation scope means we cannot attribute this hop to a
    // transaction. Minting an id here would create orphan single-hop records
    // that look like incomplete transactions in the UI.
    if (!correlationId) return;
    const { correlationId: _ignored, ...rest } = hop;
    ledger.appendHop(correlationId, { service: SERVICE, ...rest });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[transactionHop] emit failed:', err?.message);
  }
}

module.exports = { emitHop, SERVICE };
