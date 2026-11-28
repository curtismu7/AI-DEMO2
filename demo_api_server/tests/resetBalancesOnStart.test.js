'use strict';
const { resetBalancesOnStart, isEnabled } = require('../services/resetBalancesOnStart');

const BANK = { accountType: 'checking' };
const quiet = { log: jest.fn(), warn: jest.fn() };
function makeDeps({ users, accounts = {}, vertical = {}, provision = jest.fn(async () => []), env = {} }) {
  return {
    dataStore: { getAllUsers: () => users.map((id) => ({ id })), getAccountsByUserId: (id) => accounts[id] || [] },
    getVertical: async (id) => vertical[id] ?? null,
    provision, env, log: quiet,
  };
}

describe('resetBalancesOnStart', () => {
  test('re-provisions each banking user who has accounts, in order', async () => {
    const provision = jest.fn(async () => []);
    const r = await resetBalancesOnStart(makeDeps({ users: ['a', 'b'], accounts: { a: [BANK], b: [BANK] }, provision }));
    expect(provision.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(r).toEqual({ enabled: true, reset: 2, skipped: 0, failed: 0 });
  });

  test('skips a user with no accounts (nothing to reset, nothing created for them)', async () => {
    const provision = jest.fn();
    const r = await resetBalancesOnStart(makeDeps({ users: ['a'], accounts: {}, provision }));
    expect(provision).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  test('skips a user whose live data belongs to another vertical, resets banking and unknown ones', async () => {
    const provision = jest.fn(async () => []);
    const r = await resetBalancesOnStart(makeDeps({
      users: ['h', 'b', 'u'], accounts: { h: [BANK], b: [BANK], u: [BANK] }, vertical: { h: 'healthcare', b: 'banking' }, provision,
    }));
    expect(provision.mock.calls.map((c) => c[0])).toEqual(['b', 'u']);
    expect(r).toMatchObject({ reset: 2, skipped: 1 });
  });

  test.each(['0', 'false', 'OFF', ' no '])('DEMO_RESET_BALANCES_ON_START=%p turns it off and touches nothing', async (v) => {
    const provision = jest.fn();
    const r = await resetBalancesOnStart(makeDeps({ users: ['a'], accounts: { a: [BANK] }, provision, env: { DEMO_RESET_BALANCES_ON_START: v } }));
    expect(provision).not.toHaveBeenCalled();
    expect(r.enabled).toBe(false);
  });

  test('on by default for a local run, and for 1/true/on/yes/empty', () => {
    expect(isEnabled({})).toBe(true);
    for (const v of ['1', 'true', 'on', 'yes', '']) expect(isEnabled({ DEMO_RESET_BALANCES_ON_START: v })).toBe(true);
  });

  test('inside a Kubernetes pod it is off unless explicitly turned on (a hosted rollout must not wipe a colleague)', async () => {
    const pod = { KUBERNETES_SERVICE_HOST: '10.0.0.1' };
    expect(isEnabled(pod)).toBe(false);
    expect(isEnabled({ ...pod, DEMO_RESET_BALANCES_ON_START: 'true' })).toBe(true);
    expect(isEnabled({ ...pod, DEMO_RESET_BALANCES_ON_START: '0' })).toBe(false);
    const provision = jest.fn();
    await resetBalancesOnStart(makeDeps({ users: ['a'], accounts: { a: [BANK] }, provision, env: pod }));
    expect(provision).not.toHaveBeenCalled();
  });

  test('a user with non-banking accounts is skipped even when the vertical lookup says unknown (a failed lookup reads as null)', async () => {
    const provision = jest.fn(async () => []);
    const r = await resetBalancesOnStart(makeDeps({
      users: ['h', 'm'], accounts: { h: [{ accountType: 'HSA' }, { accountType: 'Primary Care' }], m: [BANK, { accountType: 'Rewards Points' }] },
      vertical: {}, provision,
    }));
    expect(provision).not.toHaveBeenCalled();
    expect(r).toMatchObject({ reset: 0, skipped: 2 });
  });

  test('one user failing is counted and logged; the others are still reset and nothing throws', async () => {
    const provision = jest.fn(async (id) => { if (id === 'a') throw new Error('store busy'); return []; });
    const r = await resetBalancesOnStart(makeDeps({ users: ['a', 'b'], accounts: { a: [BANK], b: [BANK] }, provision }));
    expect(r).toMatchObject({ reset: 1, failed: 1 });
    expect(quiet.warn).toHaveBeenCalledWith(expect.stringContaining('store busy'));
  });
});

// The real wiring: server.js hands resetBalancesOnStart the real data store, the export on routes/accounts and
// getCurrentVertical. If any of those is renamed, the unit tests above would still pass; this one would not.
describe('resetBalancesOnStart with the real data store and provisioning', () => {
  test('spent balances come back to the defaults; another vertical is left alone', async () => {
    const os = require('os'), fs = require('fs'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-balances-'));
    process.env.LMDB_PATH = path.join(dir, 'lmdb');
    let result;
    await jest.isolateModulesAsync(async () => {
      const dataStore = require('../data/store');
      const accountsRouter = require('../routes/accounts');
      const verticals = require('../services/verticalAccountSnapshots');
      expect(typeof accountsRouter.provisionDemoAccounts).toBe('function');
      expect(typeof verticals.getCurrentVertical).toBe('function');
      const user = await dataStore.createUser({ username: 'reset_e2e', email: 'reset_e2e@example.test', firstName: 'R', lastName: 'E', role: 'customer', password: 'x' });
      await accountsRouter.provisionDemoAccounts(user.id);
      const checking = dataStore.getAccountsByUserId(user.id).find((a) => a.accountType === 'checking');
      await dataStore.updateAccount(checking.id, { balance: 12.34 });
      expect(dataStore.getAccountById(checking.id).balance).toBe(12.34);
      result = await resetBalancesOnStart({
        dataStore, provision: accountsRouter.provisionDemoAccounts, getVertical: verticals.getCurrentVertical, env: {}, log: quiet,
      });
      const after = dataStore.getAccountsByUserId(user.id);
      expect(after.find((a) => a.accountType === 'checking').balance).toBe(5000);
      expect(after.map((a) => a.accountType).sort()).toEqual(['checking', 'credit_card', 'loan', 'savings']);
    });
    expect(result.reset).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
    delete process.env.LMDB_PATH;
  }, 60000);
});
