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
// 'jwtverifier' is a sibling HTTP-forward target (like 'olb'), not a WebSocket
// backend like 'invest' — see backendWsUrl()/backendHttpMcpUrl() below.
// 'weather'/'brave' mirror the Agent Gateway (IG) showcase routes
// (00-mcp-weather.json / 00-mcp-brave.json) — same HTTP-forward shape as
// 'jwtverifier', plus a scope-policy check (see scopePolicies.ts) run in
// GatewayServer.forwardToUpstream() before the call reaches the backend.
export type BackendTarget = 'olb' | 'invest' | 'apikey' | 'dualtoken' | 'bankingdata' | 'jwtverifier' | 'weather' | 'brave';

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

// Airlines vertical (United). Same physical backend and same audience as the
// invest tools — demo_mcp_resource_server — so they route to the 'invest'
// target. They differ in where the data comes from: these are answered from
// that server's own SQLite database rather than proxied back to the BFF.
// `sensitive_passenger_record` belongs here for the same reason as the other
// three — the resource server answers it from SQLite. It is NOT an OLB tool: if
// it fell through to the default 'olb' target it would be relayed to the BFF,
// whose airlines plugin disowns every non-stub name, and the A2A specialist
// would get "no handler for sensitive_passenger_record" after a fully valid
// nested-act exchange.
const AIRLINES_TOOLS = new Set([
  // Phase 2 amount-gated write. Routes to the same 'invest' target as the reads:
  // same physical backend, same audience. Omitting it here means the gate fires,
  // the policy decides, and then the call dies on 'Unknown tool'.
  'pay_airline_fee',
  'get_airline_bookings',
  // Phase 2 — consent-gated counterpart. Must route the same way as the plain
  // lookup, or the gate would fire and then the call would 'Unknown tool'.
  'sensitive_airline_bookings',
  'cancel_airline_reservation',
  'get_flight_status',
  'check_seat_availability',
  'sensitive_passenger_record',
]);

// Healthcare vertical (CareConnect) pilot for the Phase-1 SQLite migration.
// Same physical backend as invest/airlines — demo_mcp_resource_server — so it
// routes to the 'invest' target. Tool name matches the chip-facing manifest
// tool exactly (view_records); scope-topology.json's tools.view_records entry
// already requires only "read", already granted to every session, so no
// scope-topology change was needed to wire this. get_patient_record is
// deliberately NOT routed here — no chip in the vertical's manifest calls it.
const HEALTHCARE_TOOLS = new Set([
  'view_records',
]);

// Same pilot pattern as healthcare — government, manufacturing, university.
// get_permit/get_work_order/get_course deliberately NOT routed: no chip in
// any of the three manifests calls a single-record lookup.
const GOVERNMENT_TOOLS = new Set([
  'view_permits',
]);
const MANUFACTURING_TOOLS = new Set([
  'view_work_orders',
]);
const UNIVERSITY_TOOLS = new Set([
  'view_courses',
]);
// workforce and abercrombie-fitch: SAME-NAME shadow, not a rename — the SQLite
// (resp. mock-JSON) tool name already matches the chip-facing manifest tool.
// Without this entry it falls through to the default 'olb' target and the BFF's
// identically-named handler silently answers instead.
const WORKFORCE_TOOLS = new Set([
  'list_expenses',
]);
const ANF_TOOLS = new Set([
  'list_anf_orders',
]);
// retail: list_orders is a same-name shadow (SQLite tool already matched the
// chip name, just needed this entry). order_status is a rename from the
// SQLite server's get_order AND a shape adapter — the handler now returns
// the order flat with an optional orderId defaulting to the most recent
// order, matching the BFF's order_status exactly (retailToolHandler.ts).
// sporting-goods mirrors this identically (list_gear_orders->list_gear,
// get_gear_order->gear_order_status).
const RETAIL_TOOLS = new Set([
  'list_orders',
  'order_status',
]);
const SPORTING_GOODS_TOOLS = new Set([
  'list_gear',
  'gear_order_status',
]);

// demo_mcp_jwt_verifier (Python/FastMCP) — JWT/JWKS diagnostic tools, ported
// from jwt-verifier-mcp-server/src/actions/*.ts. Tool names must match exactly.
const JWT_VERIFIER_TOOLS = new Set([
  'jwt_decode_full',
  'jwt_verify_signature',
  'jwt_validate_claims',
  'jwt_fetch_jwks',
  'jwt_inspect_key',
]);

// weather-mcp showcase — mirrors ping-gateway's 00-mcp-weather.json. Same tool
// name the BFF (mcpGatewayClient.js WEATHER_TOOLS) calls on both gateways.
const WEATHER_TOOLS = new Set(['get_weather']);

// brave-mcp showcase — mirrors ping-gateway's 00-mcp-brave.json. Same tool
// name the BFF (mcpGatewayClient.js BRAVE_TOOLS) calls on both gateways.
const BRAVE_TOOLS = new Set(['brave_news_search']);

// Path A: api_key disposition.
//   Phase 266 shipped this target as a Gateway-only marker (no backend call).
//   Phase 267 makes `show_mortgage` the first apikey tool that actually
//   dispatches to a backend (banking_api_resource_server) via X-API-Key.
//   Other apikey tools (if re-added) keep the Gateway-only marker behavior —
//   the split is decided by backendHttpUrl() returning non-empty, not here.
const APIKEY_TOOLS = new Set([
  'show_mortgage',       // banking — home loan (Phase 267)
  'show_investment',     // banking — investment portfolio (api-key demo, Phase 2)
  'show_large_purchase', // retail — Great Buy large purchase
  'show_health_record',  // healthcare — CareConnect health record
  'show_gear_order',     // sporting-goods — Super Sports gear order
  'show_gear_warranty',  // sporting-goods — Super Sports gear warranty (UC33)
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
  if (INVEST_TOOLS.has(toolName))        return 'invest';
  if (AIRLINES_TOOLS.has(toolName))      return 'invest';
  if (HEALTHCARE_TOOLS.has(toolName))    return 'invest';
  if (GOVERNMENT_TOOLS.has(toolName))    return 'invest';
  if (MANUFACTURING_TOOLS.has(toolName)) return 'invest';
  if (UNIVERSITY_TOOLS.has(toolName))    return 'invest';
  if (WORKFORCE_TOOLS.has(toolName))     return 'invest';
  if (ANF_TOOLS.has(toolName))           return 'invest';
  if (RETAIL_TOOLS.has(toolName))        return 'invest';
  if (SPORTING_GOODS_TOOLS.has(toolName)) return 'invest';
  if (JWT_VERIFIER_TOOLS.has(toolName))  return 'jwtverifier';
  if (WEATHER_TOOLS.has(toolName))       return 'weather';
  if (BRAVE_TOOLS.has(toolName))         return 'brave';
  if (APIKEY_TOOLS.has(toolName))        return 'apikey';
  if (DUALTOKEN_TOOLS.has(toolName))     return 'dualtoken';
  if (BANKINGDATA_TOOLS.has(toolName))   return 'bankingdata';
  // Default — existing OLB tools (get_my_accounts, etc.) and unknown tools → OLB WebSocket
  return 'olb';
}

// H4: Return empty string for Phase 266 targets and 'jwtverifier' — none of
// them use WebSocket. Without this guard, they would silently fall through
// to mcpOlbWsUrl (wrong backend).
export function backendWsUrl(target: BackendTarget, config: GatewayConfig): string {
  if (target === 'apikey' || target === 'dualtoken' || target === 'bankingdata' || target === 'jwtverifier' || target === 'weather' || target === 'brave') return '';
  return target === 'invest' ? config.mcpResourceServerWsUrl : config.mcpOlbWsUrl;
}

// Resolve the concrete HTTP MCP base URL for a target that forwards via
// GatewayServer.forwardToUpstream() (Streamable HTTP), i.e. everything except
// 'invest' (WebSocket) and the Gateway-terminating/REST targets. Today that's
// 'jwtverifier', 'weather', and 'brave' — 'olb' keeps using GatewayServer's own
// upstreamMcpUrl.
export function backendHttpMcpUrl(target: BackendTarget, config: GatewayConfig): string {
  if (target === 'jwtverifier') return config.mcpJwtVerifierHttpUrl;
  if (target === 'weather') return config.mcpWeatherHttpUrl;
  if (target === 'brave') return config.mcpBraveHttpUrl;
  return '';
}

// H4: Return empty string for Phase 266 targets — they use bankingResourceServerResourceUri,
// not mcpOlbResourceUri / mcpResourceServerResourceUri / mcpJwtVerifierResourceUri.
export function backendResourceUri(target: BackendTarget, config: GatewayConfig): string {
  if (target === 'apikey' || target === 'dualtoken' || target === 'bankingdata') return '';
  if (target === 'jwtverifier') return config.mcpJwtVerifierResourceUri;
  return target === 'invest' ? config.mcpResourceServerResourceUri : config.mcpOlbResourceUri;
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
  show_gear_warranty:  'gearWarranty',
  show_expense_report: 'expense',
  show_permit:         'permit',
  show_enrollment:     'enrollment',
  show_work_order:     'workOrder',
};

export function backendHttpUrl(target: BackendTarget, toolName: string, config: GatewayConfig): string {
  if (target === 'apikey') {
    // show_investment routes to the invest service (dual-auth: same backend, API-key path)
    if (toolName === 'show_investment') {
      return `${config.mcpResourceServerHttpUrl}/invest`;
    }
    const route = APIKEY_BACKEND_ROUTES[toolName];
    return route ? `${config.apiResourceServerBaseUrl}/${route}` : '';
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
