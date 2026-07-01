/**
 * Support Agent Tools
 * 5 tools with Zod schemas for Mastra framework
 */

const { z } = require('zod');
const { FAQ_DATABASE } = require('./faqDatabase');

const SUPPORT_TOOLS = [
  {
    name: 'get_account_balance',
    description: 'Get the current account balance',
    inputSchema: z.object({
      account_type: z.enum(['checking', 'savings']).describe('Type of account')
    }),
    handler: async (input) => {
      // Mock implementation
      const balances = {
        checking: 5234.67,
        savings: 12500.00
      };
      return {
        account_type: input.account_type,
        balance: balances[input.account_type],
        currency: 'USD',
        last_updated: new Date().toISOString()
      };
    }
  },
  {
    name: 'get_recent_transactions',
    description: 'Get the last 10 transactions for an account',
    inputSchema: z.object({
      account_type: z.enum(['checking', 'savings']).describe('Type of account'),
      limit: z.number().optional().default(10).describe('Number of transactions to return')
    }),
    handler: async (input) => {
      // Mock implementation
      const mockTransactions = [
        { date: '2026-06-30', merchant: 'Whole Foods', amount: -87.43, type: 'debit' },
        { date: '2026-06-29', merchant: 'Starbucks', amount: -5.67, type: 'debit' },
        { date: '2026-06-28', merchant: 'Employer Inc', amount: 3500.00, type: 'credit' },
        { date: '2026-06-27', merchant: 'Electric Company', amount: -156.23, type: 'debit' },
        { date: '2026-06-26', merchant: 'Gym Membership', amount: -79.99, type: 'debit' }
      ];
      return {
        account_type: input.account_type,
        transactions: mockTransactions.slice(0, input.limit),
        total_count: 5
      };
    }
  },
  {
    name: 'lookup_faq',
    description: 'Search the FAQ database for answers to common questions',
    inputSchema: z.object({
      query: z.string().describe('Search query or question'),
      category: z.string().optional().describe('Optional: filter by FAQ category')
    }),
    handler: async (input) => {
      const query = input.query.toLowerCase();
      const results = FAQ_DATABASE.filter(faq => {
        const matches = faq.question.toLowerCase().includes(query) ||
                       faq.answer.toLowerCase().includes(query);
        const categoryMatches = !input.category || faq.category === input.category;
        return matches && categoryMatches;
      });
      return {
        query: input.query,
        results: results.slice(0, 3),
        total_matches: results.length
      };
    }
  },
  {
    name: 'find_atm_location',
    description: 'Find the nearest ATM location',
    inputSchema: z.object({
      zip_code: z.string().describe('ZIP code to search near'),
      limit: z.number().optional().default(3).describe('Number of ATMs to return')
    }),
    handler: async (input) => {
      // Mock implementation
      const mockATMs = [
        { name: 'Downtown Branch', distance_miles: 0.3, address: '123 Main St' },
        { name: 'Shopping Center ATM', distance_miles: 0.8, address: '456 Oak Ave' },
        { name: 'Airport ATM', distance_miles: 2.1, address: 'Terminal 2, Concourse B' }
      ];
      return {
        zip_code: input.zip_code,
        atms: mockATMs.slice(0, input.limit),
        total_found: 3
      };
    }
  },
  {
    name: 'submit_support_ticket',
    description: 'Submit a support ticket for complex issues that need escalation',
    inputSchema: z.object({
      subject: z.string().describe('Ticket subject'),
      description: z.string().describe('Detailed description of the issue'),
      priority: z.enum(['low', 'medium', 'high']).optional().default('medium').describe('Priority level')
    }),
    handler: async (input) => {
      // Mock implementation
      const ticketId = `TKT-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      return {
        ticket_id: ticketId,
        subject: input.subject,
        priority: input.priority,
        status: 'created',
        estimated_response: '2-4 hours',
        message: `Your support ticket ${ticketId} has been created. A specialist will contact you shortly.`
      };
    }
  }
];

module.exports = {
  SUPPORT_TOOLS
};
