module.exports = [
  { id: 'bk1', label: 'My accounts', message: 'show my accounts', mode: 'both', tool: 'get_my_accounts', useCaseId: 'view_accounts' },
  { id: 'bk2', label: 'Check balance', message: 'what is my balance', mode: 'both', tool: 'get_account_balance', useCaseId: 'view_balance' },
  { id: 'bk3', label: 'Recent transactions', message: 'recent transactions', mode: 'both', tool: 'get_my_transactions', useCaseId: 'view_transactions' },
  { id: 'bk4', label: 'Transfer $100', message: 'transfer $100 from checking to savings', mode: 'both', tool: 'create_transfer', useCaseId: 'create_transfer' },
  { id: 'bk-hitl', label: '🔐 Transfer $500', message: 'transfer $500 from checking to savings', mode: 'both', hitlTrigger: true, tool: 'create_transfer', useCaseId: 'create_transfer_hitl' },
  { id: 'bk7', label: 'My mortgage', message: 'show my mortgage', mode: 'both', tool: 'show_mortgage', useCaseId: 'view_mortgage' },
  { id: 'bk8', label: 'Biggest spending categories', message: 'What are my biggest categories', mode: 'llm', useCaseId: 'view_spending_analysis' },
  { id: 'bk-direct', label: 'Direct MCP', message: 'get my accounts', mode: 'direct', tool: 'get_my_accounts', useCaseId: 'view_accounts_direct' },
];
