'use strict';

/**
 * Lossless vertical switching.
 *
 * The defect: dataStore.reseedUserForVertical() deletes every account AND every
 * transaction for a user and persists, with a single-slot snapshot that the
 * switch itself overwrote. An SE who had built up transfers / HITL approvals /
 * step-ups lost all of it the moment anything touched accounts under a
 * different vertical, irreversibly.
 *
 * These tests hold the round trip to "lossless", not merely "does not throw".
 */

const dataStore = require('../../data/store');
const demoScenarioStore = require('../../services/demoScenarioStore');
const snapshots = require('../../services/verticalAccountSnapshots');

const USER = 'vsnap-user-1';

/** In-memory demoScenarioStore so the test never touches LMDB. */
function stubScenarioStore() {
  const mem = new Map();
  jest.spyOn(demoScenarioStore, 'load').mockImplementation(
    async (uid) => mem.get(uid) || {},
  );
  jest.spyOn(demoScenarioStore, 'save').mockImplementation(async (uid, patch) => {
    mem.set(uid, { ...(mem.get(uid) || {}), ...patch });
    return mem.get(uid);
  });
  return mem;
}

/** Give the user two accounts and one transaction between them. */
async function seedLiveData(userId, accountType, balance) {
  const a = await dataStore.createAccount({
    userId, accountType, name: `${accountType} primary`, balance, currency: 'USD', isActive: true,
  });
  const b = await dataStore.createAccount({
    userId, accountType, name: `${accountType} secondary`, balance: 50, currency: 'USD', isActive: true,
  });
  await dataStore.createTransaction({
    userId, fromAccountId: a.id, toAccountId: b.id, amount: 25, type: 'transfer', status: 'completed',
  });
  return { a, b };
}

describe('verticalAccountSnapshots', () => {
  let mem;

  beforeEach(async () => {
    mem = stubScenarioStore();
    dataStore.purgeUserFinancialData(USER);
    jest.spyOn(dataStore, 'persistAllData').mockResolvedValue(undefined);
  });

  afterEach(() => {
    dataStore.purgeUserFinancialData(USER);
    jest.restoreAllMocks();
  });

  test('purgeUserFinancialData removes the user accounts and their transactions', async () => {
    await seedLiveData(USER, 'checking', 100);
    expect(dataStore.getAccountsByUserId(USER)).toHaveLength(2);
    expect(dataStore.getTransactionsByUserId(USER).length).toBeGreaterThan(0);

    const removed = dataStore.purgeUserFinancialData(USER);

    expect(removed.accounts).toBe(2);
    expect(dataStore.getAccountsByUserId(USER)).toHaveLength(0);
    expect(dataStore.getTransactionsByUserId(USER)).toHaveLength(0);
  });

  test('switching away snapshots the outgoing vertical instead of dropping it', async () => {
    await seedLiveData(USER, 'checking', 100);
    await demoScenarioStore.save(USER, { [snapshots.CURRENT_FIELD]: 'banking' });

    jest.spyOn(dataStore, 'reseedUserForVertical').mockImplementation(async (uid) => {
      dataStore.purgeUserFinancialData(uid);
      await dataStore.createAccount({
        userId: uid, accountType: 'coverage', name: 'coverage', balance: 7, currency: 'USD', isActive: true,
      });
    });

    const res = await snapshots.switchUserVertical(USER, 'healthcare');

    expect(res).toMatchObject({ action: 'seeded', snapshotted: true, from: 'banking' });
    const stored = mem.get(USER)[snapshots.SNAPSHOT_FIELD].banking;
    expect(stored.accounts).toHaveLength(2);
    expect(stored.transactions.length).toBeGreaterThan(0);
  });

  test('switching back RESTORES accounts and transactions — the lossless claim', async () => {
    // Build banking state, including a transaction that must survive.
    await seedLiveData(USER, 'checking', 100);
    await demoScenarioStore.save(USER, { [snapshots.CURRENT_FIELD]: 'banking' });
    const bankingAccounts = dataStore.getAccountsByUserId(USER)
      .map((a) => a.name).sort();
    const bankingTxCount = dataStore.getTransactionsByUserId(USER).length;

    jest.spyOn(dataStore, 'reseedUserForVertical').mockImplementation(async (uid) => {
      dataStore.purgeUserFinancialData(uid);
      await dataStore.createAccount({
        userId: uid, accountType: 'coverage', name: 'coverage', balance: 7, currency: 'USD', isActive: true,
      });
    });

    // Out to healthcare...
    await snapshots.switchUserVertical(USER, 'healthcare');
    expect(dataStore.getAccountsByUserId(USER).map((a) => a.accountType)).toEqual(['coverage']);
    expect(dataStore.getTransactionsByUserId(USER)).toHaveLength(0);

    // ...and back.
    const back = await snapshots.switchUserVertical(USER, 'banking');

    expect(back.action).toBe('restored');
    expect(dataStore.getAccountsByUserId(USER).map((a) => a.name).sort()).toEqual(bankingAccounts);
    expect(dataStore.getTransactionsByUserId(USER)).toHaveLength(bankingTxCount);
  });

  test('restoring wipes the incoming vertical rows first (no mixed-vertical state)', async () => {
    await seedLiveData(USER, 'checking', 100);
    await snapshots.snapshotVertical(USER, 'banking');

    // Live data now belongs to a different vertical.
    dataStore.purgeUserFinancialData(USER);
    await dataStore.createAccount({
      userId: USER, accountType: 'coverage', name: 'coverage', balance: 7, currency: 'USD', isActive: true,
    });

    await snapshots.restoreVertical(USER, 'banking');

    const types = [...new Set(dataStore.getAccountsByUserId(USER).map((a) => a.accountType))];
    expect(types).toEqual(['checking']);
  });

  test('no snapshot for the target vertical falls back to a reseed', async () => {
    await seedLiveData(USER, 'checking', 100);
    await demoScenarioStore.save(USER, { [snapshots.CURRENT_FIELD]: 'banking' });
    const reseed = jest.spyOn(dataStore, 'reseedUserForVertical').mockResolvedValue(undefined);

    const res = await snapshots.switchUserVertical(USER, 'retail');

    expect(res.action).toBe('seeded');
    expect(reseed).toHaveBeenCalledWith(USER, 'retail');
  });

  test('switching to the vertical already current is a no-op', async () => {
    await seedLiveData(USER, 'checking', 100);
    await demoScenarioStore.save(USER, { [snapshots.CURRENT_FIELD]: 'banking' });
    const reseed = jest.spyOn(dataStore, 'reseedUserForVertical').mockResolvedValue(undefined);

    const res = await snapshots.switchUserVertical(USER, 'banking');

    expect(res.action).toBe('noop');
    expect(reseed).not.toHaveBeenCalled();
    expect(dataStore.getAccountsByUserId(USER)).toHaveLength(2);
  });

  test('an empty snapshot is not written over a real one', async () => {
    // Guard: writing {} for a cold session would mask the stored banking data.
    await seedLiveData(USER, 'checking', 100);
    await snapshots.snapshotVertical(USER, 'banking');
    dataStore.purgeUserFinancialData(USER);

    const wrote = await snapshots.snapshotVertical(USER, 'banking');

    expect(wrote).toBe(false);
    expect(mem.get(USER)[snapshots.SNAPSHOT_FIELD].banking.accounts).toHaveLength(2);
  });

  test('unknown outgoing vertical does not file data under the wrong one', async () => {
    // Cold session: nothing records which vertical the live rows belong to, so
    // attributing them to the target would corrupt that target's snapshot.
    await seedLiveData(USER, 'checking', 100);
    jest.spyOn(dataStore, 'reseedUserForVertical').mockResolvedValue(undefined);

    const res = await snapshots.switchUserVertical(USER, 'healthcare');

    expect(res.snapshotted).toBe(false);
    expect(mem.get(USER)[snapshots.SNAPSHOT_FIELD]).toBeUndefined();
  });
});
