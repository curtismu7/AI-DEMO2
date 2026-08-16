'use strict';
/**
 * /api/prompt-flow — read-only view over transactionLedger.lmdb.js for the
 * Prompt Flow Inspector UI. Admin-session gated at the server.js mount level,
 * same pattern as GET /api/mcp/audit (routes/mcpAudit.js) — this router
 * itself carries no auth check.
 *
 * Both endpoints are pure reads against the ledger already populated by every
 * instrumented layer's hop emitter (Agent/LLM proxy/Gateway/P1AZ/Backend) —
 * no new store, no query-time join across services.
 */
const express = require('express');
const router = express.Router();
const ledger = require('../services/lmdb/transactionLedger.lmdb');

/** First non-empty `vertical` value found on any hop, else null. */
function _resolveVertical(hops) {
  for (const hop of hops) {
    const vertical = (hop && hop.details && hop.details.vertical) || (hop && hop.vertical);
    if (vertical) return vertical;
  }
  return null;
}

/**
 * 'error' if any hop in the run reports status 'error', OR if any hop
 * carries a P1AZ policy denial — an `authz.decision` hop reports
 * `status: 'ok'` even for a DENY verdict (demo_authz_server/routes/decision.js
 * _emitDecisionHop: status is always 'ok', the outcome lives in
 * `decision.outcome`), so without this check a run denied by authorization
 * would show as "ok" (green) in the run list. Folded into the existing
 * 'error' value rather than a new 'denied' status so the two-value contract
 * existing consumers (tests, UI) already assume stays intact.
 */
function _resolveStatus(hops) {
  const hasError = hops.some((hop) => hop && hop.status === 'error');
  const hasDenial = hops.some((hop) => hop && hop.decision && hop.decision.outcome === 'deny');
  return hasError || hasDenial ? 'error' : 'ok';
}

/**
 * GET /api/prompt-flow — list recent runs: distinct correlationId + latest
 * timestamp + summary status + vertical, paginated.
 * Query params: limit (default 50), offset (default 0)
 */
router.get('/', (req, res) => {
  const limitParam = parseInt(String(req.query.limit), 10);
  const offsetParam = parseInt(String(req.query.offset), 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0;

  try {
    const summaries = ledger.listRecords({ limit: offset + limit });
    const page = summaries.slice(offset, offset + limit);

    const runs = page.map((summary) => {
      const record = ledger.getRecord(summary.correlationId);
      const hops = (record && record.hops) || [];
      return {
        correlationId: summary.correlationId,
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        hopCount: summary.hopCount,
        principal: summary.principal,
        status: _resolveStatus(hops),
        vertical: _resolveVertical(hops),
      };
    });

    return res.json({ runs, limit, offset });
  } catch (err) {
    // A read failure should degrade to an empty list, not a 500 that breaks
    // the admin page — mirrors routes/mcpAudit.js.
    console.warn('[promptFlow] list failed:', err?.message);
    return res.json({ runs: [], limit, offset });
  }
});

/**
 * GET /api/prompt-flow/:correlationId — all ledger hops for that run,
 * ordered by timestamp, each carrying its full `details` payload.
 */
router.get('/:correlationId', (req, res) => {
  try {
    const record = ledger.getRecord(req.params.correlationId);
    if (!record) {
      // Missing/unknown correlationId -> empty result, not an error.
      return res.json({ correlationId: req.params.correlationId, hops: [] });
    }
    const hops = [...record.hops].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return res.json({
      correlationId: record.correlationId,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      principal: record.principal,
      hops,
    });
  } catch (err) {
    console.warn('[promptFlow] detail failed:', err?.message);
    return res.json({ correlationId: req.params.correlationId, hops: [] });
  }
});

module.exports = router;
