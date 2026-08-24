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
//     (legacy behavior). Callers that have a transfer amount MUST pass it —
//     mcpToolAuthorizationService does for write tools. Omitting amount opts out
//     of the check and is only correct for non-amount consumers (tool-level HITL
//     with no dollar figure).
//   - Consume-on-use: callers read isFresh() first and call consume() ONLY when the
//     credit actually discharged a gate this request. An unrelated request therefore
//     never burns the credit, which prevents cross-consumer starvation between the
//     REST (routes/transactions.js) and MCP (mcpToolAuthorizationService.js)
//     authorization engines sharing this one session flag.

/**
 * @param {object|undefined} session - req.session
 * @param {{ amount?: number }} [opts] - transfer amount for amount-binding; omit only
 *   when the caller has no amount (non-write MCP tools). Write tools must pass amount.
 * @returns {boolean} true when a live credit applies to this request.
 */
function isFresh(session, { amount } = {}) {
  if (!session || !(session.hitlVerified > Date.now())) return false;
  const approved = session.hitlApprovedAmount;
  if (approved == null) return true;        // unbound credit — discharge as before
  if (amount == null) return true;          // caller opted out of amount binding
  return Number(amount) <= Number(approved); // bound — only within the approved amount
}

// express-session gives each concurrent request its own independently-loaded
// session snapshot (saved back separately at response time), so a flag set on
// req.session in one request is invisible to a second request already in
// flight on the same session — an in-session-object guard cannot serialize
// them. claim()/release() add a real cross-request lock via a process-local
// Map keyed by session id (same reason cibaTransactionReceipt.js keeps its
// own state out of the session object entirely). The claim self-expires
// after CLAIM_TTL_MS so a caller that determines the credit wasn't actually
// needed and never calls release() doesn't wedge the credit for longer than
// it takes any of this module's callers to complete their awaited policy
// evaluation — short enough to preserve the original consume-on-use
// anti-starvation intent for any caller that can't call release() on every
// return path.
const CLAIM_TTL_MS = 3000;
const _claims = new Map(); // sessionId -> expiresAt

/**
 * Atomically check-and-claim the credit so a second concurrent request on
 * the same session can't also see it as fresh while this request's awaited
 * policy evaluation is still in flight. Callers that determine the credit
 * wasn't actually needed should call release() to free it immediately
 * instead of waiting out CLAIM_TTL_MS.
 */
function claim(session, { amount } = {}) {
  if (!isFresh(session, { amount })) return false;
  const sid = session.id;
  if (sid) {
    const claimedUntil = _claims.get(sid);
    if (claimedUntil && claimedUntil > Date.now()) return false; // held by a concurrent request
    _claims.set(sid, Date.now() + CLAIM_TTL_MS);
  }
  return true;
}

/** Release a claim taken via claim() when it turned out not to be needed. */
function release(session) {
  if (session && session.id) _claims.delete(session.id);
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
  if (session.id) _claims.delete(session.id);
}

module.exports = { isFresh, consume, claim, release };
