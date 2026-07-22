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
  branch_hours: 'get_branch_hours',
  weather: 'get_weather',
};

module.exports = { ACTION_TO_TOOL };
