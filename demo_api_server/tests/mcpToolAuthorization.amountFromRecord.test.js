/**
 * A write tool that names a RECORD carries no amount of its own — the amount must
 * come from the record, never from a figure parsed out of the phrase.
 *
 * "pay bill 402" states an id, not a price. The heuristic reused that id as the
 * amount ({ amount: 402, recordId: "402" }), and `toolAmount` fed it straight into
 * PingOne Authorize as `Amount` — so a $20 bill was evaluated as a $402 payment
 * and could trip a consent/step-up/DENY rule it should never reach.
 *
 * `store.payBill(userId, billId)` ignores the amount entirely, so the money moved
 * was always right — only the POLICY DECISION was made on a fabricated number.
 * That is the worst possible bug for a demo about authorization.
 */
const { resolveAmountForPolicy } = require('../services/mcpToolAuthorizationService');
const { verticalManifest } = require('../services/verticalManifest');

describe('resolveAmountForPolicy — the policy must decide on the record, not the phrase', () => {
  const USER = 'test-user-amt';
  let realBill;

  beforeAll(() => {
    // Materialise this user's healthcare seed and grab a real outstanding bill.
    const plugin = verticalManifest.plugins.get('healthcare');
    const store = plugin.getDataStore();
    const bills = store.get(USER).billingHistory || [];
    realBill = bills[0];
    expect(realBill).toBeTruthy();
    expect(typeof realBill.amountDue).toBe('number');
  });

  test('pay_bill with a bill id resolves the BILL\'s amountDue, not the id', () => {
    const amount = resolveAmountForPolicy('pay_bill', { billId: realBill.id, amount: 402 }, 'healthcare', USER);
    expect(amount).toBe(realBill.amountDue);
    // The fabricated 402 must NOT survive.
    expect(amount).not.toBe(402);
  });

  test('recordId (what the heuristic emits) is honoured the same way', () => {
    const amount = resolveAmountForPolicy('pay_bill', { recordId: String(realBill.id) }, 'healthcare', USER);
    expect(amount).toBe(realBill.amountDue);
  });

  test('an amount-driven chip (no id) is untouched — the stated amount stands', () => {
    // "pay my $300 bill" -> { amount: 300 }, no id. The policy MUST still see 300.
    expect(resolveAmountForPolicy('pay_bill', { amount: 300 }, 'healthcare', USER)).toBeNull();
  });

  test('an unknown bill id does not invent an amount', () => {
    expect(resolveAmountForPolicy('pay_bill', { billId: '999999' }, 'healthcare', USER)).toBeNull();
  });

  test('non-record tools are untouched (banking transfers keep their stated amount)', () => {
    expect(resolveAmountForPolicy('create_transfer', { amount: 500 }, 'banking', USER)).toBeNull();
  });

  test('missing user / bad vertical fails soft (never throws into the gate)', () => {
    expect(resolveAmountForPolicy('pay_bill', { billId: '401' }, 'healthcare', null)).toBeNull();
    expect(resolveAmountForPolicy('pay_bill', { billId: '401' }, 'no-such-vertical', USER)).toBeNull();
  });
});
