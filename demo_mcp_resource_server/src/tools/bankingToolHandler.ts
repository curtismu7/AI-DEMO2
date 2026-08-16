'use strict';

import { getAccount, listAccounts } from '../db/bankingDb';

export async function dispatchBankingTool(
  toolName: string,
  args: Record<string, unknown>,
  subject: string,
): Promise<unknown> {
  switch (toolName) {
    case 'list_banking_accounts': {
      const accounts = listAccounts(subject);
      return { accounts, count: accounts.length };
    }

    case 'get_banking_account': {
      const id = args.account_id as string;
      const account = getAccount(id, subject);
      if (!account) return { found: false, account_id: id };
      return { found: true, account };
    }

    default:
      throw new Error(`Unknown banking tool: ${toolName}`);
  }
}
