'use strict';
const { resetBalancesOnStart, isEnabled, verticalOf, makeReseed, VERTICAL_TYPES } = require('../services/resetBalancesOnStart');

const BANK = { accountType: 'checking' };
const quiet = { log: jest.fn(), warn: jest.fn() };
function makeDeps({ users, accounts = {}, vertical = {}, provision = jest.fn(async () => []), reseed = jest.fn(async () => []), env = {} }) {
  return {
    dataStore: { getAllUsers: () => users.map((id) => ({ id })), getAccountsByUserId: (id) => accounts[id] || [] },
    getVertical: async (id) => vertical[id] ?? null,
    provision, reseed, env, log: quiet,
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

  test.each([
    ['healthcare', ['Primary Care', 'HSA']],
    ['retail', ['Rewards Points', 'Store Credit']],
    ['workforce', ['PTO Balance', 'Sick Leave']],
    ['sporting-goods', ['Pro Member', 'Elite Member']],
  ])('a %s user is reseeded for that same vertical, not given banking accounts', async (vertical, types) => {
    const provision = jest.fn(async () => []);
    const reseed = jest.fn(async () => []);
    const r = await resetBalancesOnStart(makeDeps({ users: ['u'], accounts: { u: types.map((accountType) => ({ accountType })) }, provision, reseed }));
    expect(reseed).toHaveBeenCalledWith('u', vertical);
    expect(provision).not.toHaveBeenCalled();
    expect(r).toMatchObject({ reset: 1, skipped: 0 });
  });

  test('upper-case banking types from the seed profile (CHECKING/SAVINGS) count as banking', async () => {
    const provision = jest.fn(async () => []);
    await resetBalancesOnStart(makeDeps({ users: ['u'], accounts: { u: [{ accountType: 'CHECKING' }, { accountType: 'SAVINGS' }] }, provision }));
    expect(provision).toHaveBeenCalledWith('u');
  });

  test('mixed verticals, unknown types and a saved vertical that disagrees with the types are skipped untouched', async () => {
    const provision = jest.fn(async () => []);
    const reseed = jest.fn(async () => []);
    const r = await resetBalancesOnStart(makeDeps({
      users: ['mixed', 'unknown', 'disagree'],
      accounts: { mixed: [BANK, { accountType: 'Rewards Points' }], unknown: [{ accountType: 'Mystery' }], disagree: [{ accountType: 'HSA' }] },
      vertical: { disagree: 'retail' }, provision, reseed,
    }));
    expect(provision).not.toHaveBeenCalled();
    expect(reseed).not.toHaveBeenCalled();
    expect(r).toMatchObject({ reset: 0, skipped: 3 });
  });

  test('a saved label with no seed of its own (university, airlines) does not block: the account types decide', async () => {
    const provision = jest.fn(async () => []);
    const reseed = jest.fn(async () => []);
    const r = await resetBalancesOnStart(makeDeps({
      users: ['u', 'a', 'w'],
      accounts: { u: [{ accountType: 'CHECKING' }, { accountType: 'SAVINGS' }], a: [BANK], w: [{ accountType: 'PTO Balance' }, { accountType: 'Sick Leave' }] },
      vertical: { u: 'university', a: 'airlines', w: 'university' }, provision, reseed,
    }));
    expect(provision.mock.calls.map((c) => c[0])).toEqual(['u', 'a']);
    expect(reseed).toHaveBeenCalledWith('w', 'workforce');
    expect(r).toMatchObject({ reset: 3, skipped: 0 });
  });

  test('a seeded vertical that disagrees with the types is still skipped', async () => {
    const provision = jest.fn(async () => []);
    const r = await resetBalancesOnStart(makeDeps({ users: ['x'], accounts: { x: [BANK] }, vertical: { x: 'retail' }, provision }));
    expect(provision).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  test('a failing reseed is counted and logged, and the next user is still reset', async () => {
    const reseed = jest.fn(async (id) => { if (id === 'a') throw new Error('disk full'); return []; });
    const r = await resetBalancesOnStart(makeDeps({ users: ['a', 'b'], accounts: { a: [{ accountType: 'HSA' }], b: [{ accountType: 'HSA' }] }, reseed }));
    expect(r).toMatchObject({ reset: 1, failed: 1 });
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
  test('spent balances come back to the defaults; a retail user is reseeded as retail, not as banking', async () => {
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
      const shopper = await dataStore.createUser({ username: 'reset_e2e_shop', email: 'reset_e2e_shop@example.test', firstName: 'S', lastName: 'H', role: 'customer', password: 'x' });
      await dataStore.seedAccountsForUser(shopper.id, 'retail');
      const points = dataStore.getAccountsByUserId(shopper.id).find((a) => a.accountType === 'Rewards Points');
      await dataStore.updateAccount(points.id, { balance: 1 });
      const demoScenarioStore = require('../services/demoScenarioStore');
      result = await resetBalancesOnStart({
        dataStore, provision: accountsRouter.provisionDemoAccounts, getVertical: verticals.getCurrentVertical, env: {}, log: quiet,
        reseed: makeReseed({ dataStore, demoScenarioStore }), // the same callback server.js wires in
      });
      const shop = dataStore.getAccountsByUserId(shopper.id);
      expect(shop.map((a) => a.accountType).sort()).toEqual(['Rewards Points', 'Store Credit']);
      expect(shop.find((a) => a.accountType === 'Rewards Points').balance).not.toBe(1); // the spent value is gone
      // old transactions are cleared and the fresh ones point only at the new accounts
      const ids = new Set(shop.map((a) => a.id));
      const txs = dataStore.getTransactionsByUserId(shopper.id);
      expect(txs.length).toBeGreaterThan(0);
      for (const tx of txs) expect(ids.has(tx.fromAccountId) || ids.has(tx.toAccountId)).toBe(true);
      // the cold-start snapshot matches the fresh accounts, and the saved scenario fields survive the save
      const scenario = await demoScenarioStore.load(shopper.id);
      expect(scenario.accountSnapshot.map((a) => a.id).sort()).toEqual([...ids].sort());
      const after = dataStore.getAccountsByUserId(user.id);
      expect(after.find((a) => a.accountType === 'checking').balance).toBe(5000);
      expect(after.map((a) => a.accountType).sort()).toEqual(['checking', 'credit_card', 'loan', 'savings']);
    });
    expect(result.reset).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
    delete process.env.LMDB_PATH;
  }, 60000);
});

// VERTICAL_TYPES is a copy of what data/seeds/*.js produce. If a seed adds or renames a type, the users on it would be
// skipped without a word, so this fails first.
describe('VERTICAL_TYPES matches the seed files', () => {
  const fs = require('fs'), path = require('path');
  const seedDir = path.join(__dirname, '../data/seeds');
  const files = fs.readdirSync(seedDir).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));

  test.each(Object.keys(VERTICAL_TYPES))('%s: every account type the seed creates is listed', (vertical) => {
    const seed = require(path.join(seedDir, vertical));
    const profile = seed.seed || seed;
    const types = [profile.primary.accountType, profile.secondary.accountType].map((x) => x.toLowerCase());
    expect([...types].sort()).toEqual([...VERTICAL_TYPES[vertical]].sort());
    expect(verticalOf(types.map((accountType) => ({ accountType })))).toBe(vertical);
  });

  test('every seed file is either banking or covered', () => {
    expect(files.filter((f) => f !== 'banking' && !VERTICAL_TYPES[f])).toEqual([]);
  });
});
