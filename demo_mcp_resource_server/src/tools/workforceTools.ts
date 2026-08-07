'use strict';
import { McpToolDef } from './toolTypes';
import { dispatchWorkforceTool } from './workforceToolHandler';

export const WORKFORCE_TOOLS: McpToolDef[] = [
  {
    name: 'list_expenses',
    description: 'List all expense reports for the authenticated employee, including category, amount, status, and submission date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['workforce:read'],
    readOnly: true,
    intentHints: [
      'show my expenses',
      'list my expense reports',
      'what expenses do I have',
      'my submitted expenses',
      'show expense history',
    ],
  },
  {
    name: 'get_expense',
    description: 'Get a single expense report by ID with full details.',
    inputSchema: {
      type: 'object',
      properties: {
        expense_id: { type: 'string', description: 'Expense report ID' },
      },
      required: ['expense_id'],
    },
    requiredScopes: ['workforce:read'],
    readOnly: true,
    intentHints: ['get expense details', 'check expense status', 'show expense report'],
  },
];

export { dispatchWorkforceTool };
