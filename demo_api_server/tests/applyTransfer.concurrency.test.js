// demo_api_server/tests/applyTransfer.concurrency.test.js
//
// Regression guard for the balance read-modify-write race (Code Maturity
// CRITICAL-1). applyTransfer must do its existence + sufficient-funds check and
// both balance mutations in ONE synchronous critical section. If someone
// reintroduces an `await` between the check and the mutation, two concurrent
// full-balance debits would both succeed and overdraw — the first test catches
// exactly that.
'use strict';

const dataStore = require('../data/store');

describe('dataStore.applyTransfer — atomic balance moves', () => {
  beforeEach(() => {
    jest.spyOn(dataStore, 'persistAllData').mockResolvedValue(undefined);
    dataStore.accounts.clear();
    dataStore.accounts.set('A', { id: 'A', userId: 'u', accountType: 'checking', balance: 100 });
    dataStore.accounts.set('B', { id: 'B', userId: 'u', accountType: 'savings', balance: 0 });
  });

  afterEach(() => jest.restoreAllMocks());

  test('concurrent full-balance debits cannot overdraw (exactly one of two $100 debits wins)', async () => {
    const [r1, r2] = await Promise.all([
      dataStore.applyTransfer({ fromAccountId: 'A', toAccountId: 'B', amount: 100 }),
      dataStore.applyTransfer({ fromAccountId: 'A', toAccountId: 'B', amount: 100 }),
    ]);
    const successes = [r1, r2].filter((r) => r.ok).length;
    expect(successes).toBe(1);
    expect(dataStore.getAccountById('A').balance).toBe(0);   // never negative
    expect(dataStore.getAccountById('B').balance).toBe(100); // exactly one credit applied
  });

  test('insufficient funds is rejected and leaves balances untouched', async () => {
    const r = await dataStore.applyTransfer({ fromAccountId: 'A', toAccountId: 'B', amount: 250 });
    expect(r).toMatchObject({ ok: false, reason: 'insufficient_funds' });
    expect(dataStore.getAccountById('A').balance).toBe(100);
    expect(dataStore.getAccountById('B').balance).toBe(0);
  });

  test('rounds to cents on both sides', async () => {
    const r = await dataStore.applyTransfer({ fromAccountId: 'A', toAccountId: 'B', amount: 10.005 }); // → 10.01
    expect(r.ok).toBe(true);
    expect(dataStore.getAccountById('A').balance).toBe(89.99);
    expect(dataStore.getAccountById('B').balance).toBe(10.01);
  });

  test('deposit-only (no from) credits without a funds check', async () => {
    const r = await dataStore.applyTransfer({ fromAccountId: null, toAccountId: 'B', amount: 40 });
    expect(r.ok).toBe(true);
    expect(dataStore.getAccountById('B').balance).toBe(40);
  });

  test('unknown source account returns from_not_found', async () => {
    const r = await dataStore.applyTransfer({ fromAccountId: 'NOPE', toAccountId: 'B', amount: 10 });
    expect(r).toMatchObject({ ok: false, reason: 'from_not_found' });
  });

  test('non-positive / non-finite amount is rejected', async () => {
    expect(await dataStore.applyTransfer({ fromAccountId: 'A', toAccountId: 'B', amount: 0 }))
      .toMatchObject({ ok: false, reason: 'invalid_amount' });
    expect(await dataStore.applyTransfer({ fromAccountId: 'A', toAccountId: 'B', amount: -5 }))
      .toMatchObject({ ok: false, reason: 'invalid_amount' });
  });
});
