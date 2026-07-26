'use strict';

/**
 * Admin Tools — customer-CRUD (banking, admin role) + PingOne platform ops
 * (worker client_credentials via the isolated admin agent). Deliberately NOT
 * part of the useCases.js trust-ladder catalog — same reasoning as
 * config/admin/demoSteps.js: no consent/HITL gate or tokenChain evidence
 * narrative to attach, just plain NL prompts. `adminAgent: true` marks the
 * 6 entries that must route through /api/admin-agent/message instead of the
 * normal MCP-tool chip pipeline.
 */
const ADMIN_TOOLS = [
  // --- Banking customer CRUD (8) — normal MCP-tool chips, no special routing ---
  { id: 'lookup_customer', title: 'Look Up Customer', trigger: { type: 'chip', text: 'look up a customer' } },
  { id: 'get_customer_transactions', title: 'View Transactions', trigger: { type: 'chip', text: 'show last 5 transactions for this customer' } },
  { id: 'get_customer_profile', title: 'View Profile', trigger: { type: 'chip', text: 'show full profile for this customer' } },
  { id: 'get_customer_accounts', title: 'View Accounts', trigger: { type: 'chip', text: 'show all accounts for this customer' } },
  { id: 'freeze_account', title: 'Freeze Account', trigger: { type: 'chip', text: 'freeze this account' } },
  { id: 'adjust_balance', title: 'Adjust Balance', trigger: { type: 'chip', text: 'adjust account balance' } },
  { id: 'reset_customer_password', title: 'Reset Password', trigger: { type: 'chip', text: 'reset password for this customer' } },
  { id: 'delete_customer', title: 'Delete Customer', trigger: { type: 'chip', text: 'delete this customer' } },
  // --- PingOne platform ops (6) — routed to the isolated admin agent ---
  { id: 'p1_list_apps', title: 'List all apps', trigger: { type: 'chip', text: 'List all applications in our PingOne environment' }, adminAgent: true },
  { id: 'p1_list_envs', title: 'List environments', trigger: { type: 'chip', text: 'Show all environments I have access to in PingOne' }, adminAgent: true },
  { id: 'p1_services_enabled', title: 'What services are enabled?', trigger: { type: 'chip', text: 'What services are enabled in our PingOne environment?' }, adminAgent: true },
  { id: 'p1_identity_count', title: 'Identity count this week', trigger: { type: 'chip', text: 'How many identities are in our PingOne environment?' }, adminAgent: true },
  { id: 'p1_ai_agent_config', title: 'Show Demo AI Agent config', trigger: { type: 'chip', text: 'Get the configuration for the Demo AI Agent application in PingOne' }, adminAgent: true },
  { id: 'p1_verify_apps', title: 'Verify all 8 demo apps', trigger: { type: 'chip', text: 'Confirm all 8 demo apps exist in PingOne: Demo Admin App, Demo User App, Demo MCP Server, Demo Worker, Demo MCP Exchanger, Demo MCP Gateway, Demo Agent, Demo AI Agent' }, adminAgent: true },
];

module.exports = { ADMIN_TOOLS };
