'use strict';

/**
 * Resolve UI-facing banking aliases to tools registered by the banking MCP.
 * Returns null when the request is not one of the aliases owned here.
 */
function resolveBankingMcpToolAlias(tool, params, vertical) {
  if (vertical !== 'banking' || !['get_balance', 'banking.get_balance'].includes(tool)) {
    return null;
  }

  const hasAccountId = params
    && typeof params === 'object'
    && Object.hasOwn(params, 'account_id');

  return {
    tool: hasAccountId ? 'get_account_balance' : 'get_my_accounts',
    intent: 'view_balance',
  };
}

module.exports = { resolveBankingMcpToolAlias };
