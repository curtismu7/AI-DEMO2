module.exports = {
  // ── Demo account/transaction seed data ──────────────────────────────────────
  seed: {
    primary:   { accountType: 'Primary Care', name: 'Primary Care Record',  balanceBase: 500,  balanceRange: 300 },
    secondary: { accountType: 'HSA',          name: 'Health Savings (HSA)', balanceBase: 3200, balanceRange: 1800 },
    transactions: [
      { description: 'Annual Physical — Dr. Patel',      type: 'Visit',        toSecondary: false },
      { description: 'Prescription Refill — Metformin',  type: 'Prescription', toSecondary: false },
      { description: 'HSA Contribution',                 type: 'Contribution', toSecondary: true  },
      { description: 'Lab Work — Quest Diagnostics',     type: 'Lab',          toSecondary: false },
      { description: 'Specialist Referral — Cardiology', type: 'Referral',     toSecondary: false },
    ],
  },

  // ── Heuristic chip label overrides ───────────────────────────────────────────
  chips: [
    { key: 'balance',      label: 'Check Coverage'     },
    { key: 'accounts',     label: 'My Records'         },
    { key: 'transactions', label: 'Appointments'       },
    { key: 'transfer',     label: 'Release Records'    },
    { key: 'feature',      label: 'Show Health Record' },
  ],

  // ── LLM chip groups ───────────────────────────────────────────────────────────
  llmChipGroups: {
    'Time-Based': [
      { id: 'last_30_days', label: 'Last 30 Days',    message: 'Show me appointments from the last 30 days' },
      { id: 'this_month',   label: 'This Month',      message: 'What appointments did I have this month?' },
      { id: 'last_week',    label: 'Last Week',       message: 'Any appointments last week?' },
      { id: 'quarter',      label: 'Quarter to Date', message: 'Appointments this quarter' },
    ],
    'Coverage': [
      { id: 'big_claims',    label: 'Large Claims',   message: 'Show me claims over $200' },
      { id: 'max_claim',     label: 'Largest Claim',  message: 'What was my largest covered expense?' },
      { id: 'copay_summary', label: 'Copay Summary',  message: 'What copays have I paid this year?' },
      { id: 'range_query',   label: 'Coverage Range', message: 'Appointments with coverage between $100-500' },
    ],
    'Care Analysis': [
      { id: 'visit_summary',   label: 'Visit Summary', message: 'How many times did I visit a provider this year?' },
      { id: 'care_trends',     label: 'Care Trends',   message: 'What types of appointments have I had most?' },
      { id: 'average_copay',   label: 'Average Copay', message: 'What is my average copay amount?' },
      { id: 'highest_expense', label: 'Highest Expense', message: 'What was my most expensive appointment?' },
    ],
    'Specialty': [
      { id: 'primary_care',  label: 'Primary Care',  message: 'How many primary care visits this year?' },
      { id: 'specialist',    label: 'Specialist',    message: 'Any specialist referrals in the last 90 days?' },
      { id: 'mental_health', label: 'Mental Health', message: 'Mental health appointments this quarter?' },
      { id: 'lab_work',      label: 'Lab Work',      message: 'Lab and diagnostic appointments last 6 months?' },
    ],
    'Smart Insights': [
      { id: 'spending_habits', label: 'Top Care Areas',    message: 'What are my most frequent types of care?' },
      { id: 'anomalies',       label: 'Unusual Charges',   message: 'Any unexpected or unusual charges on my record?' },
      { id: 'compare_trends',  label: 'Compare Periods',   message: 'Am I visiting providers more or less than last year?' },
      { id: 'recommendations', label: 'Coverage Tips',     message: 'How can I make better use of my coverage?' },
    ],
  },

  // ── LLM-facing MCP tool descriptions ────────────────────────────────────────
  toolDescriptions: {
    get_my_accounts:     "Retrieve the patient's health records including Primary Care and HSA accounts. Call this for any request about records, coverage, or health savings. No parameters required.",
    get_account_balance: 'Get the balance or coverage amount for a specific health account. Use account ID from get_my_accounts response.',
    get_my_transactions: "Retrieve the patient's appointment and care history with optional filtering by date range.",
    create_transfer:     'Transfer funds from HSA to cover a medical expense. Requires user confirmation for high-value amounts.',
    create_deposit:      'Add a contribution to a health account. Requires user confirmation for high-value amounts.',
    create_withdrawal:   'Process a medical expense payment from an account. Requires user confirmation for high-value amounts.',
  },
};
