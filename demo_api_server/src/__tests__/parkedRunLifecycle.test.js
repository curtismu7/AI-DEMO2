'use strict';
/**
 * What happens to a run that is waiting on an absent human: approved (the money
 * finally moves), denied (nothing moves), or expired (nobody answered in time).
 *
 * Mocks are required inside each test — setup.js resets modules per test.
 */

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true') }));
jest.mock('../../services/lmdb/autonomousRunStore.lmdb', () => {
  const runs = new Map();
  return {
    __runs: runs,
    append: jest.fn((r) => { const s = { ...r, runId: r.runId || 'aur-1' }; runs.set(s.runId, s); return s; }),
    get: jest.fn((id) => runs.get(id) || null),
    update: jest.fn((id, patch) => {
      const cur = runs.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      runs.set(id, next);
      return next;
    }),
    list: jest.fn(() => [...runs.values()]),
  };
});

const PARKED = {
  runId: 'aur-1',
  job: 'balance-sweep',
  status: 'parked',
  agent: 'Super Banking Balance Sweep Agent',
  proposal: { fromAccountId: 'chk-1', amount: 1400, fromName: 'Everyday Checking' },
  pending: { authReqId: 'sim-abc', initiatedAt: Date.now(), expiresIn: 300, loginHint: 'u1' },
};

function load(seed = PARKED) {
  const store = require('../../services/lmdb/autonomousRunStore.lmdb');
  store.__runs.clear();
  store.__runs.set(seed.runId, { ...seed });
  return { store, scheduler: require('../../services/autonomousAgentScheduler') };
}

test('approving executes the transfer the run was holding', async () => {
  const { store, scheduler } = load();
  const createTransaction = jest.fn(async () => ({ id: 'txn-9' }));

  const run = await scheduler.approveParkedRun('aur-1', { createTransaction });

  expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({
    fromAccountId: 'chk-1', amount: 1400, type: 'transfer',
  }));
  expect(run.status).toBe('completed');
  expect(run.findings[0]).toMatchObject({ executed: true, transactionId: 'txn-9' });
  expect(store.update).toHaveBeenCalled();
});

test('denying moves nothing and records who declined', async () => {
  const { scheduler } = load();

  const run = scheduler.denyParkedRun('aur-1');

  expect(run.status).toBe('denied');
  expect(run.summary).toContain('u1');
  expect(run.findings).toBeUndefined();
});

// The window matters: approving after it closes must not move money.
test('approving an expired request expires it instead of transferring', async () => {
  const { scheduler } = load({
    ...PARKED,
    pending: { ...PARKED.pending, initiatedAt: Date.now() - 10 * 60 * 1000, expiresIn: 300 },
  });
  const createTransaction = jest.fn();

  const run = await scheduler.approveParkedRun('aur-1', { createTransaction });

  expect(run.status).toBe('expired');
  expect(createTransaction).not.toHaveBeenCalled();
});

test('a run that is not parked cannot be approved twice', async () => {
  const { scheduler } = load({ ...PARKED, status: 'completed' });

  await expect(scheduler.approveParkedRun('aur-1', { createTransaction: jest.fn() }))
    .rejects.toThrow(/not parked/);
});

test('an unknown run is a 404, not a silent no-op', async () => {
  const { scheduler } = load();

  await expect(scheduler.approveParkedRun('nope', { createTransaction: jest.fn() }))
    .rejects.toMatchObject({ message: 'run_not_found', httpStatus: 404 });
});

// If the transfer itself fails after approval, the run must say so rather than
// reporting a completed sweep that never moved anything.
test('a failed transfer after approval is recorded as failed', async () => {
  const { scheduler } = load();
  const createTransaction = jest.fn(async () => { throw new Error('insufficient funds'); });

  const run = await scheduler.approveParkedRun('aur-1', { createTransaction });

  expect(run.status).toBe('failed');
  expect(run.error).toContain('insufficient funds');
});
