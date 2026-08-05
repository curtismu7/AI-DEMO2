'use strict';

/**
 * SQLite backing store for the airlines vertical.
 *
 * This is the one place in the demo where a resource server owns its data
 * instead of proxying back to the BFF. Every airlines tool result is a row read
 * out of this file, so editing the .db out-of-band changes what the demo shows.
 *
 * Path:  AIRLINES_DB_PATH  (default <cwd>/data/airlines.db)
 * Seed:  AIRLINES_SEED_PATH (default <pkg>/seed/airlines.seed.json)
 *
 * The seed is applied ONLY when a table is empty. A restart must never clobber
 * a row that was changed outside the app — that is the property the DB proof
 * depends on.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface Booking {
  confirmation_number: string;
  flight_number: string;
  seat: string;
  cabin: string;
  checked_bags: number;
  status: string;
  origin: string;
  destination: string;
  departure_time: string;
  gate: string;
  flight_status: string;
}

export interface Flight {
  flight_number: string;
  origin: string;
  destination: string;
  departure_time: string;
  arrival_time: string;
  gate: string;
  aircraft: string;
  status: string;
}

export interface Seat {
  seat: string;
  cabin: string;
  available: number;
}

export interface Passenger {
  passenger_ref: string;
  subject: string | null;
  full_name: string;
  loyalty_tier: string;
  loyalty_points: number;
  is_demo_fallback: number;
}

export interface FeePaymentInput {
  confirmationNumber: string | null;
  feeType: string;
  amountCents: number;
}

export interface FeePayment extends FeePaymentInput {
  id: number;
  paidAt: string;
}

/**
 * The PII a passenger record carries that a reservation lookup deliberately does
 * NOT: passport, date of birth, the card the ticket was bought on, and the
 * loyalty account number. Kept in its own table so the read-only reservation
 * queries physically cannot return it — the A2A specialist tool is the only
 * caller that joins it.
 */
export interface PassengerRecord {
  passenger_ref: string;
  date_of_birth: string;
  passport_number: string;
  known_traveler_number: string | null;
  redress_number: string | null;
  loyalty_account_number: string;
  payment_card_brand: string;
  payment_card_last4: string;
  payment_card_expiry: string;
  billing_postal_code: string;
}

/** How a passenger row was located — surfaced in every tool result, never silent. */
export type MatchedBy = 'subject' | 'demo-fallback';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS passengers (
  passenger_ref    TEXT PRIMARY KEY,
  subject          TEXT,
  full_name        TEXT NOT NULL,
  loyalty_tier     TEXT NOT NULL,
  loyalty_points   INTEGER NOT NULL DEFAULT 0,
  is_demo_fallback INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS flights (
  flight_number  TEXT PRIMARY KEY,
  origin         TEXT NOT NULL,
  destination    TEXT NOT NULL,
  departure_time TEXT NOT NULL,
  arrival_time   TEXT NOT NULL,
  gate           TEXT,
  aircraft       TEXT,
  status         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  confirmation_number TEXT PRIMARY KEY,
  passenger_ref       TEXT NOT NULL REFERENCES passengers(passenger_ref),
  flight_number       TEXT NOT NULL REFERENCES flights(flight_number),
  seat                TEXT,
  cabin               TEXT,
  checked_bags        INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL,
  booked_at           TEXT
);
CREATE TABLE IF NOT EXISTS seats (
  flight_number TEXT NOT NULL REFERENCES flights(flight_number),
  seat          TEXT NOT NULL,
  cabin         TEXT,
  available     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (flight_number, seat)
);
CREATE TABLE IF NOT EXISTS fee_payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  confirmation_number TEXT,
  fee_type            TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL,
  paid_at             TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS passenger_records (
  passenger_ref          TEXT PRIMARY KEY REFERENCES passengers(passenger_ref),
  date_of_birth          TEXT NOT NULL,
  passport_number        TEXT NOT NULL,
  known_traveler_number  TEXT,
  redress_number         TEXT,
  loyalty_account_number TEXT NOT NULL,
  payment_card_brand     TEXT NOT NULL,
  payment_card_last4     TEXT NOT NULL,
  payment_card_expiry    TEXT NOT NULL,
  billing_postal_code    TEXT NOT NULL
);
`;

function dbPath(): string {
  return process.env.AIRLINES_DB_PATH || path.join(process.cwd(), 'data', 'airlines.db');
}

export function airlinesDatabaseName(): string {
  return path.basename(dbPath());
}

function seedPath(): string {
  return process.env.AIRLINES_SEED_PATH || path.join(__dirname, '..', '..', 'seed', 'airlines.seed.json');
}

function seedIfEmpty(conn: DatabaseSync): void {
  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM passengers').get() as { n: number };
  if (n > 0) return;

  const file = seedPath();
  if (!fs.existsSync(file)) {
    console.warn(`[airlines-db] seed file not found at ${file} — starting with empty tables`);
    return;
  }
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));

  const insPassenger = conn.prepare(
    'INSERT INTO passengers (passenger_ref, subject, full_name, loyalty_tier, loyalty_points, is_demo_fallback) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insFlight = conn.prepare(
    'INSERT INTO flights (flight_number, origin, destination, departure_time, arrival_time, gate, aircraft, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insBooking = conn.prepare(
    'INSERT INTO bookings (confirmation_number, passenger_ref, flight_number, seat, cabin, checked_bags, status, booked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insSeat = conn.prepare(
    'INSERT INTO seats (flight_number, seat, cabin, available) VALUES (?, ?, ?, ?)',
  );
  const insRecord = conn.prepare(
    'INSERT INTO passenger_records (passenger_ref, date_of_birth, passport_number, known_traveler_number, redress_number, loyalty_account_number, payment_card_brand, payment_card_last4, payment_card_expiry, billing_postal_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  conn.exec('BEGIN');
  try {
    for (const p of seed.passengers || []) {
      insPassenger.run(p.passenger_ref, p.subject ?? null, p.full_name, p.loyalty_tier, p.loyalty_points, p.is_demo_fallback ? 1 : 0);
    }
    for (const f of seed.flights || []) {
      insFlight.run(f.flight_number, f.origin, f.destination, f.departure_time, f.arrival_time, f.gate ?? null, f.aircraft ?? null, f.status);
    }
    for (const b of seed.bookings || []) {
      insBooking.run(b.confirmation_number, b.passenger_ref, b.flight_number, b.seat ?? null, b.cabin ?? null, b.checked_bags ?? 0, b.status, b.booked_at ?? null);
    }
    for (const s of seed.seats || []) {
      insSeat.run(s.flight_number, s.seat, s.cabin ?? null, s.available ? 1 : 0);
    }
    for (const r of seed.passenger_records || []) {
      insRecord.run(
        r.passenger_ref, r.date_of_birth, r.passport_number,
        r.known_traveler_number ?? null, r.redress_number ?? null,
        r.loyalty_account_number, r.payment_card_brand, r.payment_card_last4,
        r.payment_card_expiry, r.billing_postal_code,
      );
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  console.log(`[airlines-db] seeded ${dbPath()} from ${file}`);
}

/**
 * Run `fn` against a freshly opened connection, then close it.
 *
 * Deliberately NOT a cached long-lived handle. The demo's whole claim is that
 * editing airlines.db on the host changes what the next tool call returns, and a
 * pinned connection breaks exactly that: with the rollback journal it served one
 * stale read after an external commit, and WAL was worse — across a bind mount
 * the container's -shm index never syncs with the host writer's, so the reader
 * stayed on an old snapshot indefinitely. Opening per call costs microseconds at
 * this volume and makes external edits unconditionally visible.
 */
export function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  try {
    conn.exec('PRAGMA foreign_keys = ON');
    conn.exec(SCHEMA);
    seedIfEmpty(conn);
    return fn(conn);
  } finally {
    conn.close();
  }
}

/**
 * Resolve the token subject to a passenger row. Unknown subjects fall back to
 * the seeded demo passenger so the demo never renders empty — the caller must
 * surface `matchedBy` so the fallback is visible rather than silent.
 */
export function resolvePassenger(subject: string): { passenger: Passenger; matchedBy: MatchedBy } | null {
  return withDb((conn) => {
    if (subject) {
      const row = conn.prepare('SELECT * FROM passengers WHERE subject = ?').get(subject) as Passenger | undefined;
      if (row) return { passenger: row, matchedBy: 'subject' as MatchedBy };
    }
    const fallback = conn
      .prepare('SELECT * FROM passengers WHERE is_demo_fallback = 1 LIMIT 1')
      .get() as Passenger | undefined;
    return fallback ? { passenger: fallback, matchedBy: 'demo-fallback' as MatchedBy } : null;
  });
}

export function listBookings(passengerRef: string): Booking[] {
  return withDb((conn) => conn.prepare(`
    SELECT b.confirmation_number, b.flight_number, b.seat, b.cabin, b.checked_bags, b.status,
           f.origin, f.destination, f.departure_time, f.gate, f.status AS flight_status
      FROM bookings b
      JOIN flights f ON f.flight_number = b.flight_number
     WHERE b.passenger_ref = ?
     ORDER BY f.departure_time ASC
  `).all(passengerRef) as unknown as Booking[]);
}

/**
 * The passenger's next departing flight. Lets "flight status" / "available
 * seats" answer without the caller naming a flight — a chip carries no
 * arguments, and a required flight_number would stall it on a clarify prompt.
 */
export function nextFlightFor(passengerRef: string): string | null {
  const row = withDb((conn) => conn.prepare(`
    SELECT b.flight_number AS flight_number
      FROM bookings b
      JOIN flights f ON f.flight_number = b.flight_number
     WHERE b.passenger_ref = ?
     ORDER BY f.departure_time ASC
     LIMIT 1
  `).get(passengerRef) as { flight_number: string } | undefined);
  return row ? row.flight_number : null;
}

export function getFlight(flightNumber: string): Flight | null {
  const row = withDb((conn) => conn
    .prepare('SELECT * FROM flights WHERE flight_number = ?')
    .get(flightNumber) as Flight | undefined);
  return row ?? null;
}

/**
 * The passenger's PII row. Returns null rather than an empty shell when the
 * record is absent, so the caller reports "no record" instead of rendering a
 * blank passport number as if it were the real value.
 */
export function getPassengerRecord(passengerRef: string): PassengerRecord | null {
  const row = withDb((conn) => conn
    .prepare('SELECT * FROM passenger_records WHERE passenger_ref = ?')
    .get(passengerRef) as PassengerRecord | undefined);
  return row ?? null;
}

export function listSeats(flightNumber: string, availableOnly: boolean): Seat[] {
  const sql = availableOnly
    ? 'SELECT seat, cabin, available FROM seats WHERE flight_number = ? AND available = 1 ORDER BY seat'
    : 'SELECT seat, cabin, available FROM seats WHERE flight_number = ? ORDER BY seat';
  return withDb((conn) => conn.prepare(sql).all(flightNumber) as unknown as Seat[]);
}

/**
 * Append a fee payment. The ledger is append-only and never seeded — unlike the
 * reference tables, an empty fee_payments is the correct initial state, and
 * seedIfEmpty would otherwise refill it on every restart.
 */
export function recordFeePayment(input: FeePaymentInput): FeePayment {
  const paidAt = new Date().toISOString();
  return withDb((conn) => {
    conn.prepare(
      'INSERT INTO fee_payments (confirmation_number, fee_type, amount_cents, paid_at) VALUES (?, ?, ?, ?)',
    ).run(input.confirmationNumber, input.feeType, input.amountCents, paidAt);
    const row = conn
      .prepare('SELECT id FROM fee_payments ORDER BY id DESC LIMIT 1')
      .get() as unknown as { id: number };
    return { ...input, id: row.id, paidAt };
  });
}

export function listFeePayments(confirmationNumber?: string): FeePayment[] {
  const sql = confirmationNumber
    ? 'SELECT * FROM fee_payments WHERE confirmation_number = ? ORDER BY id DESC'
    : 'SELECT * FROM fee_payments ORDER BY id DESC';
  const rows = withDb((conn) =>
    (confirmationNumber
      ? conn.prepare(sql).all(confirmationNumber)
      : conn.prepare(sql).all()) as unknown as Array<{
      id: number;
      confirmation_number: string | null;
      fee_type: string;
      amount_cents: number;
      paid_at: string;
    }>,
  );
  return rows.map((r) => ({
    id: r.id,
    confirmationNumber: r.confirmation_number,
    feeType: r.fee_type,
    amountCents: r.amount_cents,
    paidAt: r.paid_at,
  }));
}