'use strict';

import { McpToolDef } from './toolTypes';

export const BANKING_TOOLS: McpToolDef[] = [
  {
    name: 'list_banking_accounts',
    description: 'List all bank accounts for the authenticated user, including checking, savings, and credit card accounts with current balances.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['banking:read'],
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
    requiredScopes: ['banking:read'],
    readOnly: true,
    intentHints: [
      'show account details',
      'get my account balance',
      'what is my balance',
      'check my account',
    ],
  },
];
