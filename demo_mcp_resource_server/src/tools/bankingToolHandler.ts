'use strict';

import { getAccount, listAccounts } from '../db/bankingDb';

// The banking vertical's seed data has a single subject ('demo-user'), same as
// /invest's resolveInvestor(). Used by the static-key REST path (no per-user
// identity) and by MCP calls whose bearer has no `sub` — a PingOne
// client_credentials token, e.g. the Privilege AI Gateway's OAuth backend hop.
// ponytail: machine tokens all see demo-user; map client_id -> user if a
// per-agent view is ever needed.
export const DEMO_BANKING_SUBJECT = 'demo-user';

export async function dispatchBankingTool(
  toolName: string,
  args: Record<string, unknown>,
  subject: string | undefined,
): Promise<unknown> {
  // better-sqlite3 throws on an undefined binding, so a sub-less token must
  // resolve to a subject before it reaches the query.
  const who = subject || DEMO_BANKING_SUBJECT;
  switch (toolName) {
    case 'list_banking_accounts': {
      const accounts = listAccounts(who);
      return { accounts, count: accounts.length };
    }

    case 'get_banking_account': {
      const id = args.account_id as string;
      const account = getAccount(id, who);
      if (!account) return { found: false, account_id: id };
      return { found: true, account };
    }

    default:
      throw new Error(`Unknown banking tool: ${toolName}`);
  }
}
