'use strict';

/**
 * Airlines tool handlers — every result is a row read from SQLite.
 *
 * There is deliberately no callBff() here: the point of this namespace is that
 * the resource server answers from its own database rather than proxying to the
 * BFF the way the invest tools do.
 *
 * Every payload carries `source: 'sqlite'` and, where a passenger was resolved,
 * `matchedBy` — so a demo-fallback match is visible in the response instead of
 * looking like a real subject match.
 */

import { getFlight, listBookings, listSeats, nextFlightFor, resolvePassenger } from '../db/airlinesDb';

const SOURCE = 'sqlite';

/**
 * Flight number from the arguments, or the passenger's next departing flight.
 * Chips carry no arguments, so a hard-required flight_number would stall them
 * on a "which flight?" clarify instead of answering.
 */
function resolveFlightNumber(args: Record<string, unknown>, subject: string): { flightNumber: string | null; defaulted: boolean } {
  const raw = args.flight_number;
  if (typeof raw === 'string' && raw.trim()) {
    return { flightNumber: raw.trim().toUpperCase(), defaulted: false };
  }
  const match = resolvePassenger(subject);
  if (!match) return { flightNumber: null, defaulted: true };
  return { flightNumber: nextFlightFor(match.passenger.passenger_ref), defaulted: true };
}

function getBookings(subject: string): unknown {
  const match = resolvePassenger(subject);
  if (!match) {
    return { source: SOURCE, bookings: [], note: 'No passenger records in the airlines database.' };
  }
  const { passenger, matchedBy } = match;
  const bookings = listBookings(passenger.passenger_ref);
  return {
    source: SOURCE,
    matchedBy,
    passenger: {
      passengerRef: passenger.passenger_ref,
      name: passenger.full_name,
      loyaltyTier: passenger.loyalty_tier,
      loyaltyPoints: passenger.loyalty_points,
    },
    upcomingTrips: bookings.length,
    bookings: bookings.map((b) => ({
      confirmationNumber: b.confirmation_number,
      flightNumber: b.flight_number,
      route: `${b.origin} to ${b.destination}`,
      departureTime: b.departure_time,
      gate: b.gate,
      seat: b.seat,
      cabin: b.cabin,
      checkedBags: b.checked_bags,
      status: b.status,
      flightStatus: b.flight_status,
    })),
  };
}

function flightStatus(args: Record<string, unknown>, subject: string): unknown {
  const { flightNumber, defaulted } = resolveFlightNumber(args, subject);
  if (!flightNumber) {
    return { source: SOURCE, found: false, note: 'No upcoming flight on file — name a flight number.' };
  }
  const flight = getFlight(flightNumber);
  if (!flight) {
    return { source: SOURCE, flightNumber, found: false, note: `No flight ${flightNumber} in the airlines database.` };
  }
  return {
    source: SOURCE,
    found: true,
    usedNextFlight: defaulted,
    flightNumber: flight.flight_number,
    route: `${flight.origin} to ${flight.destination}`,
    departureTime: flight.departure_time,
    arrivalTime: flight.arrival_time,
    gate: flight.gate,
    aircraft: flight.aircraft,
    status: flight.status,
  };
}

function seatAvailability(args: Record<string, unknown>, subject: string): unknown {
  const { flightNumber, defaulted } = resolveFlightNumber(args, subject);
  if (!flightNumber) {
    return { source: SOURCE, seatCount: 0, seats: [], note: 'No upcoming flight on file — name a flight number.' };
  }
  const availableOnly = args.available_only === undefined ? true : Boolean(args.available_only);
  const seats = listSeats(flightNumber, availableOnly);
  return {
    source: SOURCE,
    flightNumber,
    usedNextFlight: defaulted,
    availableOnly,
    seatCount: seats.length,
    seats: seats.map((s) => ({ seat: s.seat, cabin: s.cabin, available: s.available === 1 })),
  };
}

export const AIRLINES_TOOL_NAMES = new Set([
  'get_airline_bookings',
  'get_flight_status',
  'check_seat_availability',
]);

export async function dispatchAirlinesTool(
  toolName: string,
  args: Record<string, unknown>,
  subject: string,
): Promise<unknown> {
  switch (toolName) {
    case 'get_airline_bookings':
      return getBookings(subject);
    case 'get_flight_status':
      return flightStatus(args, subject);
    case 'check_seat_availability':
      return seatAvailability(args, subject);
    default:
      throw new Error(`Unknown airlines tool: ${toolName}`);
  }
}
