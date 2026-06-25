/**
 * Tool-to-Scope Mapping — Least-privilege scope configuration per MCP tool.
 * Implements D-03: Narrowed scopes per tool.
 *
 * Each tool requests only the scopes it needs for token exchange,
 * rather than requesting the full set of user scopes.
 */

import type { BankingToolDefinition } from './BankingToolRegistry';

export const TOOL_SCOPES: Record<string, string[]> = {
  // Read-only tools
  get_my_accounts: ['read'],
  get_account_balance: ['read'],
  get_sensitive_account_details: ['sensitive:read'],
  get_my_transactions: ['read'],

  // Write tools
  create_deposit: ['write'],
  create_withdrawal: ['write'],
  create_transfer: ['write'],

  // Admin / user lookup tools
  query_user_by_email: ['read'],

  // Admin tools
  lookup_customer: ['admin:read'],
  get_customer_profile: ['admin:read'],
  get_customer_accounts: ['admin:read'],
  get_customer_transactions: ['admin:read'],
  freeze_account: ['admin:write'],
  reset_customer_password: ['admin:write'],
  adjust_balance: ['admin:write'],
  delete_customer: ['admin:delete'],

  // Internal reasoning (no banking scope needed, but still requires delegation)
  sequential_think: ['read'],
};

/**
 * Return the narrowed scopes required for a specific tool.
 * Falls back to ['read'] for unknown tools (safe default — read-only).
 */
export function getScopesForTool(toolName: string): string[] {
  return TOOL_SCOPES[toolName] ?? ['read'];
}

/**
 * Filter a list of tool definitions to only those permitted by the given token scopes.
 *
 * Registry and token scopes both use the flat format (read, write),
 * so matching is a direct set membership check. Wildcards '*' and '*' grant all.
 * Tools with no requiredScopes (e.g. sequential_think) are always included.
 *
 * Called from the tools/list handler — no authz server call needed.
 * PingOne Authorize compatible: same flat scope model works with PA's scope claim evaluation.
 */
export function filterToolsByScope(
  tools: BankingToolDefinition[],
  tokenScopes: string[],
): BankingToolDefinition[] {
  // Empty scope list means the token carried no scopes — return only tools that
  // require no scopes. Advertising admin tools to zero-scope tokens violates
  // least-privilege even though executeTool enforces scopes at call time.
  if (tokenScopes.length === 0) return tools.filter(t => t.requiredScopes.length === 0);

  const hasWildcard = tokenScopes.includes('*');
  if (hasWildcard) return tools;

  return tools.filter(tool =>
    tool.requiredScopes.length === 0 ||
    tool.requiredScopes.every(s => tokenScopes.includes(s)),
  );
}
