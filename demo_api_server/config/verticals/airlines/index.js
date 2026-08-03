'use strict';

/**
 * airlines (United) vertical plugin.
 *
 * Unlike every other vertical, this one owns NO local data store. Its three
 * tools are answered by demo_mcp_resource_server out of a real SQLite database
 * (demo_mcp_resource_server/src/db/airlinesDb.ts), reached over the normal
 * chain: BFF -> mcp-gateway (RFC 8693 exchange) -> resource server -> SQLite.
 *
 * executeTool therefore always returns NOT_MY_TOOL so verticalDispatch falls
 * through to the MCP executor — the same mechanism banking uses for the tool
 * names it advertises but does not own locally.
 */

const { createVerticalPlugin } = require('../shared/createVerticalPlugin');

const NOT_MY_TOOL = Symbol.for('verticalDispatch.NOT_MY_TOOL');

const TOOLS = [
  {
    // Phase 2 high-value write — step-up gated (scope-topology challengeType).
    name: 'cancel_airline_reservation',
    description: 'Cancel a United reservation and start the refund. Requires step-up authentication.',
    inputSchema: {
      type: 'object',
      properties: { confirmation_number: { type: 'string', description: 'Reservation confirmation number' } },
      required: [],
    },
    scopes: ['airlines:read', 'airlines:write'],
    authz: {},
  },
  {
    // Phase 2 — consent-gated counterpart of get_airline_bookings. Carries
    // sensitive:read on top of airlines:read, and scope-topology marks it
    // challengeType:consent, so only THIS lookup prompts for human approval.
    name: 'sensitive_airline_bookings',
    description: "List the passenger's United reservations including sensitive passenger details. Requires human consent.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    scopes: ['airlines:read', 'sensitive:read'],
    authz: {},
  },
  {
    name: 'get_airline_bookings',
    description: "List the passenger's upcoming United reservations with flight, seat and status.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    scopes: ['airlines:read'],
    authz: {},
  },
  {
    name: 'get_flight_status',
    description: 'Get status, gate, aircraft and times for a United flight.',
    inputSchema: {
      type: 'object',
      properties: { flight_number: { type: 'string', description: 'United flight number, e.g. UA328' } },
      required: [],
    },
    scopes: ['airlines:read'],
    authz: {},
  },
  {
    name: 'check_seat_availability',
    description: 'Show the seat map for a United flight.',
    inputSchema: {
      type: 'object',
      properties: {
        flight_number: { type: 'string', description: 'United flight number, e.g. UA328' },
        available_only: { type: 'boolean', description: 'Only unoccupied seats (default true)' },
      },
      required: [],
    },
    scopes: ['airlines:read'],
    authz: {},
  },
  // Shared education-path placeholders. createVerticalPlugin appends
  // EDUCATION_HEURISTICS, whose actions must be declared tool names — same
  // stubs every other vertical carries.
  { name: 'api_key_demo', description: 'Demo API-key path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  { name: 'dual_token_demo', description: 'Demo access and ID token path.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
];

const EDUCATION_STUBS = new Set(['api_key_demo', 'dual_token_demo']);

// Most specific first: a seat question mentioning a flight must not fall into
// the flight-status rule.
const HEURISTICS = [
  // Before the generic bookings rule below: "sensitive ... bookings" would
  // otherwise match `bookings` and resolve to the UNGATED lookup, so the chip
  // would declare the consent-gated tool and silently run the open one.
  // "cancel my reservation" must not fall into the generic bookings rule below.
  { re: /\b(cancel|refund)\b.*\b(reservation|booking|trip|flight)\b/i, action: 'cancel_airline_reservation' },
  { re: /\bsensitive\b.*\b(booking|bookings|reservation|reservations)\b/i, action: 'sensitive_airline_bookings' },
  { re: /\b(seat|seats|seat\s*map|row)\b/i, action: 'check_seat_availability' },
  { re: /\b(status|gate|boarding|delayed|on\s*time)\b/i, action: 'get_flight_status' },
  { re: /\b(reservation|reservations|booking|bookings|itinerar\w*|my\s+trips?|my\s+flights?)\b/i, action: 'get_airline_bookings' },
];

function systemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'passenger';
  return [
    "You are United Airlines' travel agent (Skyline).",
    'You help passengers view their reservations, check flight status and gate information,',
    'and see which seats are still available on a flight.',
    `The signed-in user role is "${role}".`,
    'Every answer comes from the airline reservation database — never invent a flight number,',
    'confirmation number, gate, or seat. Only emit one of the allowed airline actions;',
    'never reference banking-account concepts.',
  ].join(' ');
}

module.exports = createVerticalPlugin({
  id: 'airlines',
  // MCP-backed, no local store — the data lives in the resource server's SQLite
  // database, not in this process. Same convention as banking/index.js.
  store: { get: () => ({}) },
  tools: TOOLS,
  // The three airlines tools are owned by the resource server, so hand them to
  // the MCP executor. Only the shared education stubs answer locally.
  execute: async (name) => (EDUCATION_STUBS.has(name) ? { result: { data: {} }, render: 'text' } : NOT_MY_TOOL),
  heuristics: HEURISTICS,
  systemPrompt,
});
