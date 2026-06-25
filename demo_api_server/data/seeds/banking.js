module.exports = {
  // ── Demo account/transaction seed data ──────────────────────────────────────
  seed: {
    primary:   { accountType: 'CHECKING', name: 'Primary Checking', balanceBase: 2500, balanceRange: 700 },
    secondary: { accountType: 'SAVINGS',  name: 'Savings Account',  balanceBase: 8500, balanceRange: 6500 },
    transactions: [
      { description: 'Payroll Deposit',     type: 'deposit',  toSecondary: false },
      { description: 'Grocery Store',       type: 'purchase', toSecondary: false },
      { description: 'Transfer to Savings', type: 'transfer', toSecondary: true  },
      { description: 'Coffee Shop',         type: 'purchase', toSecondary: false },
      { description: 'Utility Bill',        type: 'purchase', toSecondary: false },
      { description: 'Credit Card Payment', type: 'purchase', toSecondary: false },
    ],
  },

  // ── Heuristic chip label overrides (key matches HEURISTIC_CHIPS id) ─────────
  chips: [
    { key: 'balance',      label: 'Check Balance'    },
    { key: 'accounts',     label: 'My Accounts'      },
    { key: 'transactions', label: 'Transactions'     },
    { key: 'transfer',     label: 'Transfer Funds'   },
    { key: 'feature',      label: 'Show Mortgage Data' },
  ],

  // ── LLM chip groups (Advanced Analysis panel) ────────────────────────────────
  llmChipGroups: {
    'Time-Based': [
      { id: 'last_30_days', label: 'Last 30 Days',    message: 'Show me transactions from the last 30 days' },
      { id: 'this_month',   label: 'This Month',      message: 'What transactions did I make this month?' },
      { id: 'last_week',    label: 'Last Week',       message: 'Any purchases last week?' },
      { id: 'quarter',      label: 'Quarter to Date', message: 'Transactions this quarter' },
    ],
    'Amount-Based': [
      { id: 'big_purchases', label: 'Big Purchases',       message: 'Show me my large purchases over $100' },
      { id: 'max_purchase',  label: 'Max Purchase',        message: "What's my biggest purchase?" },
      { id: 'small_txns',    label: 'Small Transactions',  message: 'Any transactions under $10?' },
      { id: 'range_query',   label: 'Range Query',         message: 'Transactions between $50-150' },
    ],
    'Spending Analysis': [
      { id: 'spending_summary', label: 'Spending Summary',    message: 'How much did I spend on groceries?' },
      { id: 'spending_trends',  label: 'Spending Trends',     message: 'What percentage of my spending was over $100?' },
      { id: 'average_txn',      label: 'Average Transaction', message: "What's my average transaction amount?" },
      { id: 'highest_txn',      label: 'Highest Ever',        message: 'What was my highest transaction ever?' },
    ],
    'Category Analysis': [
      { id: 'grocery_spending', label: 'Grocery Spending', message: 'How much on groceries this month?' },
      { id: 'gas_spending',     label: 'Gas Spending',     message: 'Total gas purchases this quarter?' },
      { id: 'dining_out',       label: 'Dining Out',       message: 'Dining transactions over $50?' },
      { id: 'retail_spending',  label: 'Retail Spending',  message: 'Retail purchases last 30 days?' },
    ],
    'Smart Insights': [
      { id: 'spending_habits', label: 'Spending Habits', message: 'What are my top spending categories?' },
      { id: 'anomalies',       label: 'Anomalies',       message: 'Any unusual transactions?' },
      { id: 'compare_trends',  label: 'Compare Trends',  message: 'Am I spending more or less than last month?' },
      { id: 'recommendations', label: 'Recommendations', message: 'How can I reduce spending?' },
    ],
  },

  // ── LLM-facing MCP tool descriptions ────────────────────────────────────────
  toolDescriptions: {
    get_my_accounts:   "Retrieve the user's accounts with details including type, name, balance, and currency. Call this for any request about accounts, account information, or balance. No parameters required.",
    get_account_balance: 'Get the balance for a specific account. Use account ID from get_my_accounts response.',
    get_my_transactions: "Retrieve the user's transaction history with optional filtering by date range and amount.",
    create_transfer:   'Transfer funds between accounts. Requires user confirmation for high-value amounts.',
    create_deposit:    'Add funds to an account. Requires user confirmation for high-value amounts.',
    create_withdrawal: 'Remove funds from an account. Requires user confirmation for high-value amounts.',
  },
};
