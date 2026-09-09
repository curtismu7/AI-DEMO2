'use strict';

import { McpToolDef } from './toolTypes';

export const BANKING_TOOLS: McpToolDef[] = [
  {
    name: 'list_banking_accounts',
    description: 'List all bank accounts for the authenticated user, including checking, savings, and credit card accounts with current balances.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    // `read` is the scope-topology.json scope for banking reads (same as the
    // gateway's get_my_accounts). `banking:read` existed in no PingOne resource,
    // so every call 403'd — scripts/check-tool-scope-registration.js carried it
    // as a known-bad declaration until the Privilege banking-mcp door routed them.
    requiredScopes: ['read'],
    readOnly: true,
    intentHints: [
      'show my accounts',
      'list my bank accounts',
      'what accounts do I have',
      'show my checking and savings',
      'account overview',
    ],
  },
  {
    name: 'get_banking_account',
    description: 'Get details for a single bank account by ID, including balance, account type, and account number.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Bank account ID' },
      },
      required: ['account_id'],
    },
    requiredScopes: ['read'],
    readOnly: true,
    intentHints: [
      'show account details',
      'get my account balance',
      'what is my balance',
      'check my account',
    ],
  },
];
