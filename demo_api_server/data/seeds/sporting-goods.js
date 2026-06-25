module.exports = {
  // ── Demo account/transaction seed data ──────────────────────────────────────
  seed: {
    primary:   { accountType: 'Pro Member',   name: 'Pro Member Account', balanceBase: 1200, balanceRange: 800 },
    secondary: { accountType: 'Elite Member', name: 'Elite Rewards',      balanceBase: 4500, balanceRange: 3000 },
    transactions: [
      { description: 'Nike Running Shoes — In-Store',  type: 'In-Store',   toSecondary: false },
      { description: 'Patagonia Jacket — Online',      type: 'Online',     toSecondary: false },
      { description: 'Team Jersey Bulk Order',         type: 'Team Order', toSecondary: true  },
      { description: 'Titleist Golf Balls — In-Store', type: 'In-Store',   toSecondary: false },
      { description: 'Gear Return — Faulty Helmet',    type: 'Return',     toSecondary: false },
    ],
  },

  // ── Heuristic chip label overrides ───────────────────────────────────────────
  chips: [
    { key: 'balance',      label: 'Reward Points'   },
    { key: 'accounts',     label: 'My Gear'         },
    { key: 'transactions', label: 'Purchase History' },
    { key: 'transfer',     label: 'Place Order'     },
    { key: 'feature',      label: 'Show Gear Order' },
  ],

  // ── LLM chip groups ───────────────────────────────────────────────────────────
  llmChipGroups: {
    'Time-Based': [
      { id: 'last_30_days', label: 'Last 30 Days',    message: 'Show me purchases from the last 30 days' },
      { id: 'this_month',   label: 'This Month',      message: 'What gear did I buy this month?' },
      { id: 'last_week',    label: 'Last Week',       message: 'Any purchases last week?' },
      { id: 'quarter',      label: 'Quarter to Date', message: 'Purchases this quarter' },
    ],
    'Amount-Based': [
      { id: 'big_purchases', label: 'Big Orders',       message: 'Show me orders over $100' },
      { id: 'max_purchase',  label: 'Biggest Order',    message: 'What was my most expensive purchase?' },
      { id: 'small_txns',    label: 'Small Purchases',  message: 'Any purchases under $20?' },
      { id: 'range_query',   label: 'Price Range',      message: 'Purchases between $50-200' },
    ],
    'Purchase Analysis': [
      { id: 'spending_summary', label: 'Spend Summary',    message: 'How much have I spent on gear this year?' },
      { id: 'spending_trends',  label: 'Purchase Trends',  message: 'What percentage of my spending was over $100?' },
      { id: 'average_txn',      label: 'Average Order',    message: 'What is my average order value?' },
      { id: 'highest_txn',      label: 'Highest Purchase', message: 'What was my most expensive order ever?' },
    ],
    'Category': [
      { id: 'running_gear',   label: 'Running',     message: 'How much have I spent on running gear?' },
      { id: 'apparel_spend',  label: 'Apparel',     message: 'Total apparel purchases this quarter?' },
      { id: 'team_orders',    label: 'Team Orders', message: 'Team orders over $200?' },
      { id: 'returns',        label: 'Returns',     message: 'Any returns or refunds in the last 30 days?' },
    ],
    'Smart Insights': [
      { id: 'spending_habits', label: 'Top Categories', message: 'What sport categories do I spend most on?' },
      { id: 'anomalies',       label: 'Unusual Orders', message: 'Any unusual or unexpected purchases?' },
      { id: 'compare_trends',  label: 'Compare Periods', message: 'Am I spending more or less on gear than last season?' },
      { id: 'recommendations', label: 'Points Tips',    message: 'How can I earn more reward points?' },
    ],
  },

  // ── LLM-facing MCP tool descriptions ────────────────────────────────────────
  toolDescriptions: {
    get_my_accounts:     "Retrieve the member's gear accounts including Pro Member and Elite Rewards. Call this for any request about gear, memberships, or reward points. No parameters required.",
    get_account_balance: 'Get the reward points or credit balance for a specific account. Use account ID from get_my_accounts response.',
    get_my_transactions: "Retrieve the member's purchase history and gear orders with optional filtering.",
    create_transfer:     'Transfer reward points between accounts. Requires user confirmation for high-value amounts.',
    create_deposit:      'Add points or credit to an account. Requires user confirmation for high-value amounts.',
    create_withdrawal:   'Redeem points or credit from an account. Requires user confirmation for high-value amounts.',
  },
};
