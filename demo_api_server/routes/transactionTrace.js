'use strict';
/**
 * /api/transaction-trace — chain-of-custody read API.
 *
 * Named transaction-trace, not transactions: /api/transactions is already the
 * banking transactions API (server.js:1239).
 *
 * Tasks 11-13 extend the detail payload with `verdict` (invariant engine) and
 * `reconciliation` (second-witness join). Both are computed at read time, so
 * neither is stored.
 */
const express = require('express');
const router = express.Router();
const ledger = require('../services/lmdb/transactionLedger.lmdb');
const { traceIdFromCorrelation } = require('../utils/traceIdFromCorrelation');
const { assemble } = require('../services/transactionAssembler');

// Ownership: any logged-in user sees only transactions attributed to their own
// principal; admins see everything. A record whose principal is unknown (no
// hop ever carried an identity.sub) cannot be attributed, so it is admin-only.
function _isOwnRecord(req, principal) {
  return Boolean(principal) && principal === req.user?.id;
}

router.get('/', (req, res) => {
  const parsed = parseInt(String(req.query.limit), 10);
  try {
    const isAdmin = req.user?.role === 'admin';
    const transactions = ledger
      .listRecords({ limit: Number.isFinite(parsed) ? parsed : undefined })
      .filter((t) => isAdmin || _isOwnRecord(req, t.principal));
    return res.json({ transactions });
  } catch (err) {
    // A read failure degrades to an empty list, not a 500 that breaks the page.
    console.warn('[transactionTrace] list failed:', err?.message);
    return res.json({ transactions: [] });
  }
});

router.get('/:correlationId', async (req, res) => {
  let record;
  try {
    record = await assemble(req.params.correlationId);
  } catch (err) {
    console.warn('[transactionTrace] read failed:', err?.message);
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!record) return res.status(404).json({ error: 'not_found' });

  // A non-admin requesting someone else's (or an unattributed) transaction
  // gets the same 404 as a nonexistent one — a 403 would confirm the
  // transaction exists, which is itself a disclosure given correlationIds
  // are guessable (X-Request-ID / X-Correlation-ID are client-influenced).
  const isAdmin = req.user?.role === 'admin';
  if (!isAdmin && !_isOwnRecord(req, record.principal)) {
    return res.status(404).json({ error: 'not_found' });
  }

  return res.json({
    ...record,
    traceId: traceIdFromCorrelation(record.correlationId),
  });
});

module.exports = router;
