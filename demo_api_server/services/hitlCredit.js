'use strict';

// Single-use CIBA HITL-consent credit.
//
// routes/ciba.js mints this on out-of-band approval: it sets
// req.session.hitlVerified (an expiry timestamp) and req.session.hitlApprovedAmount
// (the transfer amount that was approved, or null when the CIBA request carried no
// amount context). A CIBA approval is itself a human-in-the-loop event, so on the
// immediate retry it discharges the separate HITL consent gate that
// routes/transactions.js and services/mcpToolAuthorizationService.js enforce.
//
// Two properties this module owns, both from the 2026-07-24 code review of the
// original hitlVerified fix:
//   - Amount-bound: a credit minted for a specific amount only discharges consent
//     for a transfer at or below that amount, so approving a small transfer cannot
//     silently authorize a larger unrelated one. A null approved amount is unbound
//     (legacy behavior); a caller that supplies no amount (the MCP tool gate, which
//     has no transfer amount) also opts out of the amount check.
//   - Consume-on-use: callers read isFresh() first and call consume() ONLY when the
//     credit actually discharged a gate this request. An unrelated request therefore
//     never burns the credit, which prevents cross-consumer starvation between the
//     REST (routes/transactions.js) and MCP (mcpToolAuthorizationService.js)
//     authorization engines sharing this one session flag.

/**
 * @param {object|undefined} session - req.session
 * @param {{ amount?: number }} [opts] - transfer amount for amount-binding; omit to
 *   opt out of the amount check (unbound consumers such as the MCP tool gate).
 * @returns {boolean} true when a live credit applies to this request.
 */
function isFresh(session, { amount } = {}) {
  if (!session || !(session.hitlVerified > Date.now())) return false;
  const approved = session.hitlApprovedAmount;
  if (approved == null) return true;        // unbound credit — discharge as before
  if (amount == null) return true;          // caller opted out of amount binding
  return Number(amount) <= Number(approved); // bound — only within the approved amount
}

/**
 * Spend the single-use credit. Idempotent; call only after isFresh() actually
 * discharged a gate this request.
 * @param {object|undefined} session - req.session
 */
function consume(session) {
  if (!session) return;
  session.hitlVerified = 0;
  session.hitlApprovedAmount = null;
}

module.exports = { isFresh, consume };
