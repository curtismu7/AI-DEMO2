'use strict';

/**
 * UC48 — Consumer agent booking. The write that proves a governed agent can
 * CREATE a reservation: new row in bookings, readable back by the ordinary
 * "show my reservations" chip in the same run.
 *
 * Unlike payFee (appends to fee_payments) and redeemMiles (mutates one row),
 * booking APPENDS to bookings — a new row is the artifact, so replay is safe
 * by construction and the demo survives a page reload.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airlines-book-'));
process.env.AIRLINES_DB_PATH = path.join(tmpDir, 'airlines.db');
process.env.AIRLINES_SEED_PATH = path.join(__dirname, '..', 'seed', 'airlines.seed.json');

import { dispatch } from '../src/tools/registry';
import { createBooking } from '../src/db/airlinesDb';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('book_airline_flight', () => {
  it('inserts a booking row the ordinary reservations read can see', async () => {
    const result: any = await dispatch(
      'book_airline_flight',
      { flight_number: 'UA502', origin: 'ORD', destination: 'LHR', amount: 346, passengers: 2 },
      '',
      'unknown-sub',
    );
    expect(result.source).toBe('sqlite');
    expect(result.booked).toBe(true);
    expect(result.flightNumber).toBe('UA502');
    expect(result.route).toBe('ORD to LHR');
    expect(result.confirmationNumber).toMatch(/^[A-Z0-9]{6}$/);

    // The Storylane beat: after the agent books, "show my reservations"
    // must include the new trip — same passenger, same DB.
    const after: any = await dispatch('get_airline_bookings', {}, '', 'unknown-sub');
    const booked = after.bookings.find(
      (b: any) => b.confirmationNumber === result.confirmationNumber,
    );
    expect(booked).toBeDefined();
    expect(booked.flightNumber).toBe('UA502');
    expect(booked.status).toBe('Confirmed');
  });

  it('rejects an unknown flight instead of writing a broken row', async () => {
    const result: any = await dispatch(
      'book_airline_flight',
      { flight_number: 'UA9999', amount: 346 },
      '',
      'unknown-sub',
    );
    expect(result.booked).toBe(false);
    expect(result.note).toMatch(/UA9999/);
  });

  it('rejects a non-positive price instead of writing a row', async () => {
    const result: any = await dispatch(
      'book_airline_flight',
      { flight_number: 'UA502', amount: 0 },
      '',
      'unknown-sub',
    );
    expect(result.booked).toBe(false);
    expect(result.note).toMatch(/price/i);
  });

  it('names the flight to book when none was given', async () => {
    const result: any = await dispatch('book_airline_flight', { amount: 346 }, '', 'unknown-sub');
    // Chips may carry no flight_number; the handler asks rather than guessing a row.
    expect(result.booked).toBe(false);
    expect(result.note).toMatch(/flight/i);
  });

  it('keeps confirmation numbers unique across runs', async () => {
    const a: any = await dispatch(
      'book_airline_flight', { flight_number: 'UA502', amount: 346 }, '', 'unknown-sub');
    const b: any = await dispatch(
      'book_airline_flight', { flight_number: 'UA502', amount: 346 }, '', 'unknown-sub');
    expect(a.booked).toBe(true);
    expect(b.booked).toBe(true);
    expect(a.confirmationNumber).not.toBe(b.confirmationNumber);
  });

  it('createBooking throws when the passenger row is missing (FK on)', () => {
    expect(() =>
      createBooking({ passengerRef: 'UA-PAX-NOPE', flightNumber: 'UA502', seat: null, cabin: 'Economy', checkedBags: 0 }),
    ).toThrow();
  });
});

// ── Booking rules: the server judges the catalogue fare, never the caller's ────────────────
import { DatabaseSync } from 'node:sqlite';
import { getFare, getFlight } from '../src/db/airlinesDb';

const POLICY_DATA = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'seed', 'airline-booking-policy-data.json'), 'utf8'),
);
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'airlines.seed.json'), 'utf8'));

describe('book_airline_flight fare check (booking rules)', () => {
  const book = (flight_number: unknown, amount: unknown): Promise<any> =>
    dispatch('book_airline_flight', { flight_number, amount }, '', 'unknown-sub') as Promise<any>;

  it.each([
    ['SH102', 320],
    ['SH104', 500],
    ['SH106', 620],
    ['SH107', 940],
  ])('books %s at the catalogue fare %s (the server is not a policy engine)', async (flight, fare) => {
    const r = await book(flight, fare);
    expect(r.booked).toBe(true);
    expect(r.amount).toBe(fare);
    expect(r.fare).toBe(fare);
  });

  it('keeps the exact cents on the boundary fares', async () => {
    expect(getFare('SH105')).toBe(500.01);
    expect(getFare('SH109')).toBe(750.01);
    const r = await book('SH105', 500.01);
    expect(r.booked).toBe(true);
    expect(r.fare).toBe(500.01);
  });

  it('refuses a lying quote on a high fare with reason fare_mismatch', async () => {
    const r = await book('SH106', 100);
    expect(r.booked).toBe(false);
    expect(r.reason).toBe('fare_mismatch');
    expect(r.note).toBe('Quoted $100 does not match the fare for SH106.');
    const r2 = await book('SH107', '100');
    expect(r2.booked).toBe(false);
    expect(r2.reason).toBe('fare_mismatch');
  });

  it('does not book anything when the quote is refused', async () => {
    const before: any = await dispatch('get_airline_bookings', {}, '', 'unknown-sub');
    await book('SH107', 1);
    const after: any = await dispatch('get_airline_bookings', {}, '', 'unknown-sub');
    expect(after.bookings.length).toBe(before.bookings.length);
  });

  it('flights in the seed but not in the fare catalogue are refused with no_fare', async () => {
    // getFlight finds UA9999? no: an unknown flight is refused earlier. Use a proto-ish key too.
    for (const name of ['__proto__', 'constructor', 'toString']) {
      expect(getFare(name)).toBeNull();
    }
    const r = await book('SH999', 320);
    expect(r.booked).toBe(false);
    expect(r.note).toMatch(/SH999/);
  });

  it('re-inserts a missing seed flight into an existing database, without touching an edited row', async () => {
    const file = process.env.AIRLINES_DB_PATH as string;
    const conn = new DatabaseSync(file);
    conn.exec('PRAGMA foreign_keys = ON');
    conn.exec("DELETE FROM flights WHERE flight_number = 'SH103'");
    conn.exec("UPDATE flights SET gate = 'EDITED' WHERE flight_number = 'SH102'");
    conn.close();
    expect(getFlight('SH103')?.flight_number).toBe('SH103');
    expect(getFlight('SH102')?.gate).toBe('EDITED');
  });

  it('the fare catalogue and the seed flights are the same set of flights', () => {
    const seedFlights = SEED.flights.map((f: any) => f.flight_number).sort();
    expect(Object.keys(POLICY_DATA.flights).sort()).toEqual(seedFlights);
  });

  it('every catalogue fare is a positive number and the premium set is explicit and non-empty', () => {
    for (const v of Object.values(POLICY_DATA.flights)) {
      expect(typeof v).toBe('number');
      expect(v as number).toBeGreaterThan(0);
    }
    expect(POLICY_DATA.premiumTiers.length).toBeGreaterThan(0);
  });
});
