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
