/**
 * @file mcp-local-hitl.test.js
 * Local MCP tool fallback must enforce the same high-value HITL gate as POST /api/transactions.
 * Also covers stale/fake account ID resolution (chk-N pattern from UI generateFakeAccounts).
 */
const { callToolLocal } = require('../../services/mcpLocalTools');

// Reset admin accounts before each test in the HITL group to ensure
// sav-4 always has enough balance regardless of test run order or parallel execution.
const dataStore = require('../../data/store');
beforeEach(async () => {
  const sav4 = dataStore.getAccountById('sav-4');
  if (sav4) {
    const deficit = 800 - sav4.balance; // restore to $800
    if (deficit !== 0) await dataStore.updateAccountBalance('sav-4', deficit);
  }
  const chk4 = dataStore.getAccountById('chk-4');
  if (chk4) {
    const deficit = 4200 - chk4.balance; // restore to $4200
    if (deficit !== 0) await dataStore.updateAccountBalance('chk-4', deficit);
  }
});

describe('mcpLocalTools HITL (high-value writes)', () => {
  it('returns hitl_required for create_transfer over $500 (non-admin)', async () => {
    const r = await callToolLocal(
      'create_transfer',
      { from_account_id: 'checking', to_account_id: 'savings', amount: 600 },
      '1',
    );
    expect(r.error).toBe('hitl_required');
    expect(r.hitl).toEqual({ type: 'consent' });
    expect(r.hitl_threshold_usd).toBeDefined();
  });

  it('returns hitl_required for create_transfer at $500 (Phase 170: ALL transfers require consent)', async () => {
    const r = await callToolLocal(
      'create_transfer',
      { from_account_id: 'checking', to_account_id: 'savings', amount: 500 },
      '1',
    );
    // Phase 170: transfers always require human consent via the browser dashboard,
    // regardless of amount — local MCP tools cannot complete the consent flow.
    expect(r.error).toBe('hitl_required');
  });

  it('allows transfer over $500 for admin user', async () => {
    // beforeEach resets sav-4 to $800 so this $600 transfer always has enough balance.
    const r = await callToolLocal(
      'create_transfer',
      { from_account_id: 'sav-4', to_account_id: 'chk-4', amount: 600 },
      '4',
    );
    expect(r.success).toBe(true);
    expect(r.transaction_id).toBeDefined();
  });

  it('returns hitl_required for create_deposit over $500 (non-admin)', async () => {
    const r = await callToolLocal(
      'create_deposit',
      { to_account_id: 'checking', amount: 501 },
      '1',
    );
    expect(r.error).toBe('hitl_required');
  });
});

describe('mcpLocalTools — stale/fake account ID resolution', () => {
  // User IDs whose account IDs happen to be short (e.g. 'chk-5') when userId='5'.
  // The UI generateFakeAccounts used to send these; the server must not 404 — it should
  // fall back to type-based resolution and complete the operation successfully.

  it('create_deposit succeeds when UI sends stale chk-N fake account ID', async () => {
    // userId='stale-test-user' ⇒ server provisions chk-staletestus / sav-staletestus,
    // but UI fallback would have sent 'chk-5' (a short fake ID that does not exist).
    const r = await callToolLocal(
      'create_deposit',
      { account_id: 'chk-5', amount: 50 },
      'stale-test-user',
    );
    // Must NOT return an account-not-found error — should resolve to the real checking account.
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
    expect(r.transaction_id).toBeDefined();
    expect(r.amount).toBe(50);
  });

  it('create_withdrawal succeeds when UI sends stale sav-N fake account ID', async () => {
    const r = await callToolLocal(
      'create_withdrawal',
      { account_id: 'sav-0', amount: 10 },
      'stale-test-user-2',
    );
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
  });

  it('create_deposit with plain type name "checking" resolves correctly', async () => {
    const r = await callToolLocal(
      'create_deposit',
      { account_id: 'checking', amount: 25 },
      'stale-test-user-3',
    );
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
  });

  it('create_deposit with no account_id still works (defaults to checking)', async () => {
    const r = await callToolLocal(
      'create_deposit',
      { amount: 15 },
      'stale-test-user-4',
    );
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
  });
});

