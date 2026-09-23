'use strict';

/**
 * Short-lived, single-use receipts for one specific pending write. Real CIBA
 * receipts are distinguished from ordinary HITL consent so only verified
 * out-of-band authentication can satisfy a step-up policy.
 *
 * The MCP/agent execution path (oauth-mcp's BankingAPIClient) calls
 * back into POST /api/transactions over a bearer token only — no session
 * cookie — so the session-based hitlVerified bypass in routes/transactions.js
 * can never see it there. Bind the receipt to the subject, tool, amount, and
 * both account IDs; a different transfer cannot spend the approval.
 */

const TTL_MS = 5 * 60 * 1000; // mirrors ciba.js's STEP_UP_TTL_MS

const receipts = new Map();
const claims = new Map();

function key(userId, tool, amount, accounts = {}) {
  return JSON.stringify([
    userId, tool, Number(amount).toFixed(2),
    accounts.fromAccountId || null, accounts.toAccountId || null,
  ]);
}

function record(userId, tool, amount, accounts = {}) {
  if (!userId || !tool || !Number.isFinite(Number(amount))) return;
  const k = key(userId, tool, amount, accounts);
  const existingProof = receipts.get(k)?.proofType;
  if (existingProof === 'ciba' && accounts.proofType !== 'ciba') return;
  if (existingProof === 'simulated_ciba' && !['ciba', 'simulated_ciba'].includes(accounts.proofType)) return;
  receipts.set(k, {
    expiresAt: Date.now() + TTL_MS,
    proofType: ['ciba', 'simulated_ciba'].includes(accounts.proofType) ? accounts.proofType : 'hitl',
  });
}

/** Reserve a receipt while authorization and the balance write run. */
function claim(userId, tool, amount, accounts = {}) {
  if (!Number.isFinite(Number(amount))) return null;
  const k = key(userId, tool, amount, accounts);
  const receipt = receipts.get(k);
  if (!receipt || receipt.expiresAt <= Date.now() || claims.has(k)) return null;
  const ticket = { key: k, nonce: Symbol('ciba-receipt'), proofType: receipt.proofType };
  claims.set(k, ticket.nonce);
  return ticket;
}

function release(ticket) {
  if (ticket && claims.get(ticket.key) === ticket.nonce) claims.delete(ticket.key);
}

function isClaimValid(ticket) {
  return Boolean(ticket && claims.get(ticket.key) === ticket.nonce
    && receipts.get(ticket.key)?.expiresAt > Date.now());
}

function consumeClaim(ticket) {
  if (!ticket || claims.get(ticket.key) !== ticket.nonce) return false;
  claims.delete(ticket.key);
  receipts.delete(ticket.key);
  return true;
}

/** Single-use: consumes and returns true only if a still-valid receipt exists. */
function consume(userId, tool, amount, accounts = {}) {
  if (!Number.isFinite(Number(amount))) return false;
  const k = key(userId, tool, amount, accounts);
  const receipt = receipts.get(k);
  if (receipt === undefined) return false;
  receipts.delete(k);
  claims.delete(k);
  return receipt.expiresAt > Date.now();
}

// A receipt whose bearer-token retry never happens (abandoned retry, amount
// mismatch, or the transfer going through the session-based hitlCredit.js
// path instead) is only ever cleaned up reactively inside consume() -- never
// proactively -- so it would otherwise sit in the Map for the life of the
// process. Mirrors the periodic-sweep pattern in http2McpBridge.js.
function _sweepExpired() {
  const now = Date.now();
  for (const [k, receipt] of receipts) {
    if (receipt.expiresAt <= now) receipts.delete(k);
  }
}
setInterval(_sweepExpired, TTL_MS).unref();

module.exports = { record, claim, release, isClaimValid, consumeClaim, consume, _receiptCountForTests: () => receipts.size };
