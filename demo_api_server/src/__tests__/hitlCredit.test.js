'use strict';

// Unit tests for the amount-bound, consume-on-use CIBA HITL-consent credit.
// Locks in the 2026-07-24 code-review fixes:
//   #1 amount-binding — a credit minted for a small transfer must NOT discharge
//      consent for a larger one.
//   #3 consume-on-use — consume() is what spends the credit; isFresh() never does.

const hitlCredit = require('../../services/hitlCredit');

const future = () => Date.now() + 60_000;
const past = () => Date.now() - 1;

describe('hitlCredit.isFresh', () => {
  test('no session / no credit → not fresh', () => {
    expect(hitlCredit.isFresh(undefined, { amount: 10 })).toBe(false);
    expect(hitlCredit.isFresh({}, { amount: 10 })).toBe(false);
  });

  test('expired credit → not fresh', () => {
    expect(hitlCredit.isFresh({ hitlVerified: past(), hitlApprovedAmount: 100 }, { amount: 10 })).toBe(false);
  });

  test('unbound credit (approvedAmount null) → fresh regardless of amount', () => {
    const s = { hitlVerified: future(), hitlApprovedAmount: null };
    expect(hitlCredit.isFresh(s, { amount: 999999 })).toBe(true);
    expect(hitlCredit.isFresh(s, {})).toBe(true);
  });

  test('bound credit → fresh when amount <= approved (equal and below)', () => {
    const s = { hitlVerified: future(), hitlApprovedAmount: 50 };
    expect(hitlCredit.isFresh(s, { amount: 50 })).toBe(true);
    expect(hitlCredit.isFresh(s, { amount: 25 })).toBe(true);
  });

  test('#1 security: bound credit → NOT fresh when amount > approved', () => {
    const s = { hitlVerified: future(), hitlApprovedAmount: 50 };
    expect(hitlCredit.isFresh(s, { amount: 50000 })).toBe(false);
    expect(hitlCredit.isFresh(s, { amount: 51 })).toBe(false);
  });

  test('bound credit + caller omits amount → opts out of binding, fresh (non-write tools only)', () => {
    // Write tools must pass { amount } — see mcpToolAuthorizationService.
    // Omitting amount is only for non-amount HITL consumers.
    const s = { hitlVerified: future(), hitlApprovedAmount: 50 };
    expect(hitlCredit.isFresh(s)).toBe(true);
  });

  test('isFresh does NOT consume (consume-on-use — reading twice stays fresh)', () => {
    const s = { hitlVerified: future(), hitlApprovedAmount: 50 };
    expect(hitlCredit.isFresh(s, { amount: 50 })).toBe(true);
    expect(hitlCredit.isFresh(s, { amount: 50 })).toBe(true);
    expect(s.hitlVerified).toBeGreaterThan(Date.now());
  });
});

describe('hitlCredit.consume', () => {
  test('zeroes both fields; a consumed credit is no longer fresh', () => {
    const s = { hitlVerified: future(), hitlApprovedAmount: 50 };
    hitlCredit.consume(s);
    expect(s.hitlVerified).toBe(0);
    expect(s.hitlApprovedAmount).toBe(null);
    expect(hitlCredit.isFresh(s, { amount: 50 })).toBe(false);
  });

  test('no-ops safely without a session', () => {
    expect(() => hitlCredit.consume(undefined)).not.toThrow();
  });
});
