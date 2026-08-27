'use strict';

/**
 * Short-lived, single-use receipts recording that CIBA out-of-band approval
 * (routes/ciba.js) already discharged HITL for one specific pending write.
 *
 * The MCP/agent execution path (demo_mcp_server's BankingAPIClient) calls
 * back into POST /api/transactions over a bearer token only — no session
 * cookie — so the session-based hitlVerified bypass in routes/transactions.js
 * can never see it there. Keyed by (userId, tool, amount) instead of session,
 * since that bearer-token request only carries the decoded token's user id.
 */

const TTL_MS = 5 * 60 * 1000; // mirrors ciba.js's STEP_UP_TTL_MS

const receipts = new Map();

function key(userId, tool, amount) {
  return `${userId}:${tool}:${Number(amount).toFixed(2)}`;
}

function record(userId, tool, amount) {
  if (!userId || !tool || !Number.isFinite(Number(amount))) return;
  receipts.set(key(userId, tool, amount), Date.now() + TTL_MS);
}

/** Single-use: consumes and returns true only if a still-valid receipt exists. */
function consume(userId, tool, amount) {
  const k = key(userId, tool, amount);
  const expiresAt = receipts.get(k);
  if (expiresAt === undefined) return false;
  receipts.delete(k);
  return expiresAt > Date.now();
}

// A receipt whose bearer-token retry never happens (abandoned retry, amount
// mismatch, or the transfer going through the session-based hitlCredit.js
// path instead) is only ever cleaned up reactively inside consume() -- never
// proactively -- so it would otherwise sit in the Map for the life of the
// process. Mirrors the periodic-sweep pattern in http2McpBridge.js.
function _sweepExpired() {
  const now = Date.now();
  for (const [k, expiresAt] of receipts) {
    if (expiresAt <= now) receipts.delete(k);
  }
}
setInterval(_sweepExpired, TTL_MS).unref();

module.exports = { record, consume, _receiptCountForTests: () => receipts.size };
