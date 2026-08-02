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
