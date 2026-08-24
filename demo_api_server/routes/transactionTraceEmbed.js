'use strict';
/**
 * /api/transaction-trace/embed/:correlationId — the compact reel's data.
 *
 * docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md §4:
 * reached from inside a client that has no BFF session (an LM Studio link, a
 * LibreChat artifact iframe), so there is no auth gate — it exposes only what a
 * single known correlationId already reveals, and the façade mints those as
 * random UUIDs. Same data as the authenticated detail route minus the
 * verdict/reconciliation extras the embed does not render.
 */
const express = require('express');
const router = express.Router();
const { assemble } = require('../services/transactionAssembler');
const configStore = require('../services/configStore');

router.get('/:correlationId', async (req, res) => {
  if (configStore.getEffective('ff_transaction_ledger') === 'false') {
    return res.status(403).json({ error: 'feature_disabled' });
  }
  let record;
  try {
    record = await assemble(req.params.correlationId);
  } catch (err) {
    console.warn('[transactionTraceEmbed] read failed:', err?.message);
    return res.status(500).json({ error: 'internal_error' });
  }
  if (!record) return res.status(404).json({ error: 'not_found' });
  res.set('Cache-Control', 'no-store');
  return res.json({
    correlationId: record.correlationId,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    hops: record.hops,
  });
});

module.exports = router;
