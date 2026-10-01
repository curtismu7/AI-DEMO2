'use strict';

const BALANCE_ALIASES = new Set(['get_balance', 'banking.get_balance']);
const STATIC_BANKING_ALIASES = Object.freeze({
  get_accounts: { tool: 'get_my_accounts', intent: 'view_accounts' },
  'banking.get_accounts': { tool: 'get_my_accounts', intent: 'view_accounts' },
  get_transactions: { tool: 'get_my_transactions', intent: 'view_transactions' },
  'banking.get_transactions': { tool: 'get_my_transactions', intent: 'view_transactions' },
});
const BANKING_ALIAS_NAMES = new Set([
  ...BALANCE_ALIASES,
  ...Object.keys(STATIC_BANKING_ALIASES),
]);

function isBankingMcpToolAlias(tool) {
  return BANKING_ALIAS_NAMES.has(tool);
}

/**
 * Resolve UI-facing banking aliases to tools registered by the banking MCP.
 * Returns null when the request is not one of the aliases owned here.
 */
function resolveBankingMcpToolAlias(tool, params, vertical) {
  if (vertical !== 'banking' || !isBankingMcpToolAlias(tool)) {
    return null;
  }

  if (!BALANCE_ALIASES.has(tool)) return STATIC_BANKING_ALIASES[tool];

  const hasAccountId = params
    && typeof params === 'object'
    && Object.hasOwn(params, 'account_id');

  return {
    tool: hasAccountId ? 'get_account_balance' : 'get_my_accounts',
    intent: 'view_balance',
  };
}

module.exports = { isBankingMcpToolAlias, resolveBankingMcpToolAlias };
