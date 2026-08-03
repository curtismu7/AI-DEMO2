'use strict';

/**
 * Airlines (United) MCP tool definitions.
 *
 * Unlike the invest tools — which proxy back to the BFF — these are served from
 * the SQLite database this resource server owns (src/db/airlinesDb.ts).
 *
 * Read-only in Phase 1. The write tools (change_seat, add_checked_bag) require
 * `airlines:write` and land in Phase 2.
 */

import { McpToolDef } from './toolTypes';

export const AIRLINES_TOOLS: McpToolDef[] = [
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
];
