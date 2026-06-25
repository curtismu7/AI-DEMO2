// demo_api_ui/src/constants/mcpFieldKeys.js

/**
 * Canonical keys for the McpFieldContext store.
 * Use these instead of raw strings to prevent typos.
 */
export const MCP_FIELD_KEYS = {
  // PingGateway wizard fields
  PINGONE_ENV_URL:      'pingOneEnvUrl',
  PINGONE_RESOURCE_ID:  'pingOneResourceId',
  GATEWAY_URL:          'gatewayUrl',
  UPSTREAM_MCP_URL:     'upstreamMcpUrl',
  INTROSPECT_ENDPOINT:  'introspectEndpoint',
  MCP_SCOPE:            'mcpScope',

  // WebMcpPanel tool param fields
  ACCOUNT_ID:           'account_id',
  FROM_ACCOUNT_ID:      'from_account_id',
  TO_ACCOUNT_ID:        'to_account_id',
  USER_ID:              'userId',
  ACCOUNT_ID_ADMIN:     'accountId',
  LIMIT:                'limit',
};

/**
 * Keys whose values come from /api/accounts/my result.
 * These get a dropdown populated from the cached account list.
 */
export const ACCOUNT_ID_KEYS = new Set([
  MCP_FIELD_KEYS.ACCOUNT_ID,
  MCP_FIELD_KEYS.FROM_ACCOUNT_ID,
  MCP_FIELD_KEYS.TO_ACCOUNT_ID,
]);

/**
 * Keys whose values come from lookup_customer result.
 */
export const USER_ID_KEYS = new Set([MCP_FIELD_KEYS.USER_ID]);

/**
 * Keys whose values come from get_customer_accounts result.
 */
export const ADMIN_ACCOUNT_ID_KEYS = new Set([MCP_FIELD_KEYS.ACCOUNT_ID_ADMIN]);

/**
 * Per-tool description suggestions shown as clickable chips.
 */
export const DESCRIPTION_SUGGESTIONS = {
  create_deposit:    ['Cash Deposit', 'Mobile Check Deposit', 'Transfer from External'],
  create_withdrawal: ['ATM Withdrawal', 'Cash Withdrawal', 'Check Withdrawal'],
  create_transfer:   ['Transfer to Savings', 'Transfer to Checking'],
  adjust_balance:    ['Admin adjustment', 'Correction', 'Fee reversal'],
};

export const QUERY_SUGGESTIONS = [
  "Should I transfer $500 to savings?",
  "What's my spending this month?",
];
