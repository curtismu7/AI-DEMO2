'use strict';

/**
 * Investment MCP tool definitions.
 *
 * Each tool declares:
 *   name         — JSON-RPC tool name (matches router.ts in mcp-gateway)
 *   description  — shown to LLM
 *   inputSchema  — JSON Schema for arguments
 *   requiredScopes — scopes the inbound token must carry
 */

export interface InvestTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScopes: string[];
  readOnly: boolean;
}

export const INVEST_TOOLS: InvestTool[] = [
  {
    name: 'get_investment_accounts',
    description: 'List all investment accounts for the authenticated user.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['invest:read'],
    readOnly: true,
  },
  {
    name: 'get_investment_balance',
    description: 'Get current balance and holdings summary for a specific investment account.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'Investment account ID (UUID)',
        },
      },
      required: ['account_id'],
    },
    requiredScopes: ['invest:read'],
    readOnly: true,
  },
  {
    name: 'get_portfolio_summary',
    description: 'Get a full portfolio summary including allocation, performance, and top holdings.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'Investment account ID (UUID)',
        },
        period: {
          type: 'string',
          enum: ['1d', '1w', '1m', '3m', '1y', 'ytd'],
          description: 'Performance period',
        },
      },
      required: ['account_id'],
    },
    requiredScopes: ['invest:read'],
    readOnly: true,
  },
  {
    name: 'get_investment_transactions',
    description: 'Get recent investment transactions (buys, sells, dividends) for an account.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Investment account ID' },
        limit: { type: 'number', description: 'Max results (default 20)', default: 20 },
      },
      required: ['account_id'],
    },
    requiredScopes: ['invest:read'],
    readOnly: true,
  },
];

export function filterByScopes(tools: InvestTool[], tokenScopes: string[]): InvestTool[] {
  // Empty scope list → only tools that require no scopes (parity with
  // demo_mcp_server toolScopeMap.filterToolsByScope). Advertising the full
  // catalog to zero-scope tokens violates least-privilege.
  if (tokenScopes.length === 0) {
    return tools.filter((t) => t.requiredScopes.length === 0);
  }
  const has = (s: string) => tokenScopes.includes(s) || tokenScopes.includes('*');
  return tools.filter((t) => t.requiredScopes.length === 0 || t.requiredScopes.every(has));
}
