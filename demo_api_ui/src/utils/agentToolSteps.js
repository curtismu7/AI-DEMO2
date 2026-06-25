// banking_api_ui/src/utils/agentToolSteps.js
/**
 * One UI chip per real Backend-for-Frontend (BFF) → MCP tool call.
 * (Previously showed multiple fictional ledger steps; one 401 then marked every chip Failed and looked like many broken tools.)
 */

/**
 * @param {string} actionId
 * @returns {{ name: string }[]}
 */
export function getToolStepsForAction(actionId) {
  const row = (name) => ({ name });
  switch (actionId) {
    case 'accounts':
      return [row('get_my_accounts')];
    case 'transactions':
      return [row('get_my_transactions')];
    case 'balance':
      return [row('get_account_balance')];
    case 'deposit':
      return [row('create_deposit')];
    case 'withdraw':
      return [row('create_withdrawal')];
    case 'transfer':
      return [row('create_transfer')];
    case 'query_user':
      return [row('query_user_by_email')];
    case 'web_search':
      return [row('brave_search')];
    case 'mcp_tools':
      // mcp_tools is a meta-action; individual tool calls show their own chips via BFF response
      return [];
    default:
      return [];
  }
}
