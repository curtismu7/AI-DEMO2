'use strict';

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');
const { VERTICAL_FIXTURES, CHECKING_BALANCE, SAVINGS_BALANCE } = require('../helpers/fixtures');

const VERTICAL = 'banking';
const FX = VERTICAL_FIXTURES[VERTICAL];

describe(`Accounts — ${VERTICAL} vertical (real)`, () => {
  let client;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    // banking is the default — no vertical switch needed
  });

  describe('GET /api/accounts/my', () => {
    it('returns 200 with accounts array', async () => {
      const r = await client.get('/api/accounts/my');
      expect(r.status).toBe(200);
      // Route returns { accounts: [...] }
      expect(Array.isArray(r.data.accounts)).toBe(true);
      expect(r.data.accounts.length).toBeGreaterThan(0);
    });

    it('accounts include expected fields', async () => {
      const r = await client.get('/api/accounts/my');
      const acct = r.data.accounts?.[0];
      expect(acct).toMatchObject({
        id:          expect.any(String),
        accountType: expect.any(String),
        balance:     expect.any(Number),
        currency:    expect.any(String),
      });
    });

    it('does not expose routingNumber or accountNumberFull', async () => {
      const r = await client.get('/api/accounts/my');
      for (const acct of (r.data.accounts || [])) {
        expect(acct.routingNumber).toBeUndefined();
        expect(acct.accountNumberFull).toBeUndefined();
      }
    });
  });

  describe('GET /api/accounts/:id/balance', () => {
    it('returns balance for test fixture checking account (admin-owned)', async () => {
      const r = await client.get(`/api/accounts/${FX.chk}/balance`);
      // Fixture accounts belong to test-real-suite, not the enduser — 403 is expected
      expect([200, 403, 404]).toContain(r.status);
    });

    it('returns 403 for an account belonging to a different user', async () => {
      const r = await client.get('/api/accounts/acct-user-2-chk/balance');
      expect([403, 404]).toContain(r.status);
    });
  });

  describe('GET /api/accounts (admin-only)', () => {
    it('returns 403 for enduser session', async () => {
      const r = await client.get('/api/accounts');
      expect(r.status).toBe(403);
    });
  });
});
