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

  it('all tools require banking:read scope', () => {
    for (const t of BANKING_TOOLS) {
      expect(t.requiredScopes).toContain('banking:read');
    }
  });
});

describe('dispatchBankingTool', () => {
  it('list_banking_accounts returns accounts array', async () => {
    const result = await dispatchBankingTool('list_banking_accounts', {}) as any;
    expect(Array.isArray(result.accounts)).toBe(true);
    expect(result.accounts[0]).toHaveProperty('id');
    expect(result.accounts[0]).toHaveProperty('accountType');
  });

  it('get_banking_account returns one account by id', async () => {
    const accounts = (await dispatchBankingTool('list_banking_accounts', {}) as any).accounts;
    const id = accounts[0].id;
    const result = await dispatchBankingTool('get_banking_account', { account_id: id }) as any;
    expect(result.account.id).toBe(id);
  });

  it('get_banking_account returns not_found for unknown id', async () => {
    const result = await dispatchBankingTool('get_banking_account', { account_id: 'no-such-id' }) as any;
    expect(result.found).toBe(false);
  });

  it('throws for unknown tool name', async () => {
    await expect(dispatchBankingTool('unknown_tool', {})).rejects.toThrow(/Unknown banking tool/);
  });
});
