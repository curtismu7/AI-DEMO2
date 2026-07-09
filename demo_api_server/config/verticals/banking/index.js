'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');
const { getBankingToolDefinitions } = require('../../../services/agentBuilder');
const { dispatchBankingAction } = require('../../../services/demoAgentLangGraphService');
const { EDUCATION_HEURISTICS } = require('../shared/educationHeuristics');

// Banking heuristics: phrase → action map (mirrors parseBanking() from nlIntentParser.js)
// Actions must match tool names in getToolsWithActionAliases()
const HEURISTICS = [
  // mcp_tools (must be first to not interfere with other patterns)
  { re: /\b(list|show|get|what).*(mcp.*tools?|tools?.*available|available.*tools?)\b|\btools?\s*(list|available)\b/, action: 'mcp_tools' },
  // sensitive_account_details (must precede general accounts check)
  { re: /\b(sensitive account details|full account|routing number|account number|account details)\b/, action: 'sensitive_account_details' },
  // mortgage_demo (must precede balance check)
  { re: /\b(show|view|see|get|my|whats?|what is)\s*(mortgage|home\s*loan)\b|\b(mortgage|home\s*loan)\s*(data|info|details|balance|summary|payment)\b|^mortgage$|^home\s*loan$/, action: 'mortgage_demo' },
  // invest_demo — cross-vertical portfolio chip (must precede balance)
  { re: /\b(show|view|see|get|my)\s*(portfolio\s*status|investment\s*portfolio|investments?|portfolio)\b|\bportfolio\s*status\b|^investments?$|^portfolio$/, action: 'invest_demo' },
  // branch_hours (public catalog / progressive trust Act 1) — before balance/accounts
  { re: /\b(branch|branches|atm|atms)\b/, action: 'branch_hours' },
  // balance (must precede accounts check). extractsAccountType pulls the
  // checking/savings qualifier into params (downstream routes consume it).
  { re: /\bbalances?\b/, action: 'balance', extractsAccountType: true },
  // account_nickname — narrow read; must precede generic accounts
  { re: /^account nickname$|\bnickname\b.*\baccount|\baccount\b.*\bnickname\b|\b(display\s+name|account\s+display\s+name)\b/, action: 'account_nickname' },
  // accounts — exclude "account history" (transactions catalog phrase)
  { re: /\b(accounts?|account\s*(list|overview|summary)|my\s*accounts?|check\s*accounts?|view\s*accounts?)\b(?!\s*history)/, action: 'accounts' },
  // biggest_purchase
  { re: /\b(biggest|largest|highest|top)\b.*(purchase|spend|transaction|payment)\b|\b(purchase|spend|transaction|payment).*(biggest|largest|highest)\b|\bmost expensive\b|\bspent the most\b|\bbiggest spend\b/, action: 'biggest_purchase' },
  // spending_summary
  { re: /\b(spending summary|total spend|how much.*(spend|spent)|where.*money|breakdown.*spend\w*|spend\w*.*breakdown|biggest categor\w+|top categor\w+|spending categor\w+)\b/, action: 'spending_summary' },
  // unusual_patterns — chip bk9 / seed "Any unusual transactions?" (must precede bare "transactions")
  { re: /\b(unusual|anomal\w*|suspicious|unexpected)\b.*\b(pattern|transaction|activity|purchase|charge|spend)|check for unusual|flag any unusual|spot unusual/i, action: 'unusual_patterns' },
  // afford_check — chip bk10 (must precede bare "balance"/"savings")
  { re: /\b(afford|cover)\b.*\b(expense|purchase|cost)|savings?\s+cover|big\s+upcoming\s+expense|can i afford/i, action: 'afford_check' },
  // transactions (includes catalog phrase "account history")
  { re: /\b(transactions?|history|activity|recent|account\s+history)\b/, action: 'transactions' },
  // transfer (must precede deposit/withdraw for specificity)
  { re: /\btransfer\b/, action: 'transfer', extractsAmount: true, extractsFromId: true, extractsToId: true },
  // deposit
  { re: /\bdeposit\b/, action: 'deposit', extractsAmount: true, extractsToId: true },
  // withdraw
  { re: /\b(withdraw|withdrawal)\b/, action: 'withdraw', extractsAmount: true, extractsFromId: true },
  // logout
  { re: /\b(logout|log out|sign out|signout)\b/, action: 'logout' },
];

const ALL_HEURISTICS = [...HEURISTICS, ...EDUCATION_HEURISTICS];

function getManifest() {
  return verticalManifest.resolver.resolve('banking');
}

function getSystemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'customer';
  return [
    'You are a Super Banking agent. Help customers check account balances, view transaction history, transfer funds, and manage their accounts.',
    'Use banking language: accounts are checking, savings, or loan accounts, transactions are deposits, withdrawals, or transfers, balance is account balance.',
    `The signed-in user role is "${role}".`,
    'Be professional and clear. For write operations (transfer, deposit, withdraw), confirm the details with the user before proceeding.',
  ].join(' ');
}

function getToolsWithActionAliases() {
  const bankingTools = getBankingToolDefinitions();
  // Add action-name aliases for dispatchVerticalIntent authz/validation.
  // When heuristic parser returns action:'accounts', we need a tool def named 'accounts'.
  // These aliases mirror the heuristic actions from parseBanking().
  const actionAliases = [
    {
      name: 'accounts',
      description: 'Show the user\'s bank accounts.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'account_nickname',
      description: 'Show the display nickname for an account.',
      inputSchema: { type: 'object', properties: { accountId: { type: 'string' } } },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'balance',
      description: 'Check account balance.',
      inputSchema: { type: 'object', properties: { accountId: { type: 'string' }, accountType: { type: 'string' } } },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'transactions',
      description: 'View recent transactions.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'transfer',
      description: 'Transfer funds between accounts.',
      inputSchema: { type: 'object', properties: { fromId: { type: 'string' }, toId: { type: 'string' }, amount: { type: 'number' } } },
      scopes: ['write'],
      authz: { consent: true },
    },
    {
      name: 'deposit',
      description: 'Deposit funds to an account.',
      inputSchema: { type: 'object', properties: { toId: { type: 'string' }, amount: { type: 'number' } } },
      scopes: ['write'],
      authz: { consent: true },
    },
    {
      name: 'withdraw',
      description: 'Withdraw funds from an account.',
      inputSchema: { type: 'object', properties: { fromId: { type: 'string' }, amount: { type: 'number' } } },
      scopes: ['write'],
      authz: { consent: true },
    },
    {
      name: 'sensitive_account_details',
      description: 'View sensitive account details.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: { consent: true },
    },
    {
      name: 'mcp_tools',
      description: 'List available MCP tools.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'mortgage_demo',
      description: 'Show mortgage information.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'invest_demo',
      description: 'Show investment portfolio via api_key path.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'branch_hours',
      description: 'Look up nearby branch or ATM hours.',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'biggest_purchase',
      description: 'Show biggest purchase information.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'spending_summary',
      description: 'Show spending summary.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'unusual_patterns',
      description: 'Flag unusual or outlier transactions from recent activity.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'afford_check',
      description: 'Check whether savings can cover a large upcoming expense.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'api_key_demo',
      description: 'Demo API-key path.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'dual_token_demo',
      description: 'Demo access and ID token path.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'logout',
      description: 'Logout the user.',
      inputSchema: { type: 'object', properties: {} },
      scopes: [],
      authz: {},
    },
    {
      name: 'vertical_feature_demo',
      description: 'Demo vertical feature.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
  ];
  // Return both real MCP tool defs + action aliases for dispatchVerticalIntent routing
  return [...bankingTools, ...actionAliases];
}

function getAuthz() {
  const tools = getToolsWithActionAliases();
  const out = {};
  for (const t of tools) {
    out[t.name] = t.authz || {};
  }
  return out;
}

module.exports = {
  getManifest,
  getTools: () => getToolsWithActionAliases(),
  getHeuristics: () => ALL_HEURISTICS,
  getSystemPrompt,
  getDataStore: () => ({ get: () => ({}) }), // MCP-backed, no local store
  executeTool: async (name, params, ctx) => {
    // Banking actions delegated to dispatchBankingAction (extracted from executeHeuristicBanking).
    // These handle core banking operations that require MCP or store access.
    const coreActions = ['accounts', 'balance', 'transactions', 'transfer', 'deposit', 'withdraw', 'sensitive_account_details'];

    if (coreActions.includes(name)) {
      // Construct the action context for dispatchBankingAction
      const dispatchCtx = {
        userToken: ctx && ctx.userToken ? ctx.userToken : null,
        req: ctx && ctx.req ? ctx.req : null,
        subjectToken: ctx && ctx.subjectToken ? ctx.subjectToken : null,
        isAdmin: ctx && ctx.isAdmin ? ctx.isAdmin : false,
        terminology: (ctx && ctx.manifest && ctx.manifest.terminology) || null,
      };

      const result = await dispatchBankingAction(name, params || {}, ctx.userId, dispatchCtx);
      return result;
    }

    // Placeholder actions (demos, etc.) return success with empty result
    // These are captured by the heuristic path and handled elsewhere
    const placeholderActions = ['mcp_tools', 'mortgage_demo', 'branch_hours', 'biggest_purchase', 'spending_summary', 'unusual_patterns', 'afford_check', 'api_key_demo', 'dual_token_demo', 'logout', 'vertical_feature_demo'];
    if (placeholderActions.includes(name)) {
      return { result: { data: {} }, render: 'text' };
    }

    // Unknown action
    return { result: { error: `unknown banking action: ${name}` }, render: 'text' };
  },
  getAuthz,
};