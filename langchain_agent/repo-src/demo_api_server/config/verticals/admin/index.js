'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');

// Admin vertical heuristics — enabled when the admin vertical is active.
// action: the native MCP tool name (must match a declared tool below — the
// plugin contract cross-checks every heuristic action against getTools()).
// Most-specific patterns FIRST: the first matching regex wins.
const HEURISTICS = [
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
  { re: /\b(view|show|get)\s+(?:(?:customer|user|their?|the|a)\s+)?profile\b|\b(customer|user).*profile\b|\bprofile\s*(information|details)\b|\baccount\s+details\b/, action: 'get_customer_profile' },
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

module.exports = {
  getManifest,
  getTools: () => TOOLS,
  getHeuristics: () => HEURISTICS,
  getSystemPrompt,
  getDataStore: () => ({ get: () => ({}) }), // Admin tools execute via the MCP gateway, not a local store
  // Admin tools are dispatched through the MCP gateway (gateway → MCP server / BFF
  // admin routes), not a local handler; this stub satisfies the plugin contract.
  executeTool: async (name) => ({
    result: { data: { message: `Admin action "${name}" executes via the MCP gateway` } },
    render: 'card',
  }),
  getAuthz,
};
