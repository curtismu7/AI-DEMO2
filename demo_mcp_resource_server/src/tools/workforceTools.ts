'use strict';
import { McpToolDef } from './toolTypes';
import { dispatchWorkforceTool } from './workforceToolHandler';

export const WORKFORCE_TOOLS: McpToolDef[] = [
  {
    // Already the chip-facing name (no rename needed, unlike healthcare/
    // government/manufacturing/university) — scope-topology.json's
    // tools.list_expenses entry requires only "read".
    name: 'list_expenses',
    description: 'List all expense reports for the authenticated employee, including category, amount, status, and submission date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['read'],
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
  {
    // The write half of list_expenses' entity. Routed here (router.ts
    // WORKFORCE_TOOLS) so a filed expense lands in the SAME database the list
    // is read from — previously submit_expense wrote the BFF's in-memory store
    // and the expense was invisible to the next list_expenses.
    name: 'submit_expense',
    description: 'Submit a new expense for approval. Requires confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Expense category (optional — defaults to Travel)' },
        amount: { type: 'number', description: 'Expense amount (optional — defaults to 100)' },
        description: { type: 'string', description: 'Free-text description (optional — defaults to the category)' },
      },
      required: [],
    },
    requiredScopes: ['write'],
    readOnly: false,
    intentHints: ['submit an expense', 'file an expense report', 'expense this', 'claim reimbursement'],
  },
];

export { dispatchWorkforceTool };
