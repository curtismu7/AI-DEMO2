'use strict';

/**
 * gatewayTools.ts — descriptors for tools the GATEWAY itself owns and
 * dispatches (api_key / dual_token credential paths). Single source shared by
 * the WS tools/list handler, the schema-artifact generator, and request
 * validation. Moved verbatim from index.ts (Phase 266/267 definitions).
 */

export interface GatewayToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  credentialPath: string;
}

export const GATEWAY_TOOLS: GatewayToolDescriptor[] = [
  {
    name: 'special_offers',
    description: 'Demo: API-key credential path — gateway swaps OAuth bearer for a service API key. No backend call. Renders info page.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    credentialPath: 'api_key',
  },
  {
    name: 'user_profile_card',
    description: 'Demo: Access + ID-Token credential path — gateway forwards both tokens to banking_resource_server /identity, returns decoded claims.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    credentialPath: 'dual_token',
  },
  // Per-vertical API-key feature tools. Each is routed by APIKEY_TOOLS in router.ts;
  // injected here so they appear in tools/list and their featurePage chips are not hidden.
  {
    name: 'show_health_record',
    description: 'Demo: API-key path — fetch the patient health record from the CareConnect backend via service API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    credentialPath: 'api_key',
  },
  {
    name: 'show_gear_order',
    description: 'Demo: API-key path — fetch the most recent gear order from the Super Sports backend via service API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    credentialPath: 'api_key',
  },
  {
    name: 'show_gear_warranty',
    description: 'Demo: API-key path — fetch the gear warranty record from the Super Sports backend via service API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    credentialPath: 'api_key',
  },
  {
    name: 'show_enrollment',
    description: 'Demo: API-key path — fetch the student enrollment record from the Super University backend via service API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    credentialPath: 'api_key',
  },
  {
    name: 'show_large_purchase',
    description: 'Demo: API-key path — fetch a large purchase record from the Great Buy retail backend via service API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    credentialPath: 'api_key',
  },
  {
    name: 'show_expense_report',
    description: 'Demo: API-key path — fetch the expense report from the WX Workforce backend via service API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    credentialPath: 'api_key',
  },
  {
    name: 'show_permit',
    description: 'Demo: API-key path — fetch a permit record from the CivicPermit backend via service API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    credentialPath: 'api_key',
  },
  {
    name: 'show_work_order',
    description: 'Demo: API-key path — fetch a work order from the Precision Works manufacturing backend via service API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    credentialPath: 'api_key',
  },
  // Weather/Brave showcase tools — passthrough (oauth_bearer) targets forwarded to
  // demo_mcp_weather / demo_mcp_brave with NO RFC 8693 exchange, gated by
  // scopePolicies.ts (Texas-only geofence / blocked-terms filter). Mirrors
  // ping-gateway's 00-mcp-weather.json / 00-mcp-brave.json routes.
  {
    name: 'get_weather',
    description: 'Demo: weather showcase — current conditions for a location. Gateway enforces a Texas-only geofence (demo policy).',
    inputSchema: {
      type: 'object',
      properties: {
        city_name: { type: 'string', description: 'City name, optionally with state, e.g. "Austin, TX"' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        location_name: { type: 'string', description: 'A saved location name (not scope-verifiable; denied by policy)' },
      },
      additionalProperties: true,
    },
    credentialPath: 'oauth_bearer',
  },
  {
    name: 'brave_news_search',
    description: 'Demo: Brave News search showcase. Gateway blocks queries containing certain terms (demo content policy).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    credentialPath: 'oauth_bearer',
  },
];
