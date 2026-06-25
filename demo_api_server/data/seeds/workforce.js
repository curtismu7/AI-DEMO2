module.exports = {
  // ── Demo account/transaction seed data ──────────────────────────────────────
  seed: {
    primary:   { accountType: 'PTO Balance', name: 'PTO Account',        balanceBase: 120, balanceRange: 80 },
    secondary: { accountType: 'Sick Leave',  name: 'Sick Leave Balance', balanceBase: 40,  balanceRange: 20 },
    transactions: [
      { description: 'Annual PTO Accrual',     type: 'Accrual',  toSecondary: false },
      { description: 'Vacation — Summer Trip', type: 'Usage',    toSecondary: false },
      { description: 'Sick Leave — Flu',       type: 'Usage',    toSecondary: true  },
      { description: 'Holiday Bonus Hours',    type: 'Accrual',  toSecondary: false },
      { description: 'PTO Carryover',          type: 'Transfer', toSecondary: false },
    ],
  },

  // ── Heuristic chip label overrides ───────────────────────────────────────────
  chips: [
    { key: 'balance',      label: 'PTO Balance'    },
    { key: 'accounts',     label: 'My Leave'       },
    { key: 'transactions', label: 'Leave History'  },
    { key: 'transfer',     label: 'Request Leave'  },
    { key: 'feature',      label: 'Show Leave Plan' },
  ],

  // ── LLM chip groups ───────────────────────────────────────────────────────────
  llmChipGroups: {
    'Time-Based': [
      { id: 'last_30_days', label: 'Last 30 Days',    message: 'Show me requests from the last 30 days' },
      { id: 'this_month',   label: 'This Month',      message: 'What requests did I submit this month?' },
      { id: 'last_week',    label: 'Last Week',       message: 'Any requests last week?' },
      { id: 'quarter',      label: 'Quarter to Date', message: 'Requests this quarter' },
    ],
    'Amount-Based': [
      { id: 'big_expenses', label: 'Large Expenses', message: 'Show me expense reports over $200' },
      { id: 'max_expense',  label: 'Largest Expense', message: 'What was my largest expense report?' },
      { id: 'small_claims', label: 'Small Claims',   message: 'Any claims under $25?' },
      { id: 'range_query',  label: 'Budget Range',   message: 'Expenses between $50-300' },
    ],
    'Spend Analysis': [
      { id: 'spending_summary', label: 'Expense Summary', message: 'How much have I expensed this year?' },
      { id: 'spending_trends',  label: 'Expense Trends',  message: 'What percentage of my expenses were over $100?' },
      { id: 'average_txn',      label: 'Average Expense', message: 'What is my average expense amount?' },
      { id: 'highest_txn',      label: 'Largest Claim',   message: 'What was my largest ever expense claim?' },
    ],
    'Category': [
      { id: 'travel',    label: 'Travel',    message: 'How much on travel expenses this quarter?' },
      { id: 'meals',     label: 'Meals',     message: 'Total meal expenses this month?' },
      { id: 'pto_usage', label: 'PTO Usage', message: 'How many PTO days have I used this year?' },
      { id: 'benefits',  label: 'Benefits',  message: 'Any benefits claims in the last 90 days?' },
    ],
    'Smart Insights': [
      { id: 'spending_habits', label: 'Top Categories', message: 'What expense categories do I claim most?' },
      { id: 'anomalies',       label: 'Unusual Claims', message: 'Any unusual or unexpected expenses?' },
      { id: 'compare_trends',  label: 'Compare Periods', message: 'Am I claiming more or less than last quarter?' },
      { id: 'recommendations', label: 'PTO Tips',       message: 'How much PTO do I have left and when should I use it?' },
    ],
  },

  // ── LLM-facing MCP tool descriptions ────────────────────────────────────────
  toolDescriptions: {
    get_my_accounts:     "Retrieve the employee's leave accounts including PTO Balance and Sick Leave. Call this for any request about leave, PTO, or sick days. No parameters required.",
    get_account_balance: 'Get the PTO or sick leave balance for a specific account. Use account ID from get_my_accounts response.',
    get_my_transactions: "Retrieve the employee's leave and expense history with optional filtering by date range.",
    create_transfer:     'Transfer PTO hours between accounts. Requires user confirmation for high-value amounts.',
    create_deposit:      'Accrue PTO or sick leave hours. Requires user confirmation for high-value amounts.',
    create_withdrawal:   'Use PTO or sick leave hours. Requires user confirmation for high-value amounts.',
  },
};
