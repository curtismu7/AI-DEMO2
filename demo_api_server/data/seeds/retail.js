module.exports = {
  // ── Demo account/transaction seed data ──────────────────────────────────────
  seed: {
    primary:   { accountType: 'Rewards Points', name: 'Rewards Account',     balanceBase: 4200, balanceRange: 2000 },
    secondary: { accountType: 'Store Credit',   name: 'Store Credit Wallet', balanceBase: 150,  balanceRange: 100 },
    transactions: [
      { description: 'TV Purchase — Great Buy Store',    type: 'In-Store',  toSecondary: false },
      { description: 'Laptop Online Order',              type: 'Online',    toSecondary: false },
      { description: 'Rewards Redemption',               type: 'Redemption', toSecondary: true },
      { description: 'Headphones — In-Store',            type: 'In-Store',  toSecondary: false },
      { description: 'Extended Warranty — Refrigerator', type: 'Service',   toSecondary: false },
    ],
  },

  // ── Heuristic chip label overrides ───────────────────────────────────────────
  chips: [
    { key: 'balance',      label: 'Rewards Points'      },
    { key: 'accounts',     label: 'List My Orders'      },
    { key: 'transactions', label: 'Purchase History'    },
    { key: 'transfer',     label: 'Checkout'            },
    { key: 'feature',      label: 'Show Large Purchase' },
  ],

  // ── LLM chip groups ───────────────────────────────────────────────────────────
  llmChipGroups: {
    'Time-Based': [
      { id: 'last_30_days', label: 'Last 30 Days',    message: 'Show me purchases from the last 30 days' },
      { id: 'this_month',   label: 'This Month',      message: 'What did I buy this month?' },
      { id: 'last_week',    label: 'Last Week',       message: 'Any purchases last week?' },
      { id: 'quarter',      label: 'Quarter to Date', message: 'Purchases this quarter' },
    ],
    'Amount-Based': [
      { id: 'big_purchases', label: 'Big Purchases',   message: 'Show me purchases over $200' },
      { id: 'max_purchase',  label: 'Largest Purchase', message: 'What was my most expensive purchase?' },
      { id: 'small_txns',    label: 'Small Purchases', message: 'Any purchases under $25?' },
      { id: 'range_query',   label: 'Price Range',     message: 'Purchases between $50-300' },
    ],
    'Spend Analysis': [
      { id: 'spending_summary', label: 'Spend Summary',   message: 'How much have I spent this year?' },
      { id: 'spending_trends',  label: 'Spend Trends',    message: 'What percentage of my spending was over $200?' },
      { id: 'average_txn',      label: 'Average Purchase', message: 'What is my average order value?' },
      { id: 'highest_txn',      label: 'Highest Ever',    message: 'What was my highest ever purchase?' },
    ],
    'Category': [
      { id: 'tv_audio',   label: 'TV & Audio', message: 'How much on TVs and audio gear this year?' },
      { id: 'computers',  label: 'Computers',  message: 'Total laptop and computer purchases?' },
      { id: 'gaming',     label: 'Gaming',     message: 'Gaming purchases last 90 days?' },
      { id: 'returns',    label: 'Returns',    message: 'Any returns or refunds last 30 days?' },
    ],
    'Smart Insights': [
      { id: 'spending_habits', label: 'Top Categories', message: 'What product categories do I buy most?' },
      { id: 'anomalies',       label: 'Unusual Orders', message: 'Any unusual or unexpected purchases?' },
      { id: 'compare_trends',  label: 'Compare Periods', message: 'Am I spending more or less than last quarter?' },
      { id: 'recommendations', label: 'Points Tips',    message: 'How can I earn more rewards points?' },
    ],
  },

  // ── LLM-facing MCP tool descriptions ────────────────────────────────────────
  toolDescriptions: {
    get_my_accounts:     "Retrieve the customer's retail accounts including Rewards Points and Store Credit. Call this for any request about rewards, store credit, or order history. No parameters required.",
    get_account_balance: 'Get the rewards points or store credit balance for a specific account. Use account ID from get_my_accounts response.',
    get_my_transactions: "Retrieve the customer's purchase history and order records with optional filtering.",
    create_transfer:     'Redeem rewards points or transfer store credit. Requires user confirmation for high-value amounts.',
    create_deposit:      'Add rewards points or credit to an account. Requires user confirmation for high-value amounts.',
    create_withdrawal:   'Use store credit for a purchase. Requires user confirmation for high-value amounts.',
  },
};
