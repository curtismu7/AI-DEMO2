'use strict';

/**
 * HITL receipt binding rules — the authoritative copy.
 *
 * A receipt (`_hitl_challenge_id`) is only spendable by the exact caller,
 * agent, tool and arguments it was minted for. Without this an approved
 * receipt for {userA, agentA, create_transfer, $10} could be replayed by
 * {userB, agentB, pay_bill, $5000}.
 *
 * This module exists because PingGateway (IG) is now a HITL emission point
 * too, and Groovy cannot reuse the gateway's TypeScript implementation
 * (`demo_mcp_gateway/src/hitlClient.ts` `verifyHitlReceipt`). Rather than
 * hand-porting the rules into a third language where they would drift, IG
 * calls `POST /challenges/:id/verify` and this module answers.
 *
 * Rules are fail-closed on absent fields: when an expected value is supplied
 * but the receipt's is missing, REJECT. Only when neither side carries a value
 * is a check skipped.
 */

/** Account / payee fields bound into HITL receipts (same-amount recipient swap defense). */
const HITL_BIND_ACCOUNT_KEYS = [
  'to_account_id',
  'from_account_id',
  'account_id',
  'toAccountId',
  'fromAccountId',
];

/** Normalize a non-empty string field for HITL binding comparison. */
function normalizeField(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Normalize a transaction amount for HITL receipt binding. */
function normalizeAmount(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} challenge - a challenge record from challengeStore
 * @param {object} expected
 * @param {string} [expected.userId]  - `sub` of the inbound bearer
 * @param {string} [expected.agentId] - `act.sub` of the inbound bearer
 * @param {string} [expected.tool]    - tool name on the retry
 * @param {object} [expected.params]  - tool args on the retry (amount + account ids)
 * @param {number} [now]
 * @returns {{ ok: boolean, message?: string }}
 */
function verifyReceipt(challenge, expected = {}, now = Date.now()) {
  if (!challenge) return { ok: false, message: 'HITL challenge not found' };

  if (challenge.status !== 'approved') {
    return { ok: false, message: `HITL challenge not approved (status: ${challenge.status})` };
  }

  // Expired-but-approved receipts must NOT be honoured — the store only marks
  // *pending* challenges expired at read time, so an approved-then-aged
  // challenge can still read as approved.
  if (challenge.expiresAt) {
    const expiryMs = typeof challenge.expiresAt === 'number'
      ? challenge.expiresAt
      : Date.parse(challenge.expiresAt);
    if (Number.isFinite(expiryMs) && expiryMs < now) {
      return { ok: false, message: 'HITL challenge expired' };
    }
  }

  if (expected.userId && (!challenge.userId || challenge.userId !== expected.userId)) {
    return { ok: false, message: 'HITL challenge belongs to a different user' };
  }
  if (expected.agentId && (!challenge.agentId || challenge.agentId !== expected.agentId)) {
    return { ok: false, message: 'HITL challenge belongs to a different agent' };
  }
  if (expected.tool && (!challenge.tool || challenge.tool !== expected.tool)) {
    return { ok: false, message: 'HITL challenge belongs to a different tool' };
  }

  const ctx = challenge.context && typeof challenge.context === 'object' ? challenge.context : {};
  const params = expected.params && typeof expected.params === 'object' ? expected.params : {};

  // Amount binding (two-sided): a $250 receipt must not discharge a $499 retry,
  // and a receipt with a bound amount must not discharge a retry that omits it.
  const expectedAmt = normalizeAmount(
    expected.amount !== undefined && expected.amount !== null && expected.amount !== ''
      ? expected.amount
      : params.amount,
  );
  const receiptAmt = normalizeAmount(ctx.amount);
  if (receiptAmt != null || expectedAmt != null) {
    if (receiptAmt == null) return { ok: false, message: 'HITL challenge has no bound amount' };
    if (expectedAmt == null) return { ok: false, message: 'HITL retry missing amount bound on challenge' };
    if (receiptAmt !== expectedAmt) {
      return { ok: false, message: 'HITL challenge belongs to a different amount' };
    }
  }

  // Payee / source binding: a same-amount recipient swap after consent must fail.
  for (const key of HITL_BIND_ACCOUNT_KEYS) {
    const receiptVal = normalizeField(ctx[key]);
    const expectedVal = normalizeField(params[key]);
    if (receiptVal == null && expectedVal == null) continue;
    if (receiptVal == null) return { ok: false, message: `HITL challenge has no bound ${key}` };
    if (expectedVal == null) return { ok: false, message: `HITL retry missing ${key} bound on challenge` };
    if (receiptVal !== expectedVal) {
      return { ok: false, message: `HITL challenge belongs to a different ${key}` };
    }
  }

  return { ok: true };
}

module.exports = { verifyReceipt, HITL_BIND_ACCOUNT_KEYS };
