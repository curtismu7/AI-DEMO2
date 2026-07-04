'use strict';

/**
 * Tool → MCP server routing table.
 *
 * Each entry maps a tool name to the backend that owns it. The gateway
 * uses this to select which MCP server to forward to and which audience
 * to request in the RFC 8693 re-exchange.
 *
 * Phase 266 adds three new targets as siblings to the existing 'olb'/'invest':
 *   'apikey'     — Gateway-only marker (Path A); no backend call
 *   'dualtoken'  — Forwards to banking_resource_server /identity (Path B)
 *   'bankingdata' — Forwards to banking_resource_server /accounts or /transactions (Path C)
 *
 * W1: Existing 'olb' and 'invest' targets are UNCHANGED. The existing OLB tool names
 * (get_my_accounts, etc.) continue to route via WebSocket. Phase 266 adds NEW demo
 * tool names (demo_show_accounts, demo_show_transactions) for the HTTP path.
 */

import { GatewayConfig } from './config';

// W1 fix: KEEP existing 'olb' and 'invest' targets unchanged.
// ADD new sibling targets for Phase 266.
export type BackendTarget = 'olb' | 'invest' | 'apikey' | 'dualtoken' | 'bankingdata';

const OLB_TOOLS = new Set([
  'get_my_accounts',
  'get_account_balance',
  'get_sensitive_account_details',
  'get_my_transactions',
  'create_deposit',
  'create_withdrawal',
  'create_transfer',
  'query_user_by_email',
  'sequential_think',
]);

const INVEST_TOOLS = new Set([
  'get_investment_balance',
  'get_investment_accounts',
  'get_investment_transactions',
  'get_portfolio_summary',
]);

// Path A: api_key disposition.
//   Phase 266 shipped this target as a Gateway-only marker (no backend call).
//   Phase 267 makes `show_mortgage` the first apikey tool that actually
//   dispatches to a backend (banking_mortgage_service) via X-API-Key.
//   Other apikey tools (if re-added) keep the Gateway-only marker behavior —
//   the split is decided by backendHttpUrl() returning non-empty, not here.
const APIKEY_TOOLS = new Set([
  'show_mortgage',       // banking — home loan (Phase 267)
  'show_investment',     // banking — investment portfolio (api-key demo, Phase 2)
  'show_large_purchase', // retail — Great Buy large purchase
  'show_health_record',  // healthcare — CareConnect health record
  'show_gear_order',     // sporting-goods — Super Sports gear order
  'show_expense_report', // workforce — WX Workforce expense report
  'show_permit',         // government — CivicPermit permit record
  'show_enrollment',     // university — Super University enrollment record
  'show_work_order',     // manufacturing — Precision Works work order
]);

// Phase 266 Path B: Dual-token forward to /api/resource-server/identity
const DUALTOKEN_TOOLS = new Set(['user_profile_card']);

// Phase 266 Path C: New demo tool names that route to banking_resource_server via HTTP.
// These are SEPARATE from OLB tools — they exercise the new SQLite-backed HTTP routes.
// The existing OLB tool names (get_my_accounts, etc.) continue to use WebSocket unaffected.
const BANKINGDATA_TOOLS = new Set(['demo_show_accounts', 'demo_show_transactions']);

// Maps Phase 266 banking-data tool names to their backend route segment.
// Only consulted when routeTool() returns 'bankingdata'.
const BANKING_DATA_ROUTE_FOR_TOOL: Record<string, 'accounts' | 'transactions'> = {
  demo_show_accounts:     'accounts',
  demo_show_transactions: 'transactions',
};

export function routeTool(toolName: string): BackendTarget {
  if (INVEST_TOOLS.has(toolName))      return 'invest';
  if (APIKEY_TOOLS.has(toolName))      return 'apikey';
  if (DUALTOKEN_TOOLS.has(toolName))   return 'dualtoken';
  if (BANKINGDATA_TOOLS.has(toolName)) return 'bankingdata';
  // Default — existing OLB tools (get_my_accounts, etc.) and unknown tools → OLB WebSocket
  return 'olb';
}

// H4: Return empty string for Phase 266 targets — they do NOT use WebSocket.
// Without this guard, 'apikey'/'dualtoken'/'bankingdata' would silently fall
// through to mcpOlbWsUrl (wrong backend).
export function backendWsUrl(target: BackendTarget, config: GatewayConfig): string {
  if (target === 'apikey' || target === 'dualtoken' || target === 'bankingdata') return '';
  return target === 'invest' ? config.mcpInvestWsUrl : config.mcpOlbWsUrl;
}

// H4: Return empty string for Phase 266 targets — they use bankingResourceServerResourceUri,
// not mcpOlbResourceUri / mcpInvestResourceUri.
export function backendResourceUri(target: BackendTarget, config: GatewayConfig): string {
  if (target === 'apikey' || target === 'dualtoken' || target === 'bankingdata') return '';
  return target === 'invest' ? config.mcpInvestResourceUri : config.mcpOlbResourceUri;
}

// Resolve the concrete HTTP URL for a given (target, toolName).
// Returns empty string for targets that use WebSocket ('olb', 'invest') or are
// Gateway-terminating ('apikey').
/** Maps api_key-disposition tool names to their route segment on the data service backend. */
export const APIKEY_BACKEND_ROUTES: Record<string, string> = {
  show_mortgage:       'mortgage',
  show_investment:     'invest',
  show_large_purchase: 'retail',
  show_health_record:  'healthcare',
  show_gear_order:     'gear',
  show_expense_report: 'expense',
  show_permit:         'permit',
  show_enrollment:     'enrollment',
  show_work_order:     'workOrder',
};

export function backendHttpUrl(target: BackendTarget, toolName: string, config: GatewayConfig): string {
  if (target === 'apikey') {
    const route = APIKEY_BACKEND_ROUTES[toolName];
    return route ? `${config.mortgageServiceBaseUrl}/${route}` : '';
  }
  if (target === 'olb' || target === 'invest') return '';
  if (target === 'dualtoken') {
    return `${config.bankingResourceServerBaseUrl}/api/resource-server/identity`;
  }
  if (target === 'bankingdata') {
    const sub = BANKING_DATA_ROUTE_FOR_TOOL[toolName] || 'accounts';
    return `${config.bankingResourceServerBaseUrl}/api/resource-server/${sub}`;
  }
  return '';
}
