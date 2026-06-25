/**
 * Tests for per-vertical seed profiles and DataStore seeding operations.
 * Covers: seed file shape, seedAccountsForUser, reseedAllCustomersForVertical.
 */

const VERTICALS = ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce'];

// ── Seed file shape ────────────────────────────────────────────────────────────

describe('vertical seed files — shape', () => {
  for (const v of VERTICALS) {
    describe(v, () => {
      const seedFile = require(`../data/seeds/${v}`);
      const profile = seedFile.seed;

      it('has seed.primary with required fields', () => {
        expect(profile.primary).toMatchObject({
          accountType: expect.any(String),
          name:        expect.any(String),
          balanceBase: expect.any(Number),
          balanceRange: expect.any(Number),
        });
        expect(profile.primary.balanceBase).toBeGreaterThan(0);
        expect(profile.primary.balanceRange).toBeGreaterThanOrEqual(0);
      });

      it('has seed.secondary with required fields', () => {
        expect(profile.secondary).toMatchObject({
          accountType: expect.any(String),
          name:        expect.any(String),
          balanceBase: expect.any(Number),
          balanceRange: expect.any(Number),
        });
      });

      it('has at least 3 transactions', () => {
        expect(Array.isArray(profile.transactions)).toBe(true);
        expect(profile.transactions.length).toBeGreaterThanOrEqual(3);
      });

      it('each transaction has description, type, toSecondary', () => {
        for (const tx of profile.transactions) {
          expect(typeof tx.description).toBe('string');
          expect(tx.description.length).toBeGreaterThan(0);
          expect(typeof tx.type).toBe('string');
          expect(typeof tx.toSecondary).toBe('boolean');
        }
      });

      it('has chips array with 5 entries covering required keys', () => {
        const chips = seedFile.chips;
        expect(Array.isArray(chips)).toBe(true);
        expect(chips.length).toBe(5);
        const keys = chips.map(c => c.key);
        for (const k of ['balance', 'accounts', 'transactions', 'transfer', 'feature']) {
          expect(keys).toContain(k);
        }
        for (const c of chips) {
          expect(typeof c.label).toBe('string');
          expect(c.label.length).toBeGreaterThan(0);
        }
      });

      it('has llmChipGroups with at least 3 groups', () => {
        const groups = seedFile.llmChipGroups;
        expect(groups).toBeDefined();
        expect(typeof groups).toBe('object');
        expect(Object.keys(groups).length).toBeGreaterThanOrEqual(3);
      });

      it('each llmChipGroup has at least 3 chips with id, label, message', () => {
        for (const chips of Object.values(seedFile.llmChipGroups)) {
          expect(Array.isArray(chips)).toBe(true);
          expect(chips.length).toBeGreaterThanOrEqual(3);
          for (const chip of chips) {
            expect(typeof chip.id).toBe('string');
            expect(typeof chip.label).toBe('string');
            expect(typeof chip.message).toBe('string');
            expect(chip.message.length).toBeGreaterThan(0);
          }
        }
      });

      it('has toolDescriptions covering all 6 core MCP tools', () => {
        const td = seedFile.toolDescriptions;
        expect(td).toBeDefined();
        for (const name of ['get_my_accounts', 'get_account_balance', 'get_my_transactions', 'create_transfer', 'create_deposit', 'create_withdrawal']) {
          expect(td[name]).toBeDefined();
          expect(typeof td[name]).toBe('string');
          expect(td[name].length).toBeGreaterThan(10);
        }
      });
    });
  }
});

// ── DataStore seeding ──────────────────────────────────────────────────────────
// Each test uses jest.isolateModules to get a clean module registry with the
// configStore mocked before store.js loads it (avoids jest.mock() hoisting issues).

function withBankingStore(fn) {
  return async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../services/configStore', () => ({
        getEffective: jest.fn((key) => key === 'active_vertical' ? 'banking' : null),
      }));
      const store = require('../data/store');
      await fn(store);
    });
  };
}

describe('DataStore.seedAccountsForUser', () => {
  it('creates primary + secondary accounts and N transactions for a new user', withBankingStore(async (store) => {
    const userId = `seed-test-${Date.now()}`;
    const result = await store.seedAccountsForUser(userId);

    expect(result.primary).toBeDefined();
    expect(result.secondary).toBeDefined();
    expect(result.primary.userId).toBe(userId);
    expect(result.secondary.userId).toBe(userId);
    expect(result.vertical).toBe('banking');

    const bankingSeed = require('../data/seeds/banking');
    const txns = store.getTransactionsByUserId(userId);
    expect(txns.length).toBe(bankingSeed.seed.transactions.length);
  }));

  it('accounts have correct types for banking vertical', withBankingStore(async (store) => {
    const { primary, secondary } = await store.seedAccountsForUser(`seed-types-${Date.now()}`);
    expect(primary.accountType).toBe('CHECKING');
    expect(secondary.accountType).toBe('SAVINGS');
  }));

  it('account balances are within expected range', withBankingStore(async (store) => {
    const { primary } = await store.seedAccountsForUser(`seed-bal-${Date.now()}`);
    // banking: balanceBase=2500, balanceRange=700 → [2500, 3200]
    expect(primary.balance).toBeGreaterThanOrEqual(2500);
    expect(primary.balance).toBeLessThanOrEqual(3200);
  }));

  it('transaction dates are spread across recent days', withBankingStore(async (store) => {
    const userId = `seed-dates-${Date.now()}`;
    await store.seedAccountsForUser(userId);
    const dates = store.getTransactionsByUserId(userId).map(t => new Date(t.date).getTime());
    const max = Math.max(...dates);
    const min = Math.min(...dates);
    // 5 transactions → at least 4 day gaps
    expect(max - min).toBeGreaterThan(3 * 24 * 60 * 60 * 1000);
  }));
});

describe('DataStore.seedAccountsForUser — vertical routing', () => {
  const VERTICAL_EXPECTED = {
    banking:          { primary: 'CHECKING',       secondary: 'SAVINGS' },
    healthcare:       { primary: 'Primary Care',   secondary: 'HSA' },
    retail:           { primary: 'Rewards Points', secondary: 'Store Credit' },
    'sporting-goods': { primary: 'Pro Member',     secondary: 'Elite Member' },
    workforce:        { primary: 'PTO Balance',    secondary: 'Sick Leave' },
  };

  for (const [vertical, expected] of Object.entries(VERTICAL_EXPECTED)) {
    it(`uses ${vertical} seed profile when active_vertical=${vertical}`, async () => {
      await jest.isolateModulesAsync(async () => {
        jest.doMock('../services/configStore', () => ({
          getEffective: jest.fn((key) => key === 'active_vertical' ? vertical : null),
        }));
        const store = require('../data/store');
        const { primary, secondary } = await store.seedAccountsForUser(`vert-routing-${vertical}-${Date.now()}`);
        expect(primary.accountType).toBe(expected.primary);
        expect(secondary.accountType).toBe(expected.secondary);
      });
    });
  }
});

// ── reseedAllCustomersForVertical ──────────────────────────────────────────────

describe('DataStore.reseedAllCustomersForVertical', () => {
  it('returns the number of customer users reseeded', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../services/configStore', () => ({
        getEffective: jest.fn(() => null),
      }));
      const store = require('../data/store');
      const existing = store.getAllUsers().filter(u => u.role === 'customer').length;
      const count = await store.reseedAllCustomersForVertical('banking');
      expect(count).toBe(existing);
    });
  });

  it('wipes existing accounts and creates fresh ones with the new vertical profile', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../services/configStore', () => ({
        getEffective: jest.fn((key) => key === 'active_vertical' ? 'banking' : null),
      }));
      const store = require('../data/store');
      const userId = `reseed-wipe-${Date.now()}`;
      await store.createUser({ id: userId, email: `${userId}@test.com`, firstName: 'W', lastName: '1', role: 'customer', password: null });
      const { primary: p1, secondary: s1 } = await store.seedAccountsForUser(userId);
      const beforeIds = new Set([p1.id, s1.id]);

      await store.reseedAllCustomersForVertical('healthcare');
      const after = store.getAccountsByUserId(userId);
      const types = after.map(a => a.accountType);
      expect(types).toContain('Primary Care');
      expect(types).toContain('HSA');
      for (const acc of after) expect(beforeIds.has(acc.id)).toBe(false);
    });
  });

  it('wipes old transactions and creates fresh ones matching the new vertical', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../services/configStore', () => ({
        getEffective: jest.fn((key) => key === 'active_vertical' ? 'banking' : null),
      }));
      const store = require('../data/store');
      const userId = `reseed-txn-${Date.now()}`;
      await store.createUser({ id: userId, email: `${userId}@test.com`, firstName: 'T', lastName: '1', role: 'customer', password: null });
      await store.seedAccountsForUser(userId);
      const beforeTxns = store.getTransactionsByUserId(userId);

      await store.reseedAllCustomersForVertical('retail');
      const afterTxns = store.getTransactionsByUserId(userId);

      const retailProfile = require('../data/seeds/retail').seed;
      expect(afterTxns.length).toBe(retailProfile.transactions.length);
      const beforeIds = new Set(beforeTxns.map(t => t.id));
      for (const tx of afterTxns) expect(beforeIds.has(tx.id)).toBe(false);
    });
  });

  it('reseeds each of multiple customers correctly', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../services/configStore', () => ({
        getEffective: jest.fn((key) => key === 'active_vertical' ? 'banking' : null),
      }));
      const store = require('../data/store');
      const ts = Date.now();
      const u1 = `reseed-multi-u1-${ts}`;
      const u2 = `reseed-multi-u2-${ts}`;
      await store.createUser({ id: u1, email: `${u1}@test.com`, firstName: 'M', lastName: '1', role: 'customer', password: null });
      await store.createUser({ id: u2, email: `${u2}@test.com`, firstName: 'M', lastName: '2', role: 'customer', password: null });
      await store.seedAccountsForUser(u1);
      await store.seedAccountsForUser(u2);

      await store.reseedAllCustomersForVertical('workforce');

      const workforceProfile = require('../data/seeds/workforce').seed;
      for (const uid of [u1, u2]) {
        expect(store.getAccountsByUserId(uid).length).toBe(2);
        expect(store.getTransactionsByUserId(uid).length).toBe(workforceProfile.transactions.length);
      }
    });
  });

  it('does not touch admin users', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../services/configStore', () => ({
        getEffective: jest.fn((key) => key === 'active_vertical' ? 'banking' : null),
      }));
      const store = require('../data/store');
      const adminId = `reseed-admin-${Date.now()}`;
      await store.createUser({ id: adminId, email: `${adminId}@test.com`, firstName: 'A', lastName: '1', role: 'admin', password: null });
      await store.seedAccountsForUser(adminId);
      const beforeIds = store.getAccountsByUserId(adminId).map(a => a.id);

      await store.reseedAllCustomersForVertical('healthcare');

      const afterIds = store.getAccountsByUserId(adminId).map(a => a.id);
      expect(afterIds).toEqual(beforeIds);
    });
  });

  it('falls back to banking profile for unknown vertical', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../services/configStore', () => ({
        getEffective: jest.fn(() => null),
      }));
      const store = require('../data/store');
      const userId = `reseed-fb-${Date.now()}`;
      await store.createUser({ id: userId, email: `${userId}@test.com`, firstName: 'F', lastName: '1', role: 'customer', password: null });
      await store.reseedAllCustomersForVertical('nonexistent-vertical');
      const types = store.getAccountsByUserId(userId).map(a => a.accountType);
      expect(types).toContain('CHECKING');
      expect(types).toContain('SAVINGS');
    });
  });
});
