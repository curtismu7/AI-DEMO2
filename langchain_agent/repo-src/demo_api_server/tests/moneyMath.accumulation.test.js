// demo_api_server/tests/moneyMath.accumulation.test.js
//
// Money-math regression guard (Code Maturity item 2). Balances are stored as
// JS Number (float64), so naively accumulating cent-rounded deltas drifts:
// adding 0.10 a hundred times yields 9.99999999999998, not 10. Every mutation
// path that touches a stored balance must re-round to whole cents so the stored
// value can never carry binary-float residue. This suite exercises the two
// mutation entry points — updateAccountBalance (deposit/withdraw deltas) and
// applyTransfer (atomic moves) — across long runs and boundary amounts.
'use strict';

const dataStore = require('../data/store');

// A stored balance must always be an exact number of cents — i.e. multiplying
// by 100 yields an integer with no float residue.
function expectWholeCents(balance) {
  const cents = balance * 100;
  expect(Math.abs(cents - Math.round(cents))).toBeLessThan(1e-9);
}

describe('money-math — stored balances never drift off whole cents', () => {
  beforeEach(() => {
    jest.spyOn(dataStore, 'persistAllData').mockResolvedValue(undefined);
    dataStore.accounts.clear();
    dataStore.accounts.set('A', { id: 'A', userId: 'u', accountType: 'checking', balance: 0 });
    dataStore.accounts.set('B', { id: 'B', userId: 'u', accountType: 'savings', balance: 0 });
  });

  afterEach(() => jest.restoreAllMocks());

  describe('updateAccountBalance', () => {
    test('100 deposits of $0.10 sum to exactly $10.00 (no float drift)', async () => {
      for (let i = 0; i < 100; i++) {
        await dataStore.updateAccountBalance('A', 0.10);
      }
      expect(dataStore.getAccountById('A').balance).toBe(10);
      expectWholeCents(dataStore.getAccountById('A').balance);
    });

    test('mixed deposits and withdrawals net to an exact cent value', async () => {
      // +0.01 x 300, -0.03 x 100  =>  3.00 - 3.00 = 0.00
      for (let i = 0; i < 300; i++) await dataStore.updateAccountBalance('A', 0.01);
      for (let i = 0; i < 100; i++) await dataStore.updateAccountBalance('A', -0.03);
      expect(dataStore.getAccountById('A').balance).toBe(0);
      expectWholeCents(dataStore.getAccountById('A').balance);
    });

    test('accumulating a third-of-a-dollar delta stays on whole cents', async () => {
      // 0.33 is not representable exactly; 1000 additions must not accumulate residue.
      for (let i = 0; i < 1000; i++) await dataStore.updateAccountBalance('A', 0.33);
      expect(dataStore.getAccountById('A').balance).toBe(330);
      expectWholeCents(dataStore.getAccountById('A').balance);
    });

    test('half-cent boundary deltas are rounded into the stored balance', async () => {
      await dataStore.updateAccountBalance('A', 10.005); // → 10.01
      expect(dataStore.getAccountById('A').balance).toBe(10.01);
      expectWholeCents(dataStore.getAccountById('A').balance);
    });
  });

  describe('applyTransfer', () => {
    test('1000 one-cent transfers leave both balances on exact cents', async () => {
      dataStore.accounts.set('A', { id: 'A', userId: 'u', accountType: 'checking', balance: 100 });
      for (let i = 0; i < 1000; i++) {
        const r = await dataStore.applyTransfer('A', 'B', 0.01);
        expect(r.ok).toBe(true);
      }
      expect(dataStore.getAccountById('A').balance).toBe(90);
      expect(dataStore.getAccountById('B').balance).toBe(10);
      expectWholeCents(dataStore.getAccountById('A').balance);
      expectWholeCents(dataStore.getAccountById('B').balance);
    });

    test('a round-trip transfer (A→B→A) restores the original balance', async () => {
      dataStore.accounts.set('A', { id: 'A', userId: 'u', accountType: 'checking', balance: 0.30 });
      for (let i = 0; i < 500; i++) {
        await dataStore.applyTransfer('A', 'B', 0.10);
        await dataStore.applyTransfer('B', 'A', 0.10);
      }
      expect(dataStore.getAccountById('A').balance).toBe(0.30);
      expect(dataStore.getAccountById('B').balance).toBe(0);
      expectWholeCents(dataStore.getAccountById('A').balance);
    });
  });
});
