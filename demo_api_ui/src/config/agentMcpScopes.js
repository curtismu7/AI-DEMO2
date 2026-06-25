// banking_api_ui/src/config/agentMcpScopes.js
/** Human-readable catalog for Agent MCP OAuth scopes (RFC 8693 to banking_mcp_server). */

export const AGENT_MCP_SCOPE_CATALOG = [
  // ── Broad umbrella scopes (consolidated) ───────────────────────────────────
  {
    scope: 'general:read',
    label: 'Read (all data)',
    description:
      'View own accounts, balances, and transaction history. Satisfies any read tool without needing specific scopes.',
    group: 'broad',
  },
  {
    scope: 'general:write',
    label: 'Write (transfers & deposits)',
    description:
      'Transfer funds, make deposits, and withdrawals. Satisfies any write tool without needing specific scopes.',
    group: 'broad',
  },
  // ── Admin and sensitive scopes (consolidated) ───────────────────────────────
  {
    scope: 'admin',
    label: 'Admin operations',
    description: 'Full administrative access including sensitive data operations.',
    group: 'admin',
  },
  {
    scope: 'sensitive',
    label: 'Sensitive data access',
    description:
      'Access full account number and routing number. Requires explicit user consent each session. Used by get_sensitive_account_details.',
    group: 'sensitive',
  },
  // ── AI Agent scope (consolidated) ───────────────────────────────────────────
  {
    scope: 'ai:agent',
    label: 'User lookup (agent)',
    description: 'Resolve user by email for agent workflows (query_user_by_email).',
    group: 'specific',
  },
  // ── Agent identity marker ───────────────────────────────────────────────────
  {
    scope: 'ai_agent',
    label: 'Agent identity',
    description: 'Identity marker for AI agent tokens.',
    group: 'specific',
  },
];

export const DEFAULT_AGENT_MCP_ALLOWED_SCOPES = AGENT_MCP_SCOPE_CATALOG.map((c) => c.scope).join(' ');
