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

import { randomUUID } from 'node:crypto';
import {
  airlinesDatabaseName,
  deductLoyaltyPoints,
  getFlight,
  getPassengerRecord,
  listBookings,
  listSeats,
  nextFlightFor,
  recordFeePayment,
  resolvePassenger,
  upgradeCabinOnBooking,
} from '../db/airlinesDb';

const SOURCE = 'sqlite';

const FEE_TYPES = new Set(['change', 'bag', 'upgrade']);

/**
 * The amount-gated write. Unlike cancelReservation this one really does mutate,
 * but only by APPENDING to fee_payments — nothing a replayed demo can exhaust,
 * and the row is what UC20's audit view reads back.
 *
 * Reaching this function at all is the proof: at $2500 the transaction policy
 * denies, at $600 it demands step-up, at $300 it demands consent. A row here
 * means the ladder let the call through.
 */
function payFee(args: Record<string, unknown>, subject: string): unknown {
  const amount = typeof args.amount === 'number' ? args.amount : Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { source: SOURCE, paid: false, note: 'A positive fee amount is required.' };
  }
  const rawType = typeof args.fee_type === 'string' ? args.fee_type.trim().toLowerCase() : '';
  const feeType = FEE_TYPES.has(rawType) ? rawType : 'change';

  let confirmationNumber: string | null =
    typeof args.confirmation_number === 'string' && args.confirmation_number.trim()
      ? args.confirmation_number.trim().toUpperCase()
      : null;
  if (!confirmationNumber) {
    const match = resolvePassenger(subject);
    const bookings = match ? listBookings(match.passenger.passenger_ref) : [];
    confirmationNumber = bookings.length ? bookings[0].confirmation_number : null;
  }

  const receipt = recordFeePayment({
    confirmationNumber,
    feeType,
    amountCents: Math.round(amount * 100),
  });

  return {
    source: SOURCE,
    paid: true,
    receiptId: receipt.id,
    confirmationNumber,
    feeType,
    amount,
    paidAt: receipt.paidAt,
  };
}

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

/**
 * Phase 2 — the consent-gated read. Returns the same trips as getBookings plus
 * the passenger detail an agent must not surface unprompted. Deliberately a
 * SEPARATE tool rather than a flag on getBookings: the gate lives on the tool
 * name in scope-topology, so a parameter could not be gated without gating every
 * plain lookup too.
 */
/**
 * Phase 2 — the step-up-gated write. Reads the booking so the response names the
 * real trip being cancelled, then reports the cancellation and refund.
 *
 * It does NOT mutate the SQLite row: the demo is replayed constantly and a
 * destructive write would empty the passenger's trips after the first run, so
 * every later demo would show an empty itinerary. What matters for the
 * authorization story is that reaching this tool at all required MFA.
 */
function cancelReservation(args: Record<string, unknown>, subject: string): unknown {
  const match = resolvePassenger(subject);
  if (!match) {
    return { source: SOURCE, cancelled: false, note: 'No passenger records in the airlines database.' };
  }
  const bookings = listBookings(match.passenger.passenger_ref);
  const wanted = typeof args.confirmation_number === 'string' ? args.confirmation_number.trim().toUpperCase() : '';
  const booking = wanted
    ? bookings.find((b) => b.confirmation_number.toUpperCase() === wanted)
    : bookings[0];
  if (!booking) {
    return { source: SOURCE, cancelled: false, note: wanted ? `No reservation ${wanted} for this passenger.` : 'No upcoming reservations to cancel.' };
  }
  return {
    source: SOURCE,
    matchedBy: match.matchedBy,
    cancelled: true,
    simulated: true,
    confirmationNumber: booking.confirmation_number,
    flightNumber: booking.flight_number,
    route: `${booking.origin} to ${booking.destination}`,
    departureTime: booking.departure_time,
    refund: { status: 'initiated', method: 'original form of payment' },
    note: 'Cancellation recorded for the demo; the reservation row is left intact so the demo can be replayed.',
  };
}

function sensitiveBookings(subject: string): unknown {
  const base = getBookings(subject, 'sensitive_airline_bookings') as Record<string, unknown>;
  const match = resolvePassenger(subject);
  if (!match) {
    return base;
  }
  const { passenger } = match;
  return {
    ...base,
    sensitive: true,
    passengerDetails: {
      // Masked in the demo data set — the point is that reaching this at all
      // required a human approval, not that the values are real.
      documentNumber: `••••${String(passenger.passenger_ref).slice(-4)}`,
      loyaltyTier: passenger.loyalty_tier,
      loyaltyPoints: passenger.loyalty_points,
      contactEmail: `${String(passenger.full_name).split(' ')[0].toLowerCase()}@example.com`,
      paymentCardTail: '4242',
    },
  };
}

function getBookings(
  subject: string,
  toolName: 'get_airline_bookings' | 'sensitive_airline_bookings' = 'get_airline_bookings',
): unknown {
  const startedAt = performance.now();
  const queriedAt = new Date().toISOString();
  const match = resolvePassenger(subject);
  if (!match) {
    return {
      source: SOURCE,
      bookings: [],
      note: 'No passenger records in the airlines database.',
      provenance: bookingProvenance(toolName, queriedAt, startedAt, 0),
    };
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
    provenance: bookingProvenance(toolName, queriedAt, startedAt, bookings.length),
  };
}

function bookingProvenance(
  tool: 'get_airline_bookings' | 'sensitive_airline_bookings',
  queriedAt: string,
  startedAt: number,
  recordCount: number,
) {
  return {
    backend: 'United Reservations DB',
    engine: 'SQLite',
    database: airlinesDatabaseName(),
    tool,
    queryId: randomUUID(),
    queriedAt,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    recordCount,
    tables: ['passengers', 'bookings', 'flights'],
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
    // Same convention every other vertical's LOCAL tool uses (e.g. sporting-goods'
    // browse_gear) — render keyed by the tool's own action name — so the BFF's
    // parseMcpToolPayload (which otherwise defaults render to 'text') carries a
    // real hint the UI's manifest lookup (pageManifest.render[vr.render]) can
    // resolve. Airlines has no local plugin execute (see index.js), so nothing
    // upstream of this resource-server response ever set one.
    render: 'check_seat_availability',
  };
}

/**
 * The passenger's PII, joined to the PNRs it belongs to. Reached only by the
 * A2A Passenger Records Specialist — the tool requires `pnr:read`, a scope no
 * ordinary airlines session token carries.
 */
function sensitivePassengerRecord(subject: string): unknown {
  const match = resolvePassenger(subject);
  if (!match) {
    return { source: SOURCE, found: false, note: 'No passenger records in the airlines database.' };
  }
  const { passenger, matchedBy } = match;
  const record = getPassengerRecord(passenger.passenger_ref);
  if (!record) {
    return {
      source: SOURCE,
      matchedBy,
      found: false,
      passengerRef: passenger.passenger_ref,
      note: `No passenger record on file for ${passenger.passenger_ref}.`,
    };
  }
  return {
    source: SOURCE,
    matchedBy,
    found: true,
    sensitivity: 'pii',
    passengerRef: passenger.passenger_ref,
    name: passenger.full_name,
    dateOfBirth: record.date_of_birth,
    passportNumber: record.passport_number,
    knownTravelerNumber: record.known_traveler_number,
    redressNumber: record.redress_number,
    loyalty: {
      tier: passenger.loyalty_tier,
      points: passenger.loyalty_points,
      accountNumber: record.loyalty_account_number,
    },
    paymentCard: {
      brand: record.payment_card_brand,
      last4: record.payment_card_last4,
      expiry: record.payment_card_expiry,
      billingPostalCode: record.billing_postal_code,
    },
    pnrs: listBookings(passenger.passenger_ref).map((b) => b.confirmation_number),
  };
}

const CABIN_LADDER: Record<string, string> = {
  economy: 'Business',
  'economy plus': 'Business',
  business: 'First',
};
const POINTS_PER_UPGRADE = 25000;

function getLoyaltyStatus(subject: string): unknown {
  const match = resolvePassenger(subject);
  if (!match) {
    return { source: SOURCE, found: false, note: 'No passenger records in the airlines database.' };
  }
  return {
    source: SOURCE,
    matchedBy: match.matchedBy,
    loyaltyTier: match.passenger.loyalty_tier,
    loyaltyPoints: match.passenger.loyalty_points,
    passengerRef: match.passenger.passenger_ref,
    name: match.passenger.full_name,
  };
}

function redeemMiles(args: Record<string, unknown>, subject: string): unknown {
  const match = resolvePassenger(subject);
  if (!match) {
    return { source: SOURCE, redeemed: false, note: 'No passenger records in the airlines database.' };
  }
  const { passenger, matchedBy } = match;

  const bookings = listBookings(passenger.passenger_ref);
  const wanted = typeof args.confirmation_number === 'string' ? args.confirmation_number.trim().toUpperCase() : '';
  const booking = wanted ? bookings.find((b) => b.confirmation_number.toUpperCase() === wanted) : bookings[0];

  if (!booking) {
    return { source: SOURCE, matchedBy, redeemed: false, note: wanted ? `No reservation ${wanted} found.` : 'No upcoming reservations to upgrade.' };
  }

  const rawTarget = typeof args.target_cabin === 'string' ? args.target_cabin.trim() : '';
  const targetCabin = rawTarget || CABIN_LADDER[booking.cabin.toLowerCase()] || 'Business';

  if (booking.cabin.toLowerCase() === targetCabin.toLowerCase()) {
    return { source: SOURCE, matchedBy, redeemed: false, note: `Already in ${booking.cabin} cabin — no upgrade available.` };
  }

  if (passenger.loyalty_points < POINTS_PER_UPGRADE) {
    return {
      source: SOURCE,
      matchedBy,
      redeemed: false,
      pointsRequired: POINTS_PER_UPGRADE,
      pointsAvailable: passenger.loyalty_points,
      note: `Insufficient miles. ${POINTS_PER_UPGRADE.toLocaleString()} required, ${passenger.loyalty_points.toLocaleString()} available.`,
    };
  }

  deductLoyaltyPoints(passenger.passenger_ref, POINTS_PER_UPGRADE);
  upgradeCabinOnBooking(booking.confirmation_number, targetCabin);

  return {
    source: SOURCE,
    matchedBy,
    redeemed: true,
    confirmationNumber: booking.confirmation_number,
    flightNumber: booking.flight_number,
    route: `${booking.origin} to ${booking.destination}`,
    departureTime: booking.departure_time,
    previousCabin: booking.cabin,
    upgradedToCabin: targetCabin,
    pointsRedeemed: POINTS_PER_UPGRADE,
    pointsRemaining: passenger.loyalty_points - POINTS_PER_UPGRADE,
    redemptionId: randomUUID(),
  };
}

export const AIRLINES_TOOL_NAMES = new Set([
  'pay_airline_fee',
  'get_airline_bookings',
  'sensitive_airline_bookings',
  'cancel_airline_reservation',
  'get_flight_status',
  'check_seat_availability',
  'sensitive_passenger_record',
  'get_loyalty_status',
  'redeem_miles',
]);

function runAirlinesTool(
  toolName: string,
  args: Record<string, unknown>,
  subject: string,
): unknown {
  switch (toolName) {
    case 'pay_airline_fee':
      return payFee(args, subject);
    case 'get_airline_bookings':
      return getBookings(subject);
    case 'sensitive_airline_bookings':
      return sensitiveBookings(subject);
    case 'cancel_airline_reservation':
      return cancelReservation(args, subject);
    case 'get_flight_status':
      return flightStatus(args, subject);
    case 'check_seat_availability':
      return seatAvailability(args, subject);
    case 'sensitive_passenger_record':
      return sensitivePassengerRecord(subject);
    case 'get_loyalty_status':
      return getLoyaltyStatus(subject);
    case 'redeem_miles':
      return redeemMiles(args, subject);
    default:
      throw new Error(`Unknown airlines tool: ${toolName}`);
  }
}

export async function dispatchAirlinesTool(
  toolName: string,
  args: Record<string, unknown>,
  subject: string,
): Promise<unknown> {
  const result = runAirlinesTool(toolName, args, subject);
  // Same convention seatAvailability documents inline: render keyed by the
  // tool's own action name so the UI's manifest lookup
  // (pageManifest.render[vr.render]) resolves a descriptor. Without it the BFF
  // defaults render to 'text' and the chat dumps the raw JSON payload.
  if (result && typeof result === 'object' && !('render' in result)) {
    (result as Record<string, unknown>).render = toolName;
  }
  return result;
}
