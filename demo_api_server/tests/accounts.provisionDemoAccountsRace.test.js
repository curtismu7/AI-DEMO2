/**
 * finding #70: GET /api/demo-scenario had an unguarded check-then-act — when a
 * brand-new user's accounts were empty, it called provisionDemoAccounts(uid).
 * Two overlapping requests for the same new user (two tabs, a double-invoked
 * mount effect) both observed zero accounts and both ran full provisioning.
 * Account records self-heal (deterministic ids just get overwritten), but the
 * ~11 sample transactions createTransaction mints always get a fresh random id
 * with no dedup — each concurrent call inserted its own full set, permanently
 * duplicating the user's transaction history.
 *
 * Proves a second overlapping caller for the SAME userId awaits the first
 * call's in-flight promise instead of re-running provisioning, so only one
 * set of sample transactions is created.
 */
'use strict';

// ─── Mutable state shared across mocks ───────────────────────────────────────
const _state = {
  accounts: [],
};

// ─── Mock: data/store — mirrors demo_api_server/src/__tests__/accounts-cold-start.test.js ──
jest.mock('../data/store', () => ({
  getAccountsByUserId: jest.fn((userId) => _state.accounts.filter((a) => a.userId === userId)),
  getAccountById: jest.fn((id) => _state.accounts.find((a) => a.id === id) || null),
  createAccount: jest.fn(async (data) => {
    const acct = { ...data };
    _state.accounts = _state.accounts.filter((a) => a.id !== acct.id);
    _state.accounts.push(acct);
    return acct;
  }),
  deleteAccount: jest.fn(async (id) => {
    _state.accounts = _state.accounts.filter((a) => a.id !== id);
  }),
  getTransactionsByUserId: jest.fn(() => []),
  deleteTransaction: jest.fn(async () => {}),
  createTransaction: jest.fn(async (data) => ({ id: `txn-${Math.random()}`, ...data })),
}));

jest.mock('../services/demoScenarioStore', () => ({
  load: jest.fn(async () => ({ accountSnapshot: [] })),
  save: jest.fn(async () => {}),
  isPersistenceConfigured: jest.fn(() => true),
}));

const dataStore = require('../data/store');
const accountsRouter = require('../routes/accounts');

beforeEach(() => {
  _state.accounts = [];
  jest.clearAllMocks();
});

describe('provisionDemoAccounts — concurrent first-load race (finding #70)', () => {
  test('two overlapping calls for the same new user create sample transactions only once', async () => {
    const userId = 'new-user-race-1';

    const [accountsA, accountsB] = await Promise.all([
      accountsRouter.provisionDemoAccounts(userId),
      accountsRouter.provisionDemoAccounts(userId),
    ]);

    // Both callers get the same provisioned account set.
    expect(accountsA.map((a) => a.id)).toEqual(accountsB.map((a) => a.id));

    // The seed transaction batch is 11 rows — must be inserted exactly once,
    // not once per overlapping caller.
    expect(dataStore.createTransaction).toHaveBeenCalledTimes(11);
  });
});
