'use strict';

/**
 * Heuristic ACTION -> dispatched TOOL where they differ. Vertical plugin actions
 * ARE their tool names (identity fallback). Shared by useCases.primaryTool.test.js
 * and stepVerification.banking.test.js — one source of truth, not two copies.
 */
const ACTION_TO_TOOL = {
  transfer: 'create_transfer',
  transfer_600_test: 'create_transfer',
  deposit: 'create_deposit',
  withdraw: 'create_withdrawal',
  balance: 'get_account_balance',
  accounts: 'get_my_accounts',
  transactions: 'get_my_transactions',
  // The 7th (and previously only missing) inverse of banking's own
  // TOOL_NAME_TO_ACTION map (config/verticals/banking/index.js:337-345). The
  // heuristic action is the alias — tagged heuristicOnly so it is never
  // LLM-callable — and get_sensitive_account_details is the real MCP tool.
  sensitive_account_details: 'get_sensitive_account_details',
  branch_hours: 'get_branch_hours',
  weather: 'get_weather',
  mortgage_demo: 'show_mortgage',
};

module.exports = { ACTION_TO_TOOL };
