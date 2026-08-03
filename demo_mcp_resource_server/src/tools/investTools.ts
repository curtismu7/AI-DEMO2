'use strict';

/**
 * Investment MCP tool definitions. The shared tool shape lives in toolTypes.ts
 * because this server now hosts more than one namespace.
 */

import { McpToolDef } from './toolTypes';

export const INVEST_TOOLS: McpToolDef[] = [
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
