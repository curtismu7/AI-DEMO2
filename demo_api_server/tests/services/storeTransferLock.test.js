'use strict';
// The per-account transfer lock chain (data/store.js _acquireLock) — pinned
// after the bug-hunt honourable mention: applyTransfer's finally deleted the
// map key UNCONDITIONALLY, severing the chain for any queued waiter. Benign
// only while the critical section stays fully synchronous; the moment anything
// awaits inside, two holders could interleave. The release now cleans up its
// own entry iff nobody chained behind it.

describe('store _acquireLock chain integrity', () => {
  let store;
  beforeEach(() => {
    jest.resetModules();
    store = require('../../data/store');
  });

  test('uncontended acquire/release forgets the key', async () => {
    const release = await store._acquireLock('acct-X');
    expect(store._transferLocks.has('acct-X')).toBe(true);
    release();
    // Release is synchronous cleanup; the entry must be gone at once.
    expect(store._transferLocks.has('acct-X')).toBe(false);
  });

  test('a queued waiter survives the first holder releasing', async () => {
    const releaseA = await store._acquireLock('acct-Y');
    const bPending = store._acquireLock('acct-Y'); // queued behind A
    releaseA();
    // A released while B is chained: the key must STILL be present — the old
    // unconditional delete removed it here, so a third caller started a fresh
    // chain alongside B.
    expect(store._transferLocks.has('acct-Y')).toBe(true);
    const releaseB = await bPending;
    releaseB();
    expect(store._transferLocks.has('acct-Y')).toBe(false);
  });

  test('serialization holds across an await inside the critical section', async () => {
    const order = [];
    const hold = async (label, ms) => {
      const release = await store._acquireLock('acct-Z');
      order.push(`${label}-in`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${label}-out`);
      release();
    };
    await Promise.all([hold('A', 30), hold('B', 5)]);
    expect(order).toEqual(['A-in', 'A-out', 'B-in', 'B-out']);
  });
});
