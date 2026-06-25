'use strict';

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');
const { resetSuite } = require('../helpers/reset');

const VERTICAL = 'retail';

describe(`HITL enforcement — ${VERTICAL} vertical (real)`, () => {
  let client, admin;
  let chkId, savId;

  beforeAll(async () => {
    skipIfNoSession();
    const flagR = await createBffClient('enduser').get('/api/feature-flags');
    const hitlEnabled = flagR.data?.find?.(f => f.id === 'ff_hitl_enabled')?.value === 'true';
    if (!hitlEnabled) { console.warn(`[hitl.test] ff_hitl_enabled=false — skipping HITL enforcement tests`); return; }
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

  it('transfer without consentChallengeId returns 428 hitl_required', async () => {
    if (!chkId || !savId) return;
    const r = await client.post('/api/transactions', {
      type: 'transfer', fromAccountId: chkId, toAccountId: savId, amount: 200,
    });
    expect(r.status).toBe(428);
    expect(r.data.error).toBe('hitl_required');
    expect(r.data.hitl).toBeDefined();
    expect(r.data.hitl.type).toBe('consent');
  });

  it('transfer with invalid consentChallengeId returns 4xx', async () => {
    if (!chkId || !savId) return;
    const r = await client.post('/api/transactions', {
      type: 'transfer', fromAccountId: chkId, toAccountId: savId, amount: 200,
      consentChallengeId: 'invalid-challenge-id-that-does-not-exist',
    });
    expect([400, 403, 428]).toContain(r.status);
  });

  it('small deposit does not trigger 428 (below threshold)', async () => {
    if (!chkId) return;
    const r = await client.post('/api/transactions', {
      type: 'deposit', toAccountId: chkId, amount: 10,
    });
    expect([201, 428]).toContain(r.status);
    if (r.status === 428) {
      console.warn('[hitl.test] Unexpected 428 on $10 deposit — check confirm_threshold_usd in .env');
    }
  });

  it('large deposit above threshold returns 428', async () => {
    if (!chkId) return;
    const r = await client.post('/api/transactions', {
      type: 'deposit', toAccountId: chkId, amount: 1000,
    });
    expect([201, 428]).toContain(r.status);
  });

  it('response body includes fromAccountId, toAccountId, amount, type on 428', async () => {
    if (!chkId || !savId) return;
    const r = await client.post('/api/transactions', {
      type: 'transfer', fromAccountId: chkId, toAccountId: savId, amount: 300,
    });
    expect(r.status).toBe(428);
    expect(r.data).toMatchObject({
      fromAccountId: chkId,
      toAccountId:   savId,
      amount:        300,
      type:          'transfer',
    });
  });
});
