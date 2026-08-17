'use strict';

/**
 * Airlines (United) MCP tool definitions.
 *
 * Unlike the invest tools — which proxy back to the BFF — these are served from
 * the SQLite database this resource server owns (src/db/airlinesDb.ts).
 *
 * Read-only in Phase 1. The write tools (change_seat, add_checked_bag) require
 * `airlines:write` and land in Phase 2.
 *
 * `sensitive_passenger_record` is deliberately gated on `pnr:read`, NOT on
 * `airlines:read`. Only the A2A Passenger Records Specialist's Exchange #2
 * bearer carries that scope (scope-topology.json a2aDelegatedScope), so an
 * ordinary consent read cannot reach the PII no matter how the prompt is
 * worded — the delegation chain is the only way in.
 */

import { McpToolDef } from './toolTypes';

export const AIRLINES_TOOLS: McpToolDef[] = [
  {
    // The amount-gated write. Every other vertical binds UC6/7/8/22 to a money
    // tool (pay_bill, checkout, large_trade); airlines had none, so those steps
    // had nothing to bind to. Scopes are byte-identical to
    // cancel_airline_reservation — the amount ladder keys on the tool NAME via
    // WRITE_TOOL_TYPE_MAP, never on scope, so adding a generic `write` here
    // would buy nothing and reintroduce a scope-collision risk.
    name: 'pay_airline_fee',
    description: 'Pay a United fee — change fee, checked-bag fee, or seat-upgrade fee. The amount is evaluated against the transaction policy before the payment is taken.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Fee amount in dollars' },
        fee_type: { type: 'string', description: "One of 'change', 'bag', 'upgrade' (default 'change')" },
        confirmation_number: { type: 'string', description: 'Reservation the fee applies to. Omit for the next upcoming trip.' },
      },
      required: [],
    },
    requiredScopes: ['airlines:read', 'airlines:write'],
    readOnly: false,
  },
  {
    // Phase 2. The high-value WRITE: cancelling a booked seat and triggering a
    // refund is irreversible, so scope-topology marks it challengeType:step_up —
    // the passenger must prove presence with MFA, which a HITL consent receipt
    // deliberately cannot satisfy. The vertical's own manifest already named this
    // as its highValueAction ("Cancel Reservation").
    name: 'cancel_airline_reservation',
    description: 'Cancel a United reservation and start the refund. Requires step-up authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        confirmation_number: { type: 'string', description: 'Reservation confirmation number. Omit to cancel the next upcoming trip.' },
      },
      required: [],
    },
    requiredScopes: ['airlines:read', 'airlines:write'],
    readOnly: false,
  },
  {
    // Phase 2. The sensitive counterpart of get_airline_bookings: same trip data
    // plus the passenger PII an agent should not surface without a human saying
    // yes — document numbers, contact details, payment tail. Consent-gated in
    // scope-topology (challengeType: consent) and carries sensitive:read, so the
    // plain lookup stays ungated and only THIS one prompts. Mirrors the split
    // healthcare already has (view_records vs sensitive_patient_records).
    name: 'sensitive_airline_bookings',
    description: "List the authenticated passenger's United reservations including sensitive passenger details (document number, contact details, payment card tail). Requires human consent.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['airlines:read', 'sensitive:read'],
    readOnly: true,
  },
  {
    name: 'get_airline_bookings',
    description: "List the authenticated passenger's upcoming United reservations, with flight, seat and status.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['airlines:read'],
    readOnly: true,
  },
  {
    name: 'get_flight_status',
    description: 'Get status, gate, aircraft and departure/arrival times for a United flight. Defaults to the passenger\'s next departing flight when none is named.',
    inputSchema: {
      type: 'object',
      properties: {
        flight_number: { type: 'string', description: 'United flight number, e.g. UA328. Omit for the next departing flight.' },
      },
      required: [],
    },
    requiredScopes: ['airlines:read'],
    readOnly: true,
  },
  {
    name: 'check_seat_availability',
    description: 'Show the seat map for a United flight, optionally only the seats still available. Defaults to the passenger\'s next departing flight when none is named.',
    inputSchema: {
      type: 'object',
      properties: {
        flight_number: { type: 'string', description: 'United flight number, e.g. UA328. Omit for the next departing flight.' },
        available_only: { type: 'boolean', description: 'Only return unoccupied seats (default true)', default: true },
      },
      required: [],
    },
    requiredScopes: ['airlines:read'],
    readOnly: true,
  },
  {
    name: 'sensitive_passenger_record',
    description: "Retrieve the passenger's full record — passport, date of birth, payment card on file, and MileagePlus account number. Delegated to the Passenger Records Specialist agent; requires the pnr:read scope.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['pnr:read'],
    readOnly: true,
  },
  {
    // UC38 — Personal Agent Concierge. Reads loyalty_tier and loyalty_points from
    // the passengers table. The delegated token's act claim proves the personal
    // agent is acting on the user's behalf; airlines:read is all that's needed here.
    name: 'get_loyalty_status',
    description: "Return the authenticated passenger's MileagePlus tier and points balance.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['airlines:read'],
    readOnly: true,
    intentHints: ['check my MileagePlus status', 'how many miles do I have', 'what is my loyalty tier'],
  },
  {
    // UC38 — Personal Agent Concierge write action. Deducts loyalty points and
    // upgrades the cabin on an upcoming booking. airlines:write reflects that
    // this mutates a row — scope-topology already has airlines:write with
    // may_act/delegated_to/is_delegate so delegation is supported.
    name: 'redeem_miles',
    description: "Redeem loyalty points to upgrade cabin class on an upcoming reservation. Requires a delegated token with the personal agent's act claim.",
    inputSchema: {
      type: 'object',
      properties: {
        confirmation_number: { type: 'string', description: 'Reservation to upgrade. Omit for the next upcoming trip.' },
        target_cabin: { type: 'string', description: "Target cabin: 'Business' or 'First'. Defaults to next class up from current cabin." },
      },
      required: [],
    },
    requiredScopes: ['airlines:read', 'airlines:write'],
    readOnly: false,
    intentHints: ['redeem my miles for an upgrade', 'use points to upgrade my seat', 'upgrade my cabin with loyalty points'],
  },
];
