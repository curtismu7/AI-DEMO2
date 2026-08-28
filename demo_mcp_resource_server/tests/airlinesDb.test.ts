'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airlines-db-'));
process.env.AIRLINES_DB_PATH = path.join(tmpDir, 'airlines.db');
process.env.AIRLINES_SEED_PATH = path.join(__dirname, '..', 'seed', 'airlines.seed.json');

import {
  getFlight,
  listBookings,
  listFeePayments,
  listSeats,
  nextFlightFor,
  recordFeePayment,
  redeemUpgrade,
  resolvePassenger,
  withDb,
} from '../src/db/airlinesDb';

const pointsOf = (passengerRef: string): number => withDb((db) => (db
  .prepare('SELECT loyalty_points FROM passengers WHERE passenger_ref = ?')
  .get(passengerRef) as { loyalty_points: number }).loyalty_points);

const cabinOf = (confirmationNumber: string): string => withDb((db) => (db
  .prepare('SELECT cabin FROM bookings WHERE confirmation_number = ?')
  .get(confirmationNumber) as { cabin: string }).cabin);

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('airlinesDb', () => {
  it('creates the database file and seeds it on first open', () => {
    withDb(() => null);
    expect(fs.existsSync(process.env.AIRLINES_DB_PATH as string)).toBe(true);
    expect(resolvePassenger('UA-PAX-0001')).not.toBeNull();
  });

  it('falls back to the demo passenger for an unknown subject, and says so', () => {
    const match = resolvePassenger('not-a-real-pingone-sub');
    expect(match).not.toBeNull();
    expect(match!.matchedBy).toBe('demo-fallback');
    expect(match!.passenger.passenger_ref).toBe('UA-PAX-0001');
  });

  it('reports a subject match when the passenger row carries that subject', () => {
    withDb((db) => db.prepare('UPDATE passengers SET subject = ? WHERE passenger_ref = ?')
      .run('pingone-sub-abc', 'UA-PAX-0002'));
    const match = resolvePassenger('pingone-sub-abc');
    expect(match!.matchedBy).toBe('subject');
    expect(match!.passenger.full_name).toBe('Alex Chen');
  });

  it('joins bookings to flights, ordered by departure', () => {
    const bookings = listBookings('UA-PAX-0001');
    expect(bookings).toHaveLength(2);
    expect(bookings[0].confirmation_number).toBe('K7XR2M');
    expect(bookings[0].origin).toBe('ORD');
    expect(bookings[0].destination).toBe('SFO');
    expect(bookings[0].gate).toBe('C12');
  });

  it('reads flight status and available seats', () => {
    expect(getFlight('UA328')!.aircraft).toBe('Boeing 737 MAX 9');
    expect(getFlight('NOPE')).toBeNull();

    const available = listSeats('UA328', true);
    expect(available.every((s) => s.available === 1)).toBe(true);
    expect(available.length).toBeLessThan(listSeats('UA328', false).length);
  });

  it('defaults to the earliest departing flight for a passenger', () => {
    expect(nextFlightFor('UA-PAX-0001')).toBe('UA328');
    expect(nextFlightFor('nobody')).toBeNull();
  });

  // The property the whole DB proof rests on: a value changed outside this
  // process must be what the next read returns, and must survive a reopen. If
  // the seed re-applied, or a connection cached a snapshot, the out-of-band
  // sqlite3 edit in the manual verification would silently revert.
  it('does not re-seed over an out-of-band edit, and reads it back immediately', () => {
    withDb((db) => db.prepare("UPDATE bookings SET status = 'Cancelled', seat = '31F' WHERE confirmation_number = ?")
      .run('K7XR2M'));

    const after = listBookings('UA-PAX-0001')[0];
    expect(after.status).toBe('Cancelled');
    expect(after.seat).toBe('31F');
  });
});

describe('fee_payments', () => {
  it('records a payment and reads it back', () => {
    const saved = recordFeePayment({
      confirmationNumber: 'K7XR2M',
      feeType: 'change',
      amountCents: 30000,
    });
    expect(saved.id).toBeGreaterThan(0);
    expect(saved.amountCents).toBe(30000);
    expect(saved.confirmationNumber).toBe('K7XR2M');
    expect(saved.paidAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const rows = listFeePayments('K7XR2M');
    expect(rows).toHaveLength(1);
    expect(rows[0].feeType).toBe('change');
  });

  it('is append-only across calls, newest first', () => {
    recordFeePayment({ confirmationNumber: 'L9QP4T', feeType: 'bag', amountCents: 6000 });
    recordFeePayment({ confirmationNumber: 'L9QP4T', feeType: 'upgrade', amountCents: 15000 });
    const rows = listFeePayments('L9QP4T');
    expect(rows).toHaveLength(2);
    expect(rows[0].feeType).toBe('upgrade');
  });

  it('lists across all confirmations when none is named', () => {
    expect(listFeePayments().length).toBeGreaterThanOrEqual(3);
  });
});

// The transactional boundary. Each of these asserts the SAME property from a
// different failure: nothing partial survives. Against the previous two-call
// version the first two cases both left the points deducted, which is exactly
// the partial state that made a retry deduct twice.
describe('redeemUpgrade', () => {
  it('deducts the points and moves the cabin together', () => {
    const before = pointsOf('UA-PAX-0001');
    redeemUpgrade('UA-PAX-0001', 1000, 'K7XR2M', 'Business');

    expect(pointsOf('UA-PAX-0001')).toBe(before - 1000);
    expect(cabinOf('K7XR2M')).toBe('Business');
  });

  it('deducts nothing when the booking does not exist', () => {
    const before = pointsOf('UA-PAX-0001');
    expect(() => redeemUpgrade('UA-PAX-0001', 1000, 'NOSUCH', 'First'))
      .toThrow(/No reservation NOSUCH/);

    expect(pointsOf('UA-PAX-0001')).toBe(before);
  });

  it('refuses rather than clamping when the balance is short, leaving the cabin alone', () => {
    const before = pointsOf('UA-PAX-0001');
    const cabin = cabinOf('K7XR2M');
    expect(() => redeemUpgrade('UA-PAX-0001', before + 1, 'K7XR2M', 'First'))
      .toThrow(/Insufficient miles/);

    expect(pointsOf('UA-PAX-0001')).toBe(before);
    expect(cabinOf('K7XR2M')).toBe(cabin);
  });
});
