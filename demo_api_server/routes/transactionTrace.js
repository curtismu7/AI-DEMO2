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
const { evaluate } = require('../services/transactionInvariants');
const { reconcile } = require('../services/transactionReconciler');
const configStore = require('../services/configStore');
const { resolveActingIdentity } = require('../middleware/transactionTurn');

// OFF means the ledger is not being written, so serving a partial chain would
// misrepresent it as complete. Report the feature state instead.
router.use((req, res, next) => {
  if (configStore.getEffective('ff_transaction_ledger') === 'false') {
    return res.status(403).json({ error: 'feature_disabled' });
  }
  next();
});

// Ownership: any logged-in user sees only transactions attributed to their own
// principal; admins see everything. A record whose principal is unknown (no
// hop ever carried an identity.sub) cannot be attributed, so it is admin-only.
// Uses the same resolveActingIdentity() the write side (transactionTurn.js)
// used to stamp the principal in the first place — comparing values derived
// two different ways is how a read/write identity mismatch (CVE-shaped: users
// seeing nothing, or worse, seeing each other's transactions) creeps back in.
function _isOwnRecord(req, principal) {
  return Boolean(principal) && principal === resolveActingIdentity(req);
}

router.get('/', (req, res) => {
  const parsed = parseInt(String(req.query.limit), 10);
  try {
    const isAdmin = req.user?.role === 'admin';
    // Ownership is pushed into listRecords as a `principal` option so the
    // store filters BEFORE slicing to `limit` — filtering the already-sliced
    // page here would mean a non-admin could see fewer than `limit` (or
    // none) of their own transactions while their records sit just outside
    // the pre-filter page, with nothing signalling the truncation.
    const listOpts = { limit: Number.isFinite(parsed) ? parsed : undefined };
    if (!isAdmin) listOpts.principal = req.user?.id;
    const transactions = ledger.listRecords(listOpts);
    return res.json({ transactions });
  } catch (err) {
    // A read failure degrades to an empty list, not a 500 that breaks the page.
    console.warn('[transactionTrace] list failed:', err?.message);
    return res.json({ transactions: [] });
  }
});

router.get('/:correlationId', async (req, res) => {
  const correlationId = req.params.correlationId;

  // Ownership is resolved from a cheap, synchronous ledger.getRecord BEFORE
  // assemble() runs. assemble() performs an async, principal-scoped
  // tokenChainService read (_derivedTokenHops) — real work a nonexistent
  // correlationId never triggers. Checking ownership first means a rejected
  // request ("exists but not yours") does no more work than a nonexistent
  // one, so the two 404s can't be told apart by response latency either —
  // closing a timing side channel that would otherwise reopen the
  // confidentiality leak the identical 404 body/status was meant to close
  // (correlationIds are guessable: X-Request-ID / X-Correlation-ID are
  // client-influenced).
  let stub;
  try {
    stub = ledger.getRecord(correlationId);
  } catch (err) {
    console.warn('[transactionTrace] read failed:', err?.message);
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!stub) return res.status(404).json({ error: 'not_found' });

  // A non-admin requesting someone else's (or an unattributed) transaction
  // gets the same 404 as a nonexistent one — a 403 would confirm the
  // transaction exists, which is itself a disclosure given correlationIds
  // are guessable.
  const isAdmin = req.user?.role === 'admin';
  if (!isAdmin && !_isOwnRecord(req, stub.principal)) {
    return res.status(404).json({ error: 'not_found' });
  }

  let record;
  try {
    record = await assemble(correlationId);
  } catch (err) {
    console.warn('[transactionTrace] read failed:', err?.message);
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!record) return res.status(404).json({ error: 'not_found' });

  return res.json({
    ...record,
    traceId: traceIdFromCorrelation(record.correlationId),
    verdict: evaluate(record),
    reconciliation: reconcile(record),
  });
});

module.exports = router;
