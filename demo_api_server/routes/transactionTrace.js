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

router.get('/', (req, res) => {
  const parsed = parseInt(String(req.query.limit), 10);
  try {
    const transactions = ledger.listRecords({
      limit: Number.isFinite(parsed) ? parsed : undefined,
    });
    return res.json({ transactions });
  } catch (err) {
    // A read failure degrades to an empty list, not a 500 that breaks the page.
    console.warn('[transactionTrace] list failed:', err?.message);
    return res.json({ transactions: [] });
  }
});

router.get('/:correlationId', (req, res) => {
  let record;
  try {
    record = ledger.getRecord(req.params.correlationId);
  } catch (err) {
    console.warn('[transactionTrace] read failed:', err?.message);
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!record) return res.status(404).json({ error: 'not_found' });

  return res.json({
    ...record,
    traceId: traceIdFromCorrelation(record.correlationId),
  });
});

module.exports = router;
