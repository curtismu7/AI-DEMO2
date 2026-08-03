'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airlines-db-'));
process.env.AIRLINES_DB_PATH = path.join(tmpDir, 'airlines.db');
process.env.AIRLINES_SEED_PATH = path.join(__dirname, '..', 'seed', 'airlines.seed.json');

import { getFlight, listBookings, listSeats, nextFlightFor, resolvePassenger, withDb } from '../src/db/airlinesDb';

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
