'use strict';
/**
 * DataStore.createTransaction must preserve a caller-supplied createdAt/status.
 *
 * It used to hardcode `createdAt: new Date(), status: 'completed'`, clobbering
 * the real dates seeded sample history (routes/accounts.js provisionDemoAccounts)
 * and snapshot-restore callers pass in. Now those are honoured when present and
 * defaulted only when absent; `id` is always freshly generated.
 */

const dataStore = require('../data/store');

describe('createTransaction preserves caller createdAt/status', () => {
  beforeAll(() => {
    // Avoid the debounced disk write side effect during the test.
    jest.spyOn(dataStore, 'persistAllData').mockResolvedValue();
  });

  afterAll(() => jest.restoreAllMocks());

  it('keeps a caller-supplied createdAt and status', async () => {
    const createdAt = new Date('2024-03-01T09:00:00Z');
    const txn = await dataStore.createTransaction({
      userId: 'u1', amount: 3500, type: 'deposit', createdAt, status: 'pending',
    });

    expect(txn.createdAt).toBe(createdAt);
    expect(txn.status).toBe('pending');
    expect(txn.id).toBeTruthy();
  });

  it('still defaults createdAt/status when the caller omits them', async () => {
    const before = Date.now();
    const txn = await dataStore.createTransaction({ userId: 'u1', amount: 50, type: 'withdrawal' });

    expect(txn.status).toBe('completed');
    expect(txn.createdAt instanceof Date).toBe(true);
    expect(txn.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(txn.id).toBeTruthy();
  });

  it('always generates a unique id even across calls', async () => {
    const a = await dataStore.createTransaction({ userId: 'u1', amount: 1 });
    const b = await dataStore.createTransaction({ userId: 'u1', amount: 1 });
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });
});
