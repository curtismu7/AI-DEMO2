'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');
const store = require('../../../data/store');
// Identity-verification (KYC) records — deliberately NOT in data/store.js.
// get_customer_profile reads the store's user row, so it physically cannot reach
// this file; the two tools return different data classes, not the same data under
// two names. See identity-records.json's own note.
const { records: IDENTITY_RECORDS } = require('./identity-records.json');

// Admin vertical heuristics — enabled when the admin vertical is active.
// action: the native MCP tool name (must match a declared tool below — the
// plugin contract cross-checks every heuristic action against getTools()).
// Most-specific patterns FIRST: the first matching regex wins.
const HEURISTICS = [
  // Identity-verification / KYC record — the A2A-delegated sensitive read. FIRST
  // so no later profile/account pattern can claim the phrase.
  { re: /\b(identity|kyc)\b.{0,20}\b(record|verification|file|check)\b|\b(verification|kyc)\s+record\b/i, action: 'sensitive_customer_identity' },
  // "look up" (two words), "lookup", "search", "find" + customer/user/account; "who is"
  { re: /\blook\s+up\b.*\b(customer|user|account)\b|\b(lookup|search|find)\s+(customer|user|account)\b|\bfind\s+user\b|\bwho\s*(is|are)\b/, action: 'lookup_customer' },
  // delete/remove a customer/user — destructive, must precede the generic profile/account patterns
  { re: /\b(delete|remove|purge)\b.{0,20}\b(customer|user|account)\b/, action: 'delete_customer' },
  // freeze/suspend/lock with optional filler words ("suspend the user", "freeze the account")
  { re: /\b(freeze|lock|disable|unfreeze|unlock|enable|suspend)\b.{0,20}\b(account|customer|user)\b/, action: 'freeze_account' },
  // adjust/change a balance
  { re: /\badjust\s+(balance|account)\b|\bchange\s+balance\b/, action: 'adjust_balance' },
  // reset/force a password reset
  { re: /\b(reset|change|force)\s*(a\s+)?(password|pwd)\b|\bforce.*password.*reset\b/, action: 'reset_customer_password' },
  // transactions for a customer — must precede the generic profile/account patterns
  { re: /\b(transactions?|payment\s+history|recent\s+activity)\b/, action: 'get_customer_transactions' },
  // accounts for a customer
  { re: /\b(view|show|get|list)\s+(?:(?:customer|user|their?|the|a)\s+)?accounts?\b|\baccounts?\s+for\b/, action: 'get_customer_accounts' },
  // profile / account details (generic — keep last)
  { re: /\b(view|show|get)\s+(?:\w+\s+){0,3}profile\b|\b(customer|user).*profile\b|\bprofile\s*(information|details)\b|\baccount\s+details\b/, action: 'get_customer_profile' },
];

// The admin vertical's MCP tools. The agent sees ONLY these on the admin
// dashboard (clean vertical isolation). scopes mirror scope-topology.json
// (the SoT — resolveAgentScopes reads requiredScopes from there, not here).
// Execution is delegated to the MCP gateway / BFF admin routes.
const TOOLS = [
  {
    name: 'lookup_customer',
    description: 'Search for customers by name, email, or username.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search term (name, email, or username)' } }, required: ['query'] },
    scopes: ['admin:read', 'users:read'],
    authz: {},
  },
  {
    name: 'get_customer_transactions',
    description: 'Retrieve recent transactions for a customer.',
    inputSchema: { type: 'object', properties: { userId: { type: 'string', description: 'PingOne user ID' } }, required: ['userId'] },
    scopes: ['admin:read', 'users:read'],
    authz: {},
  },
  {
    name: 'get_customer_profile',
    description: 'Retrieve detailed profile information for a customer.',
    inputSchema: { type: 'object', properties: { userId: { type: 'string', description: 'PingOne user ID' } }, required: ['userId'] },
    scopes: ['admin:read', 'users:read'],
    authz: {},
  },
  {
    name: 'get_customer_accounts',
    description: 'List all accounts for a customer.',
    inputSchema: { type: 'object', properties: { userId: { type: 'string', description: 'PingOne user ID' } }, required: ['userId'] },
    scopes: ['admin:read', 'users:read'],
    authz: {},
  },
  {
    // A2A-delegated sensitive read. Coarse `read` here; the scope actually
    // demanded of the specialist's Exchange #2 bearer is scope-topology's
    // a2aDelegatedScope (identity:read), which no ordinary admin session token
    // carries. Marked a2aDelegated in scope-topology, so a caller whose act chain
    // has no specialist is DENIED before this ever runs.
    name: 'sensitive_customer_identity',
    description: 'Retrieve the customer\'s identity-verification (KYC) record — government ID, date of birth, residential address, screening outcome, risk rating and last compliance review. Delegated to the Identity Verification Specialist agent; requires explicit consent.',
    inputSchema: { type: 'object', properties: { userId: { type: 'string', description: 'PingOne user ID' } }, required: [] },
    scopes: ['read'],
    authz: { consent: true },
  },
  {
    name: 'freeze_account',
    description: 'Freeze or unfreeze a customer account.',
    inputSchema: { type: 'object', properties: { userId: { type: 'string', description: 'PingOne user ID' }, freeze: { type: 'boolean', description: 'true to freeze, false to unfreeze' } }, required: ['userId', 'freeze'] },
    scopes: ['admin:write', 'users:manage'],
    authz: { consent: true },
  },
  {
    name: 'adjust_balance',
    description: 'Adjust the balance on a customer account.',
    inputSchema: { type: 'object', properties: { accountId: { type: 'string', description: 'Account ID' }, amount: { type: 'number', description: 'Signed adjustment amount' } }, required: ['accountId', 'amount'] },
    scopes: ['admin:write', 'users:manage'],
    authz: { consent: true },
  },
  {
    name: 'reset_customer_password',
    description: 'Force a customer to reset their password on next login.',
    inputSchema: { type: 'object', properties: { userId: { type: 'string', description: 'PingOne user ID' } }, required: ['userId'] },
    scopes: ['admin:write', 'users:manage'],
    authz: { consent: true },
  },
  {
    name: 'delete_customer',
    description: 'Permanently delete a customer and all associated data.',
    inputSchema: { type: 'object', properties: { userId: { type: 'string', description: 'PingOne user ID' } }, required: ['userId'] },
    scopes: ['admin:write', 'admin:delete', 'users:manage'],
    authz: { consent: true },
  },
];

function getManifest() {
  return verticalManifest.resolver.resolve('admin');
}

function getSystemPrompt() {
  return [
    'You are an administrative assistant with elevated privileges.',
    'You can look up customers, inspect their accounts and transactions, freeze/unfreeze accounts,',
    'adjust balances, reset passwords, and delete customers.',
    'A customer\'s identity-verification (KYC) record is reached with sensitive_customer_identity, which is delegated to a specialist agent.',
    'The signed-in user is an administrator.',
    'Always confirm destructive actions (freeze, adjust balance, password reset, delete) before executing them.',
    'Only emit one of the allowed admin actions; never reference end-user banking concepts.',
  ].join(' ');
}

function getAuthz() {
  const out = {};
  for (const t of TOOLS) out[t.name] = t.authz || {};
  return out;
}

/**
 * The Customer Admin picker's selected customer id, as the SPA resends it on
 * every admin chat turn (see applyAdminCustomerContext in
 * demoAgentLangGraphService.js). Returns null when nothing is selected.
 */
function adminSelectedCustomerId(ctx) {
  const customer = ctx && ctx.req && ctx.req.body && ctx.req.body.customer;
  const id = customer && typeof customer === 'object' ? customer.id : null;
  return id == null ? null : String(id);
}

// Real handlers over the same demo store the deterministic Customer Admin
// panel uses (routes/adminAgentTools.js) — same data, same shapes, so the
// heuristic chips and the panel's buttons agree. userId/accountId are filled
// from the dashboard's picker-selected customer upstream (see
// applyAdminCustomerContext in demoAgentLangGraphService.js) when the
// resolved tool declares that param and the message didn't supply one.
async function execute(name, params, ctx) {
  const p = params || {};
  switch (name) {
    case 'sensitive_customer_identity': {
      // The A2A fast-path dispatches with no params (dispatchVerticalIntent routes
      // to executeA2aDelegation BEFORE applyAdminCustomerContext runs), so read the
      // dashboard's picker-selected customer from the request the same way that
      // helper does. Same contract as every other admin tool: no customer, no read.
      const targetId = p.userId != null ? String(p.userId) : adminSelectedCustomerId(ctx);
      if (!targetId) return { result: { error: 'no customer selected' }, render: 'text' };
      const user = store.getUserById(targetId);
      if (!user) return { result: { error: 'customer not found' }, render: 'text' };
      const record = IDENTITY_RECORDS[targetId];
      // No record is reported as no record. Falling back to another customer's row
      // would hand the admin real PII for the wrong person.
      if (!record) {
        return {
          result: { userId: targetId, found: false, note: `No identity-verification record on file for customer ${targetId}.` },
          render: 'text',
        };
      }
      return {
        result: {
          userId: targetId,
          found: true,
          sensitivity: 'pii',
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          ...record,
          sensitiveDataAccessed: true,
          accessGrantedBy: 'a2a-delegation',
        },
        render: 'text',
      };
    }
    case 'lookup_customer': {
      const q = String(p.query || '').toLowerCase().trim();
      if (!q) return { result: { error: 'query is required' }, render: 'text' };
      const users = store.getAllUsers()
        .filter((u) => {
          const fullName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
          return fullName.includes(q) || (u.email || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q);
        })
        .map((u) => ({ id: u.id, username: u.username, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, isActive: u.isActive }));
      return { result: { users, count: users.length }, render: 'lookup_customer' };
    }
    case 'get_customer_profile': {
      const user = store.getUserById(p.userId);
      if (!user) return { result: { error: 'customer not found' }, render: 'text' };
      const { password, ...safeUser } = user;
      return { result: { user: safeUser }, render: 'get_customer_profile' };
    }
    case 'get_customer_accounts': {
      const accounts = store.getAccountsByUserId(p.userId) || [];
      return { result: { accounts, count: accounts.length }, render: 'get_customer_accounts' };
    }
    case 'get_customer_transactions': {
      const allTx = store.getTransactionsByUserId(p.userId) || [];
      const transactions = allTx.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
      return { result: { transactions, count: transactions.length }, render: 'get_customer_transactions' };
    }
    case 'freeze_account': {
      if (typeof p.freeze !== 'boolean') return { result: { error: 'freeze (true/false) is required' }, render: 'text' };
      const accounts = store.getAccountsByUserId(p.userId) || [];
      const account = accounts[0];
      if (!account) return { result: { error: 'customer has no account to freeze' }, render: 'text' };
      const updated = await store.updateAccount(account.id, { isActive: !p.freeze });
      return { result: { accountId: updated.id, isActive: updated.isActive, frozen: p.freeze }, render: 'freeze_account' };
    }
    case 'adjust_balance': {
      const amount = Number(p.amount);
      if (!isFinite(amount)) return { result: { error: 'amount must be a finite number' }, render: 'text' };
      const account = store.getAccountById(p.accountId);
      if (!account) return { result: { error: 'account not found' }, render: 'text' };
      const newBalance = (account.balance || 0) + amount;
      if (newBalance < 0) return { result: { error: 'adjustment would result in a negative balance' }, render: 'text' };
      const updated = await store.updateAccount(p.accountId, { balance: newBalance });
      await store.createTransaction({
        userId: account.userId,
        fromAccountId: amount < 0 ? account.id : null,
        toAccountId: amount >= 0 ? account.id : null,
        amount: Math.abs(amount),
        type: amount >= 0 ? 'deposit' : 'withdrawal',
        description: 'Admin balance adjustment',
        category: 'admin',
        status: 'completed',
      });
      return { result: { accountId: updated.id, newBalance: updated.balance }, render: 'adjust_balance' };
    }
    case 'reset_customer_password': {
      const user = store.getUserById(p.userId);
      if (!user) return { result: { error: 'customer not found' }, render: 'text' };
      await store.updateUser(p.userId, { passwordResetRequired: true });
      return { result: { userId: p.userId, passwordResetRequired: true }, render: 'reset_customer_password' };
    }
    case 'delete_customer': {
      const user = store.getUserById(p.userId);
      if (!user) return { result: { error: 'customer not found' }, render: 'text' };
      const accounts = store.getAccountsByUserId(p.userId) || [];
      for (const account of accounts) {
        const transactions = store.getTransactionsByAccountId(account.id) || [];
        for (const tx of transactions) await store.deleteTransaction(tx.id);
        await store.deleteAccount(account.id);
      }
      await store.deleteUser(p.userId);
      return { result: { userId: p.userId, deleted: true }, render: 'delete_customer' };
    }
    default:
      return { result: { error: `Unknown admin action "${name}"` }, render: 'text' };
  }
}

module.exports = {
  getManifest,
  getTools: () => TOOLS,
  getHeuristics: () => HEURISTICS,
  getSystemPrompt,
  getDataStore: () => ({ get: () => ({}) }), // Admin tools read/write the shared demo store directly, not a per-user local store
  executeTool: (name, params, ctx) => execute(name, params, ctx),
  getAuthz,
};
