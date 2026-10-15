'use strict';

/**
 * airlines vertical plugin.
 *
 * Unlike every other vertical, this one owns NO local data store. Its four
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
    // Phase 2 amount-gated write. No challengeType in scope-topology — the
    // transaction policy decides DENY ($2500) / step-up ($600) / consent ($300)
    // from the amount, which is what UC6/7/8/22 demo.
    name: 'pay_airline_fee',
    description: 'Pay a change, checked-bag, or seat-upgrade fee.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Fee amount in dollars' },
        fee_type: { type: 'string', description: "'change', 'bag', or 'upgrade'" },
        confirmation_number: { type: 'string', description: 'Reservation the fee applies to' },
      },
      required: [],
    },
    scopes: ['airlines:read', 'airlines:write'],
    authz: {},
  },
  {
    // UC48 — Consumer agent booking. The CREATE write: produces a new
    // reservation row the everyday "show my reservations" read then lists. No
    // challengeType — the transaction policy (WRITE_TOOL_TYPE_MAP) evaluates the
    // price before this handler runs, same shape as pay_airline_fee.
    name: 'book_airline_flight',
    description: 'Book a flight for the passenger. The price is evaluated against the transaction policy before the booking is created.',
    inputSchema: {
      type: 'object',
      properties: {
        flight_number: { type: 'string', description: 'flight number, e.g. UA502' },
        origin: { type: 'string', description: 'Origin airport code (informational)' },
        destination: { type: 'string', description: 'Destination airport code (informational)' },
        amount: { type: 'number', description: 'Total ticket price in dollars' },
        passengers: { type: 'number', description: 'Number of passengers (default 1)' },
      },
      required: [],
    },
    scopes: ['airlines:read', 'airlines:write'],
    authz: {},
  },
  {
    // Phase 2 high-value write — step-up gated (scope-topology challengeType).
    name: 'cancel_airline_reservation',
    description: 'Cancel a reservation and start the refund. Requires step-up authentication.',
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
    description: "List the passenger's reservations including sensitive passenger details. Requires human consent.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    scopes: ['airlines:read', 'sensitive:read'],
    authz: {},
  },
  {
    name: 'get_airline_bookings',
    description: "List the passenger's upcoming reservations with flight, seat and status.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    scopes: ['airlines:read'],
    authz: {},
  },
  {
    name: 'get_flight_status',
    description: 'Get status, gate, aircraft and times for a flight.',
    inputSchema: {
      type: 'object',
      properties: { flight_number: { type: 'string', description: 'flight number, e.g. UA328' } },
      required: [],
    },
    scopes: ['airlines:read'],
    authz: {},
  },
  {
    name: 'check_seat_availability',
    description: 'Show the seat map for a flight.',
    inputSchema: {
      type: 'object',
      properties: {
        flight_number: { type: 'string', description: 'flight number, e.g. UA328' },
        available_only: { type: 'boolean', description: 'Only unoccupied seats (default true)' },
      },
      required: [],
    },
    scopes: ['airlines:read'],
    authz: {},
    render: 'seatMap',
  },
  {
    name: 'sensitive_passenger_record',
    description: "Access the passenger's full record — passport, date of birth, payment card on file and MileagePlus account number. Delegated to the Passenger Records Specialist agent; requires explicit user consent.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    // Coarse scope only. The specialist's Exchange #2 bearer carries
    // scope-topology's a2aDelegatedScope (pnr:read) instead, which is what the
    // resource server actually enforces — see airlinesTools.ts.
    scopes: ['read'],
    authz: { consent: true },
  },
  {
    // UC38 — Personal Agent Concierge read. No authz challenge: the BFF gate
    // (MFA + personal agent check) is the authorization signal for this tool.
    name: 'get_loyalty_status',
    description: "Return the passenger's MileagePlus tier and points balance.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    scopes: ['airlines:read'],
    authz: {},
  },
  {
    // UC38 — Personal Agent Concierge write. Deducts points and upgrades cabin.
    name: 'redeem_miles',
    description: 'Redeem loyalty points to upgrade cabin class on an upcoming reservation.',
    inputSchema: {
      type: 'object',
      properties: {
        confirmation_number: { type: 'string', description: 'Reservation to upgrade' },
        target_cabin: { type: 'string', description: "Target cabin: 'Business' or 'First'" },
      },
      required: [],
    },
    scopes: ['airlines:read', 'airlines:write'],
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
// the flight-status rule, and the sensitive-record phrase must not be claimed by
// the reservation rule ("passenger record" carries no reservation keyword today,
// but the ordering makes that independent of future wording).
const HEURISTICS = [
  // The A2A-delegated record is the narrowest phrase — matched first so it can
  // never be claimed by the sensitive-bookings rule or the generic one below.
  { re: /\bsensitive\b.*\bpassenger\b|\bpassenger\b.*\bsensitive\b/i, action: 'sensitive_passenger_record' },
  // Ahead of the cancel rule: "pay the $75 refund fee" contains `refund`, which
  // the cancel rule matches, and a fee payment routed to the cancel tool would
  // demo an MFA step-up where the amount ladder is the point. extractsAmount is
  // what puts the stated figure in front of the transaction policy — without it
  // the ladder sees no amount and never fires.
  { re: /\b(pay|settle)\b.*\bfees?\b/i, action: 'pay_airline_fee', extractsAmount: true, paramHint: 'e.g. "pay a $300 change fee"' },
  // Before the generic bookings rule below: "sensitive ... bookings" would
  // otherwise match `bookings` and resolve to the UNGATED lookup, so the chip
  // would declare the consent-gated tool and silently run the open one.
  // "cancel my reservation" must not fall into the generic bookings rule below.
  { re: /\b(cancel|refund)\b.*\b(reservation|booking|trip|flight)\b/i, action: 'cancel_airline_reservation' },
  { re: /\bsensitive\b.*\b(booking|bookings|reservation|reservations)\b/i, action: 'sensitive_airline_bookings' },
  // UC48 — before the generic bookings rule: "book a flight" contains `flight`,
  // which `my\s+flights?` would otherwise claim for the read. defaultParams
  // carries the Storylane scenario's price ($346 = the HITL consent band) and is
  // the AMOUNT the ladder evaluates; extractsAmount is deliberately absent — the
  // chip says "under $800" and extracting 800 would put a non-billable figure in
  // front of the policy. A stated "book for $500" does not re-extract either;
  // the seeded scenario price is the demo's number.
  { re: /\b(book|reserve)\b.*\b(flight|flights?)\b/i, action: 'book_airline_flight', defaultParams: { amount: 346 }, paramHint: 'e.g. "book a flight to Paris"' },
  // available_only defaults to true in airlinesToolHandler.ts (resource server),
  // so the seat-map chip never showed occupied seats without this — the
  // "Occupied" legend swatch + disabled seat styling could never be exercised.
  // A seat MAP should show the whole plane, not just what's left to buy.
  { re: /\b(seat|seats|seat\s*map|row)\b/i, action: 'check_seat_availability', defaultParams: { available_only: false } },
  { re: /\b(status|gate|boarding|delayed|on\s*time)\b/i, action: 'get_flight_status' },
  { re: /\b(reservation|reservations|booking|bookings|itinerar\w*|my\s+trips?|my\s+flights?)\b/i, action: 'get_airline_bookings' },
  // UC38 — Personal Agent Concierge. "miles" / "loyalty" / "upgrade" phrases
  // that are NOT seat-map queries (seat rule above already claimed "upgrade fee"
  // via pay_airline_fee). Order: redeem_miles before get_loyalty_status so a
  // "use my miles" phrase routes to the write action.
  { re: /\b(redeem|use)\b.*\bmiles?\b|\bmiles?\b.*\b(upgrade|reward)\b/i, action: 'redeem_miles' },
  { re: /\b(miles?|loyalty|tier|mileage\s*plus|points?\s+balance)\b/i, action: 'get_loyalty_status' },
];

function systemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'passenger';
  return [
    "You are the airline's travel agent (Skyline).",
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
