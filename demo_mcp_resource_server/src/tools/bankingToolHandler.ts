'use strict';

// Static demo account fixtures — banking mock-data.json only has heroStats;
// real account data lives in sampleData.js (CommonJS). We reproduce a minimal
// representative set here rather than require()ing a large side-effectful module.
const DEMO_ACCOUNTS = [
  { id: 'acct-001', userId: 'demo-user', accountNumber: '****4821', accountType: 'checking', balance: 4230.15, currency: 'USD', isActive: true },
  { id: 'acct-002', userId: 'demo-user', accountNumber: '****9104', accountType: 'savings', balance: 18540.00, currency: 'USD', isActive: true },
  { id: 'acct-003', userId: 'demo-user', accountNumber: '****3377', accountType: 'credit_card', balance: -842.50, currency: 'USD', isActive: true },
];

export async function dispatchBankingTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_banking_accounts':
      return { accounts: DEMO_ACCOUNTS, count: DEMO_ACCOUNTS.length };

    case 'get_banking_account': {
      const id = args.account_id as string;
      const account = DEMO_ACCOUNTS.find((a) => a.id === id);
      if (!account) return { found: false, account_id: id };
      return { found: true, account };
    }

    default:
      throw new Error(`Unknown banking tool: ${toolName}`);
  }
}
