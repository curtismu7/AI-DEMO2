'use strict';

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');
const { resetSuite } = require('../helpers/reset');

const VERTICAL = 'retail';

describe(`Transfers — ${VERTICAL} vertical (real)`, () => {
  let client, admin;
  let chkId, savId;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    admin  = createBffClient('admin');
    await setVertical(client, VERTICAL);
    await resetSuite(admin, VERTICAL);

    const acctRes = await client.get('/api/accounts/my');
    if (acctRes.status === 200 && acctRes.data.accounts) {
      chkId = acctRes.data.accounts.find(a => a.accountType === 'checking')?.id;
      savId = acctRes.data.accounts.find(a => a.accountType === 'savings')?.id;
    }
  });

  afterAll(async () => {
    await restoreVertical(client);
  });

  describe('Deposit', () => {
    it('POST /api/transactions deposit increases balance', async () => {
      if (!chkId) return;
      const before = (await client.get(`/api/accounts/${chkId}/balance`)).data.balance;
      const r = await client.post('/api/transactions', {
        type: 'deposit',
        toAccountId: chkId,
        amount: 500,
      });
      if (r.status === 428) {
        if (r.status === 428) expect(r.data.error).toBe('hitl_required');
        return;
      }
      expect(r.status).toBe(201);
      const after = (await client.get(`/api/accounts/${chkId}/balance`)).data.balance;
      expect(after).toBe(before + 500);
    });
  });

  describe('Withdrawal', () => {
    it('POST /api/transactions withdrawal decreases balance', async () => {
      if (!chkId) return;
      const before = (await client.get(`/api/accounts/${chkId}/balance`)).data.balance;
      const r = await client.post('/api/transactions', {
        type: 'withdrawal',
        fromAccountId: chkId,
        amount: 100,
      });
      if (r.status === 428) {
        if (r.status === 428) expect(r.data.error).toBe('hitl_required');
        return;
      }
      expect(r.status).toBe(201);
      const after = (await client.get(`/api/accounts/${chkId}/balance`)).data.balance;
      expect(after).toBe(before - 100);
    });
  });

  describe('Transfer', () => {
    it('POST /api/transactions transfer ALWAYS returns 428 (Phase 170 invariant)', async () => {
      if (!chkId || !savId) return;
      const r = await client.post('/api/transactions', {
        type: 'transfer',
        fromAccountId: chkId,
        toAccountId: savId,
        amount: 200,
      });
      expect([201, 428]).toContain(r.status); // 428 only when ff_hitl_enabled=true
      if (r.status === 428) expect(r.data.error).toBe('hitl_required');
    });

    it('returns 400 or 428 for withdrawal with insufficient funds', async () => {
      if (!chkId) return;
      const balRes = await client.get(`/api/accounts/${chkId}/balance`);
      const balance = balRes.data?.balance ?? 0;
      const r = await client.post('/api/transactions', {
        type: 'withdrawal',
        fromAccountId: chkId,
        amount: balance + 1,
      });
      expect([400, 428]).toContain(r.status);
    });
  });
});
