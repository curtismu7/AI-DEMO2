'use strict';
/**
 * Second-witness reconciliation for one transaction.
 *
 * The ledger is the primary witness. These sources are written by DIFFERENT
 * code paths, at different times, to different stores, so agreement between
 * them is real evidence — tampering with one and not the other is detectable.
 *
 * Deliberately NOT witnesses:
 *   - tokenChainService — transactionAssembler already derives token.exchange
 *     hops from it, so it would corroborate the record against itself.
 *   - authz auditDecision — stdout only; no file, no store, no reader.
 *   - mcpToolAuditStore — self-documented as a non-durable 200-event ring
 *     buffer; it would report false mismatches after every restart.
 *
 * SOURCE_UNAVAILABLE is never a violation. An empty or unreadable witness means
 * we cannot corroborate, not that someone tampered.
 */
const auditStore = require('./lmdb/mcpAuditStore.lmdb');
const trafficLogger = require('./mcpTrafficLogger');

const SCAN_LIMIT = 5000; // mcpAuditStore.query has no correlationId filter

/**
 * Compare two multisets of operation names and report both directions.
 * Counts matter: a witness that saw one call twice while the ledger recorded it
 * once is exactly the replay signal this exists to surface.
 */
function _diffOps(source, ledgerOps, witnessOps) {
  const diffs = [];
  const counts = new Map();
  for (const op of ledgerOps) counts.set(op, (counts.get(op) || 0) + 1);
  for (const op of witnessOps) counts.set(op, (counts.get(op) || 0) - 1);

  for (const [op, delta] of counts) {
    if (delta === 0) continue;
    const side = delta > 0 ? 'ledger_only' : 'witness_only';
    diffs.push({
      source,
      side,
      op,
      detail: delta > 0
        ? `ledger recorded "${op}" ${delta} more time(s) than ${source} did`
        : `${source} recorded "${op}" ${-delta} more time(s) than the ledger did`,
    });
  }
  return diffs;
}

// Corroborates the ledger's `gateway.authorize` hops against rows the MCP
// gateway ships to POST /internal/mcp-audit, persisted by
// services/lmdb/mcpAuditStore.lmdb.js. Contract this depends on — check both
// ends before trusting this witness:
//   - demo_mcp_gateway/src/gatewayAudit.ts:74-76 stamps `correlationId` on
//     every GatewayAuditEvent it POSTs.
//   - demo_api_server/routes/mcpAuditIngest.js:49-58 passes that event
//     through to `mcpAuditStore.append({ ..., correlationId: ev.correlationId
//     || null, ... })` — correlationId must stay in that whitelist, or every
//     row lands with no correlationId and this witness silently degenerates
//     back to a permanent no-op (the bug this file was fixed for).
function _reconcileGatewayAudit(record) {
  let rows;
  try {
    rows = auditStore.query({ limit: SCAN_LIMIT });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[transactionReconciler] mcpAuditStore read failed:', err?.message);
    return { status: 'SOURCE_UNAVAILABLE', diffs: [], reason: 'read_failed' };
  }
  // Zero rows for ANY transaction means the store was wiped or never written —
  // a fresh restart, not evidence of tampering.
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: 'SOURCE_UNAVAILABLE', diffs: [], reason: 'store_empty' };
  }

  const ledgerOps = record.hops
    .filter((h) => h.phase === 'gateway.authorize' && h.op)
    .map((h) => String(h.op));
  const witnessOps = rows
    .filter((r) => r.correlationId === record.correlationId && r.operation)
    .map((r) => String(r.operation));

  const diffs = _diffOps('mcpAuditStore', ledgerOps, witnessOps);
  return { status: diffs.length ? 'MISMATCH' : 'MATCH', diffs };
}

// Corroborates the ledger's `mcp.tool` hops (tool executions, keyed by tool
// name in `op`) against BFF->MCP `tools/call` round-trips recorded in the MCP
// traffic log. Contract this depends on — check both producers before
// trusting this witness:
//   - demo_api_server/services/mcpLocalTools.js:669-674 (and the error path
//     at :658-663) — in-process local tool dispatch — calls
//     writeMcpTrafficEntry({ type: 'rpc_response', method: 'tools/call',
//     tool, correlationId, ok }) on every completed call.
//   - demo_api_server/services/mcpWebSocketClient.js:454-465 — the WS
//     gateway round-trip — calls writeMcpTrafficEntry with the same shape
//     ({ type: 'rpc_response', method: followMethod, tool: followParams.name,
//     correlationId, ok: true }) when followMethod is 'tools/call'.
//
// What this does NOT corroborate: `authz.decision` hops have no witness here
// or anywhere else. The only traffic-log entry type that could plausibly
// stand in for an authorize decision, `authorize_response`, is never actually
// emitted by any writeMcpTrafficEntry() call site — it exists solely as an
// aspirational type in mcpTrafficLogger.js's JSDoc. Do not read `MATCH` on
// this source as vouching for authz.decision hops; it does not.
function _reconcileTrafficLog(record) {
  let lines;
  try {
    lines = trafficLogger.getMcpTrafficLog(SCAN_LIMIT);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[transactionReconciler] traffic log read failed:', err?.message);
    return { status: 'SOURCE_UNAVAILABLE', diffs: [], reason: 'read_failed' };
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return { status: 'SOURCE_UNAVAILABLE', diffs: [], reason: 'buffer_empty' };
  }

  const ledgerOps = record.hops
    .filter((h) => h.phase === 'mcp.tool' && h.op)
    .map((h) => String(h.op));
  const witnessOps = lines
    .filter((l) => l.correlationId === record.correlationId && l.type === 'rpc_response' && l.method === 'tools/call' && l.tool)
    .map((l) => String(l.tool));

  const diffs = _diffOps('mcpTrafficLog', ledgerOps, witnessOps);
  return { status: diffs.length ? 'MISMATCH' : 'MATCH', diffs };
}

/**
 * @param {object} record  assembled transaction ({ correlationId, hops })
 * @returns {{status: string, diffs: object[], sources: object}}
 */
function reconcile(record) {
  const safe = { correlationId: record?.correlationId, hops: (record && record.hops) || [] };
  const sources = {
    mcpAuditStore: _reconcileGatewayAudit(safe),
    mcpTrafficLog: _reconcileTrafficLog(safe),
  };
  const diffs = Object.values(sources).flatMap((s) => s.diffs);
  const values = Object.values(sources);

  const status = diffs.length
    ? 'MISMATCH'
    : values.every((s) => s.status === 'SOURCE_UNAVAILABLE')
      ? 'SOURCE_UNAVAILABLE'
      : 'MATCH';

  return { status, diffs, sources };
}

module.exports = { reconcile };
