// banking_api_server/services/mcpLocalTools.js
/**
 * In-process fallback for banking MCP tool calls.
 *
 * Used when banking_mcp_server is not running (no MCP_SERVER_URL / ws://localhost:8080
 * unreachable). Implements the same 6 tool contracts that BankingToolProvider handles,
 * but directly against the local dataStore — no WebSocket round-trip needed.
 *
 * Return shape matches mcpWebSocketClient.mcpCallTool:
 *   { content: [{ type: 'text', text: string }] }
 */
'use strict';

const dataStore = require('../data/store');
const runtimeSettings = require('../config/runtimeSettings');
const { writeMcpTrafficEntry } = require('./mcpTrafficLogger');
const txConsent = require('./transactionConsentChallenge');
const { resolveAccountId } = require('../utils/accountUtils');
const { roundToCents } = require('../utils/money');
const { BANKING_ACCOUNT_SPECS, SPEC_BY_TYPE, buildBankingAccount } = require('../data/bankingAccountSpecs');

/**
 * Mirrors POST /api/transactions HITL gate (Phase 170):
 *   - Transfers ALWAYS require consent (regardless of amount).
 *   - Withdrawals/deposits require consent when amount > confirm_threshold_usd.
 * Local MCP tools cannot complete the browser consent flow, so we refuse instead of bypassing HITL.
 */
function hitlBlocksLocalWrite(userId, amount, type) {
  const user = dataStore.getUserById(userId);
  if (user && user.role === 'admin') return false;
  if (!['transfer', 'withdrawal', 'deposit'].includes(type)) return false;
  // Phase 170: ALL transfers require consent, no amount check.
  if (type === 'transfer') return true;
  // Withdrawals/deposits: threshold-based.
  const rounded = roundToCents(parseFloat(amount));
  if (!Number.isFinite(rounded)) return false;
  return rounded > txConsent.HIGH_VALUE_CONSENT_USD;
}

const HITL_LOCAL_AGENT_MESSAGE =
  'Transfers require human approval in the browser — open the dashboard, initiate the transfer there, and complete the consent screen. The banking assistant cannot bypass the HITL consent flow.';

/**
 * Mirrors the step-up MFA gate in routes/transactions.js for the local MCP tool path.
 * Returns a step_up_required result object if step-up is needed, null otherwise.
 *
 * @param {string} type   - Transaction type ('transfer' | 'withdrawal')
 * @param {number} amount - Rounded transaction amount
 * @param {object} req    - Express request (may be undefined in degraded paths)
 */
function checkLocalStepUp(type, amount, req) {
  if (!req) return null; // No session context (direct test call) — skip step-up check
  if (!runtimeSettings.get('stepUpEnabled')) return null;
  const types = runtimeSettings.get('stepUpTransactionTypes');
  if (!Array.isArray(types) || !types.includes(type)) return null;
  // If stepUpWithdrawalsAlways is enabled, skip threshold for withdrawals
  const withdrawalsAlways = runtimeSettings.get('stepUpWithdrawalsAlways');
  const threshold = runtimeSettings.get('stepUpAmountThreshold') ?? 0;
  if (type === 'withdrawal' && withdrawalsAlways) {
    // Do not skip based on amount — fall through to step-up check below
  } else {
    if (parseFloat(amount) < threshold) return null;
  }
  const sessionUser = req?.session?.user;
  if (sessionUser?.role === 'admin') return null;
  // Email OTP step-up: if the user completed OTP verification in this session, allow once.
  if (req.session?.stepUpVerified > Date.now()) {
    req.session.stepUpVerified = 0; // consume — single-use; 0 fails the > Date.now() check
    return null;
  }
  const stepUpAcr = runtimeSettings.get('stepUpAcrValue') || 'Multi_factor';
  const userAcr = String(sessionUser?.acr || '');
  const elevated = userAcr === stepUpAcr || userAcr.split(' ').includes(stepUpAcr);
  if (elevated) return null;
  return {
    ok: false,
    step_up_required: true,
    error: 'step_up_required',
    step_up_method: runtimeSettings.get('stepUpMethod') || 'email',
    step_up_acr: stepUpAcr,
    amount_threshold: threshold,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────
// Return structured data objects directly so BankingAgent.js result panel
// (formatResult / setResultPanel) can find result.accounts, result.transactions, etc.

/**
 * Top up a banking user with the loan + credit card accounts so the agent's
 * get_my_accounts matches the dashboard's /api/accounts/my (which performs the
 * same top-up in routes/accounts.js). Both build from the shared
 * bankingAccountSpecs, so IDs/numbers/balances stay identical across paths.
 */
async function topUpBankingAccounts(userId, existing, { addLoan, addCredit }) {
  const result = [...existing];
  const add = async (spec) => {
    const account = buildBankingAccount(userId, spec);
    if (dataStore.getAccountById(account.id)) return;
    result.push(await dataStore.createAccount(account));
  };
  if (addLoan)   await add(SPEC_BY_TYPE.loan);
  if (addCredit) await add(SPEC_BY_TYPE.credit_card);
  return result;
}

/**
 * Auto-provision demo accounts for first-time users. Builds the account set from
 * the shared bankingAccountSpecs (same source routes/accounts.js::provisionDemoAccounts
 * uses) plus sample transaction history.
 */
async function ensureAccounts(userId) {
  let accounts = dataStore.getAccountsByUserId(userId);
  if (accounts.length > 0) {
    // Top up the banking loan + credit card accounts for users provisioned before
    // that set existed, so the agent's get_my_accounts matches the dashboard's
    // /api/accounts/my top-up. Gated on the checking+savings signature so
    // non-banking verticals (workforce PTO, sporting-goods gear, …) are untouched.
    const typeOf = (a) => String(a.accountType || a.type || '').toLowerCase();
    const hasChecking = accounts.some((a) => typeOf(a) === 'checking');
    const hasSavings  = accounts.some((a) => typeOf(a) === 'savings');
    const hasLoan     = accounts.some((a) => typeOf(a) === 'loan');
    const hasCredit   = accounts.some((a) => ['credit_card', 'credit'].includes(typeOf(a)));
    if (hasChecking && hasSavings && (!hasLoan || !hasCredit)) {
      accounts = await topUpBankingAccounts(userId, accounts, { addLoan: !hasLoan, addCredit: !hasCredit });
    }
    return accounts;
  }

  const uid = userId.replace(/-/g, '').slice(0, 10);
  const checkingId = `chk-${uid}`;
  const savingsId  = `sav-${uid}`;
  const loanId     = `loan-${uid}`;
  const creditId   = `cc-${uid}`;

  // Build the full 4-account set from the shared specs (same IDs/numbers/balances
  // the dashboard's provisionDemoAccounts uses). Sequential to keep each persist
  // ordered, matching the original behaviour.
  const created = [];
  for (const spec of BANKING_ACCOUNT_SPECS) {
    created.push(await dataStore.createAccount(buildBankingAccount(userId, spec)));
  }
  const [checking, savings, carLoan, creditCard] = created;

  const sampleTxns = [
    { fromAccountId: null,       toAccountId: checkingId, amount: 3500.00, type: 'deposit',    description: 'Direct deposit – Payroll',   createdAt: new Date('2024-03-01T09:00:00Z') },
    { fromAccountId: checkingId, toAccountId: savingsId,  amount:  500.00, type: 'transfer',   description: 'Monthly savings transfer',   createdAt: new Date('2024-03-03T11:15:00Z') },
    { fromAccountId: checkingId, toAccountId: null,       amount:  120.00, type: 'withdrawal', description: 'ATM withdrawal',             createdAt: new Date('2024-03-07T14:30:00Z') },
    { fromAccountId: null,       toAccountId: savingsId,  amount:  250.00, type: 'deposit',    description: 'Tax refund deposit',         createdAt: new Date('2024-03-10T10:00:00Z') },
    { fromAccountId: checkingId, toAccountId: null,       amount:   85.50, type: 'withdrawal', description: 'Grocery store',             createdAt: new Date('2024-03-14T17:45:00Z') },
    { fromAccountId: checkingId, toAccountId: null,       amount:  200.00, type: 'withdrawal', description: 'Utility bill – Electric',   createdAt: new Date('2024-03-18T08:00:00Z') },
    { fromAccountId: null,       toAccountId: checkingId, amount:   75.00, type: 'deposit',    description: 'Reimbursement',             createdAt: new Date('2024-03-20T13:00:00Z') },
    { fromAccountId: checkingId, toAccountId: loanId,     amount:  450.00, type: 'payment',    description: 'Car loan payment',          createdAt: new Date('2024-03-05T08:00:00Z') },
    { fromAccountId: checkingId, toAccountId: creditId,   amount:  300.00, type: 'payment',    description: 'Credit card payment',       createdAt: new Date('2024-03-12T08:00:00Z') },
  ];
  for (const txn of sampleTxns) {
    await dataStore.createTransaction({ ...txn, userId, status: 'completed' });
  }

  return [checking, savings, carLoan, creditCard];
}

// ─── tool implementations ─────────────────────────────────────────────────────

async function get_my_accounts(params, userId) {
  const accounts = await ensureAccounts(userId);
  return { accounts };
}

async function get_account_balance(params, userId) {
  const raw = params.account_id;
  const rawStr =
    raw &&
    typeof raw === 'string' &&
    !/^(optional|omit|n\/a|none|unknown)$/i.test(String(raw).trim())
      ? raw
      : undefined;

  // Always load the user's accounts so we can resolve type-name IDs like 'checking'/'savings'
  // (the UI may submit these when liveAccounts hasn't loaded yet — resolveAccountId handles it).
  const accounts = await ensureAccounts(userId);
  const account_id = rawStr ? resolveAccountId(rawStr, accounts) : null;

  let account = null;
  if (account_id) {
    account = dataStore.getAccountById(account_id);
    if (!account) return { error: `Account ${account_id} not found` };
    if (account.userId !== userId) return { error: 'Access denied — not your account' };
  } else {
    account = accounts.find((a) => String(a.accountType || '').toLowerCase() === 'checking') || accounts[0];
    if (!account) return { error: 'No accounts found for this user' };
  }

  return {
    account_id: account.id,
    account_number: account.accountNumber,
    account_type: account.accountType,
    balance: account.balance,
    currency: account.currency,
  };
}

async function get_my_transactions(params, userId) {
  const limit = parseInt(params.limit, 10) || 50;
  const startDate = params.startDate ? new Date(params.startDate) : null;
  const endDate = params.endDate ? new Date(params.endDate) : null;
  const minAmount = params.minAmount ? parseFloat(params.minAmount) : null;
  const maxAmount = params.maxAmount ? parseFloat(params.maxAmount) : null;

  let allTxns = dataStore.getTransactionsByUserId(userId);

  // Filter by date range if provided
  if (startDate || endDate) {
    allTxns = allTxns.filter(txn => {
      const txnDate = new Date(txn.date);
      if (startDate && txnDate < startDate) return false;
      if (endDate && txnDate > endDate) return false;
      return true;
    });
  }

  // Filter by amount range if provided
  if (minAmount !== null || maxAmount !== null) {
    allTxns = allTxns.filter(txn => {
      const amount = Math.abs(parseFloat(txn.amount) || 0);
      if (minAmount !== null && amount < minAmount) return false;
      if (maxAmount !== null && amount > maxAmount) return false;
      return true;
    });
  }

  // Sort by date (most recent first) and limit
  const sorted = allTxns.sort((a, b) => new Date(b.date) - new Date(a.date));
  const limited = sorted.slice(0, limit);

  const enriched = limited.map(txn => {
    const accountId = txn.fromAccountId || txn.toAccountId;
    const account = accountId ? dataStore.getAccountById(accountId) : null;
    return {
      ...txn,
      accountInfo: account ? `${account.accountType} - ${account.accountNumber}` : 'Unknown',
    };
  });

  return { transactions: enriched, count: enriched.length };
}

async function create_deposit(params, userId) {
  const { amount, description } = params;

  const parsedAmount = parseFloat(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    return { error: 'amount must be a positive number' };
  if (parsedAmount > 1_000_000)
    return { error: 'amount cannot exceed $1,000,000' };

  const rounded = roundToCents(parsedAmount);
  if (hitlBlocksLocalWrite(userId, rounded, 'deposit')) {
    return {
      error: 'hitl_required',
      hitl: { type: 'consent' },
      message: HITL_LOCAL_AGENT_MESSAGE,
      hitl_threshold_usd: txConsent.HIGH_VALUE_CONSENT_USD,
    };
  }

  const accounts = await ensureAccounts(userId);
  const account_id = resolveAccountId(params.account_id || params.to_account_id, accounts);

  let account = null;
  if (account_id) {
    account = dataStore.getAccountById(account_id);
    if (!account) return { error: `Account "${account_id}" not found` };
    if (account.userId !== userId) return { error: 'Access denied — not your account' };
  } else {
    account = accounts.find((a) => String(a.accountType || '').toLowerCase() === 'checking') || accounts[0];
    if (!account) return { error: 'No accounts found for this user' };
  }
  const targetAccountId = account.id;

  await dataStore.updateAccountBalance(targetAccountId, rounded);

  const txn = await dataStore.createTransaction({
    toAccountId: targetAccountId,
    fromAccountId: null,
    userId,
    amount: rounded,
    type: 'deposit',
    description: description || 'Agent deposit',
    clientType: 'ai_agent',
    status: 'completed',
    createdAt: new Date(),
  });

  const updated = dataStore.getAccountById(targetAccountId);
  return {
    success: true,
    transaction_id: txn.id,
    amount: rounded,
    new_balance: updated?.balance,
    account_number: account.accountNumber,
  };
}

async function create_withdrawal(params, userId, req) {
  const { amount, description } = params;

  const parsedAmount = parseFloat(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    return { error: 'amount must be a positive number' };
  if (parsedAmount > 1_000_000)
    return { error: 'amount cannot exceed $1,000,000' };

  const rounded = roundToCents(parsedAmount);
  if (hitlBlocksLocalWrite(userId, rounded, 'withdrawal')) {
    return {
      error: 'hitl_required',
      hitl: { type: 'consent' },
      message: HITL_LOCAL_AGENT_MESSAGE,
      hitl_threshold_usd: txConsent.HIGH_VALUE_CONSENT_USD,
    };
  }

  const accounts = await ensureAccounts(userId);
  const account_id = resolveAccountId(params.account_id || params.from_account_id, accounts);

  let account = null;
  if (account_id) {
    account = dataStore.getAccountById(account_id);
    if (!account) return { error: `Account "${account_id}" not found` };
    if (account.userId !== userId) return { error: 'Access denied — not your account' };
  } else {
    account = accounts.find((a) => String(a.accountType || '').toLowerCase() === 'checking') || accounts[0];
    if (!account) return { error: 'No accounts found for this user' };
  }
  const targetAccountId = account.id;

  if (account.balance < rounded)
    return { error: `Insufficient balance (current: $${account.balance.toFixed(2)}, requested: $${rounded.toFixed(2)})` };

  const withdrawalStepUp = checkLocalStepUp('withdrawal', rounded, req);
  if (withdrawalStepUp) return withdrawalStepUp;

  await dataStore.updateAccountBalance(targetAccountId, -rounded);

  const txn = await dataStore.createTransaction({
    fromAccountId: targetAccountId,
    toAccountId: null,
    userId,
    amount: rounded,
    type: 'withdrawal',
    description: description || 'Agent withdrawal',
    clientType: 'ai_agent',
    status: 'completed',
    createdAt: new Date(),
  });

  const updated = dataStore.getAccountById(targetAccountId);
  return {
    success: true,
    transaction_id: txn.id,
    amount: rounded,
    new_balance: updated?.balance,
    account_number: account.accountNumber,
  };
}

async function create_transfer(params, userId, req) {
  const { amount, description } = params;

  const parsedAmount = parseFloat(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    return { error: 'amount must be a positive number' };
  if (parsedAmount > 1_000_000)
    return { error: 'amount cannot exceed $1,000,000' };

  const rounded = roundToCents(parsedAmount);
  if (hitlBlocksLocalWrite(userId, rounded, 'transfer')) {
    return {
      error: 'hitl_required',
      hitl: { type: 'consent' },
      message: HITL_LOCAL_AGENT_MESSAGE,
      hitl_threshold_usd: txConsent.HIGH_VALUE_CONSENT_USD,
    };
  }

  const accounts = await ensureAccounts(userId);
  const from_account_id = resolveAccountId(params.from_account_id || params.fromId, accounts);
  const to_account_id   = resolveAccountId(params.to_account_id   || params.toId,   accounts);
  if (!from_account_id || !to_account_id)
    return { error: 'Please specify which accounts to transfer between (e.g. "from checking to savings").' };

  const fromAccount = dataStore.getAccountById(from_account_id);
  const toAccount   = dataStore.getAccountById(to_account_id);
  if (!fromAccount) return { error: `Source account ${from_account_id} not found` };
  if (!toAccount)   return { error: `Destination account ${to_account_id} not found` };
  if (fromAccount.userId !== userId) return { error: 'Access denied — source account is not yours' };
  if (toAccount.userId !== userId)   return { error: 'Access denied — destination account is not yours' };

  if (fromAccount.balance < rounded)
    return { error: `Insufficient balance (current: $${fromAccount.balance.toFixed(2)}, requested: $${rounded.toFixed(2)})` };

  const transferStepUp = checkLocalStepUp('transfer', rounded, req);
  if (transferStepUp) return transferStepUp;

  await dataStore.updateAccountBalance(from_account_id, -rounded);
  await dataStore.updateAccountBalance(to_account_id,   rounded);

  const txn = await dataStore.createTransaction({
    fromAccountId: from_account_id,
    toAccountId: to_account_id,
    userId,
    amount: rounded,
    type: 'transfer',
    description: description || 'Agent transfer',
    clientType: 'ai_agent',
    status: 'completed',
    createdAt: new Date(),
  });

  const updatedFrom = dataStore.getAccountById(from_account_id);
  const updatedTo   = dataStore.getAccountById(to_account_id);
  return {
    success: true,
    transaction_id: txn.id,
    amount: rounded,
    from_new_balance: updatedFrom?.balance,
    to_new_balance: updatedTo?.balance,
  };
}

// ─── inspector catalog (mirrors banking_mcp_server BankingToolRegistry user tools) ─

/** Tool definitions for MCP Inspector when WebSocket/MCP is unavailable or session has no MCP bearer. */
const LOCAL_INSPECTOR_TOOLS = [
  {
    name: 'get_my_accounts',
    description: "Retrieve user's bank accounts",
    requiresUserAuth: true,
    requiredScopes: ['accounts:read'],
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_account_balance',
    description:
      'Get balance for a specific account. Use account ID (not account number) from get_my_accounts response.',
    requiresUserAuth: true,
    requiredScopes: ['accounts:read'],
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description:
            'Account ID (UUID format, not account number) - use the "id" field from get_my_accounts response',
          minLength: 1,
        },
      },
      required: ['account_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_my_transactions',
    description: "Retrieve user's transaction history with optional filtering by date range and amount",
    requiresUserAuth: true,
    requiredScopes: ['transactions:read'],
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'ISO 8601 start date (YYYY-MM-DD). Returns transactions on or after this date.',
        },
        endDate: {
          type: 'string',
          description: 'ISO 8601 end date (YYYY-MM-DD). Returns transactions on or before this date.',
        },
        minAmount: {
          type: 'number',
          description: 'Minimum transaction amount (absolute value). Returns transactions >= this amount.',
        },
        maxAmount: {
          type: 'number',
          description: 'Maximum transaction amount (absolute value). Returns transactions <= this amount.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return. Default: 50. Max: 100.',
          minimum: 1,
          maximum: 100,
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'create_deposit',
    description:
      'Create a deposit transaction to an account. Use account ID (not account number) from get_my_accounts response. High-value amounts may require HITL consent (configurable threshold, not available via this tool); high-value amounts may also require MFA.',
    requiresUserAuth: true,
    requiredScopes: ['transactions:write'],
    inputSchema: {
      type: 'object',
      properties: {
        to_account_id: {
          type: 'string',
          description:
            'Account ID (UUID format, not account number) to deposit to - use the "id" field from get_my_accounts response',
          minLength: 1,
        },
        amount: { type: 'number', description: 'Amount to deposit', minimum: 0.01, multipleOf: 0.01 },
        description: { type: 'string', description: 'Transaction description', maxLength: 255 },
      },
      required: ['to_account_id', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_withdrawal',
    description:
      'Create a withdrawal transaction from an account. Use account ID (not account number) from get_my_accounts response. High-value amounts require human consent (HITL) on the web dashboard (not available via this tool).',
    requiresUserAuth: true,
    requiredScopes: ['transactions:write'],
    inputSchema: {
      type: 'object',
      properties: {
        from_account_id: {
          type: 'string',
          description:
            'Account ID (UUID format, not account number) to withdraw from - use the "id" field from get_my_accounts response',
          minLength: 1,
        },
        amount: { type: 'number', description: 'Amount to withdraw', minimum: 0.01, multipleOf: 0.01 },
        description: { type: 'string', description: 'Transaction description', maxLength: 255 },
      },
      required: ['from_account_id', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_transfer',
    description:
      'Transfer money between accounts. Use account IDs (not account numbers) from get_my_accounts response. All transfers require human consent (HITL) on the web dashboard (not available via this tool).',
    requiresUserAuth: true,
    requiredScopes: ['transactions:write'],
    inputSchema: {
      type: 'object',
      properties: {
        from_account_id: {
          type: 'string',
          description:
            'Source account ID (UUID format, not account number) - use the "id" field from get_my_accounts response',
          minLength: 1,
        },
        to_account_id: {
          type: 'string',
          description:
            'Destination account ID (UUID format, not account number) - use the "id" field from get_my_accounts response',
          minLength: 1,
        },
        amount: { type: 'number', description: 'Amount to transfer (minimum $0.01)', minimum: 0.01, multipleOf: 0.01 },
        description: { type: 'string', description: 'Transfer description', maxLength: 255 },
      },
      required: ['from_account_id', 'to_account_id', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_sensitive_account_details',
    description: 'Retrieve sensitive account details (full account number and routing number). Requires sensitive:read scope and user consent.',
    requiresUserAuth: true,
    requiredScopes: ['accounts:read', 'sensitive:read'],
    readOnly: false,
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

/**
 * Returns MCP-shaped tool descriptors for the in-process fallback (same names as TOOL_MAP).
 * @returns {typeof LOCAL_INSPECTOR_TOOLS}
 */
function listLocalInspectorTools() {
  return LOCAL_INSPECTOR_TOOLS.map((t) => ({ ...t }));
}

// ─── dispatch ─────────────────────────────────────────────────────────────────


/**
 * Local implementation of sequential_think — pure reasoning, no auth or DB needed.
 * Mirrors the BankingToolProvider.executeSequentialThink output shape.
 */
async function sequential_think({ query, context } = {}) {
  if (!query) return JSON.stringify({ error: 'query is required' });
  const q = String(query).trim();
  const steps = [
    { title: 'Understand the question', description: `Parsing: "${q}"` },
    { title: 'Identify relevant context', description: context ? `Context provided: ${String(context).slice(0, 120)}` : 'No additional context supplied.' },
    { title: 'Apply banking domain knowledge', description: 'Considering applicable accounts, balances, and transaction flows.' },
    { title: 'Formulate response', description: 'Drawing a structured conclusion based on the above steps.' },
  ];
  const conclusion = `Sequential reasoning complete for: "${q}". (Running in local mode — MCP gateway unreachable or not configured.)`;
  return JSON.stringify({ steps, conclusion });
}

const TOOL_MAP = {
  get_my_accounts,
  get_account_balance,
  get_my_transactions,
  create_deposit,
  create_withdrawal,
  create_transfer,
  get_sensitive_account_details,
  sequential_think,
  // Legacy aliases
  list_accounts:     get_my_accounts,
  list_transactions: get_my_transactions,
  deposit:           create_deposit,
  withdraw:          create_withdrawal,
  transfer:          create_transfer,
};

/**
 * Execute a banking tool locally (no MCP server required).
 *
 * @param {string} tool     - MCP tool name
 * @param {object} params   - Tool parameters
 * @param {string} userId   - Authenticated user's ID (from session)
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>}
 */
async function callToolLocal(tool, params, userId, req) {
  const handler = TOOL_MAP[tool];
  const t0 = Date.now();
  const corrId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  writeMcpTrafficEntry({
    dir: 'BFF→MCP', type: 'rpc_request', method: 'tools/call', tool,
    ok: true, correlationId: corrId,
    summary: `tools/call → ${tool}`,
    payload: { jsonrpc: '2.0', method: 'tools/call', params: { name: tool, arguments: params || {} } },
  });

  if (!handler) {
    const errMsg = `Unknown tool "${tool}"`;
    writeMcpTrafficEntry({
      dir: 'MCP→BFF', type: 'rpc_response', method: 'tools/call', tool,
      ok: false, durationMs: Date.now() - t0, correlationId: corrId,
      summary: `tools/call ← ERROR: ${errMsg}`,
      payload: { error: { code: -32601, message: errMsg } },
    });
    return { error: `${errMsg}. Available: ${Object.keys(TOOL_MAP).filter(k => !['list_accounts','list_transactions','deposit','withdraw','transfer'].includes(k)).join(', ')}` };
  }

  try {
    const result = await handler(params || {}, userId, req);
    writeMcpTrafficEntry({
      dir: 'MCP→BFF', type: 'rpc_response', method: 'tools/call', tool,
      ok: !result?.error, durationMs: Date.now() - t0, correlationId: corrId,
      summary: `tools/call ← ${tool} ${result?.error ? 'ERROR' : 'OK'} (${Date.now() - t0}ms)`,
      payload: result,
    });
    return result;
  } catch (err) {
    writeMcpTrafficEntry({
      dir: 'MCP→BFF', type: 'error', method: 'tools/call', tool,
      ok: false, durationMs: Date.now() - t0, correlationId: corrId,
      summary: `tools/call ← THROW: ${err.message}`,
      payload: { error: err.message },
    });
    throw err;
  }
}


async function get_sensitive_account_details(params, userId, req) {
  // HITL-granted session consent (set by POST /api/accounts/sensitive-consent) takes highest priority.
  const consent = req?.session?.sensitiveReadConsent;
  if (consent && consent.expiresAt > Date.now()) {
    if (req.session) delete req.session.sensitiveReadConsent; // consume — single-use
    // fall through to data access
  } else if (req?.session?.stepUpVerified > Date.now()) {
    // Session step-up token (OTP / CIBA completion) takes priority over ACR claim.
    req.session.stepUpVerified = 0; // consume — single-use
    // fall through to data access
  } else {
    const STEP_UP_ACR = runtimeSettings.get('stepUpAcrValue') || 'Multi_Factor';
    const userAcr = String(req?.user?.acr || req?.user?.['pingone:acr'] || '');
    const hasElevatedAcr = userAcr === STEP_UP_ACR || userAcr.split(' ').includes(STEP_UP_ACR);

    if (!hasElevatedAcr) {
      // No session consent and no elevated ACR — require HITL consent before revealing sensitive data.
      // This mirrors the HITL rule for high-value transactions: human approval IS the authorization.
      return {
        ok: false,
        error: 'hitl_required',
        hitl: { type: 'consent' },
        hitl_threshold_usd: 0,
      };
    }
  }

  // ACR elevated — return sensitive account data + user profile info
  const user = dataStore.getUserById(userId);
  const accounts = dataStore.getAccountsByUserId(userId);
  if (!accounts || accounts.length === 0) {
    return { ok: false, error: 'No accounts found for this user.' };
  }
  
  // Include user profile information for "full account details" context
  return {
    ok: true,
    user: user ? {
      username: user.username,
      email: user.email,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      fullName: `${(user.firstName || '')} ${(user.lastName || '')}`.trim() || user.username,
      role: user.role,
      accountCreatedAt: user.createdAt,
    } : null,
    accounts: accounts.map(a => ({
      id: a.id,
      accountType: a.accountType,
      name: a.name,
      accountNumber: a.accountNumber,
      accountNumberFull: a.accountNumberFull || null,
      routingNumber: a.routingNumber || null,
      swiftCode: a.swiftCode || null,
      iban: a.iban || null,
      balance: a.balance || 0,
      currency: a.currency || 'USD',
      status: a.status || 'active',
    })),
  };
}

module.exports = { callToolLocal, listLocalInspectorTools, get_sensitive_account_details,
};
