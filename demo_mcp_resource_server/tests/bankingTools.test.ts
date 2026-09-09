'use strict';
import { BANKING_TOOLS } from '../src/tools/bankingTools';
import { dispatchBankingTool } from '../src/tools/bankingToolHandler';

describe('BANKING_TOOLS', () => {
  it('exports two tools', () => {
    expect(BANKING_TOOLS.length).toBe(2);
  });

  it('all tools have description and intentHints', () => {
    for (const t of BANKING_TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(10);
      expect(Array.isArray(t.intentHints)).toBe(true);
      expect((t.intentHints as string[]).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('all tools require the registered read scope (banking:read exists in no PingOne resource)', () => {
    for (const t of BANKING_TOOLS) {
      expect(t.requiredScopes).toEqual(['read']);
    }
  });
});

describe('dispatchBankingTool', () => {
  it('list_banking_accounts returns accounts array', async () => {
    const result = await dispatchBankingTool('list_banking_accounts', {}, 'demo-user') as any;
    expect(Array.isArray(result.accounts)).toBe(true);
    expect(result.accounts[0]).toHaveProperty('id');
    expect(result.accounts[0]).toHaveProperty('accountType');
  });

  it('get_banking_account returns one account by id', async () => {
    const accounts = (await dispatchBankingTool('list_banking_accounts', {}, 'demo-user') as any).accounts;
    const id = accounts[0].id;
    const result = await dispatchBankingTool('get_banking_account', { account_id: id }, 'demo-user') as any;
    expect(result.account.id).toBe(id);
  });

  it('get_banking_account returns not_found for unknown id', async () => {
    const result = await dispatchBankingTool('get_banking_account', { account_id: 'no-such-id' }, 'demo-user') as any;
    expect(result.found).toBe(false);
  });

  it('throws for unknown tool name', async () => {
    await expect(dispatchBankingTool('unknown_tool', {}, 'demo-user')).rejects.toThrow(/Unknown banking tool/);
  });
});

describe('dispatchBankingTool — per-user scoping (IDOR fix — BUGS.md #45)', () => {
  it('a sub-less machine token (undefined subject) resolves to the demo subject instead of throwing', async () => {
    const own = (await dispatchBankingTool('list_banking_accounts', {}, 'demo-user') as any).accounts;
    const result = await dispatchBankingTool('list_banking_accounts', {}, undefined) as any;
    expect(result.count).toBe(own.length);
    expect(result.accounts).toEqual(own);
  });

  it('list_banking_accounts never returns another user\'s accounts', async () => {
    const result = await dispatchBankingTool('list_banking_accounts', {}, 'someone-else-entirely') as any;
    expect(result.accounts).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('get_banking_account does not leak another user\'s account via a guessed id, while the owner\'s own lookup still works', async () => {
    const ownAccounts = (await dispatchBankingTool('list_banking_accounts', {}, 'demo-user') as any).accounts;
    const ownId = ownAccounts[0].id;

    const asOwner = await dispatchBankingTool('get_banking_account', { account_id: ownId }, 'demo-user') as any;
    expect(asOwner.found).toBe(true);
    expect(asOwner.account.id).toBe(ownId);

    const asStranger = await dispatchBankingTool('get_banking_account', { account_id: ownId }, 'someone-else-entirely') as any;
    expect(asStranger.found).toBe(false);
  });
});
