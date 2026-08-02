'use strict';

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airlines-tools-'));
process.env.AIRLINES_DB_PATH = path.join(tmpDir, 'airlines.db');
process.env.AIRLINES_SEED_PATH = path.join(__dirname, '..', 'seed', 'airlines.seed.json');

import { ALL_TOOLS, SUPPORTED_SCOPES, dispatch, findTool } from '../src/tools/registry';
import { filterByScopes } from '../src/tools/toolTypes';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const AIRLINES = ['get_airline_bookings', 'get_flight_status', 'check_seat_availability'];

describe('resource server tool registry', () => {
  it('exposes both namespaces and advertises both scopes', () => {
    for (const name of AIRLINES) expect(findTool(name)).toBeDefined();
    expect(findTool('get_portfolio_summary')).toBeDefined();
    expect(SUPPORTED_SCOPES).toEqual(expect.arrayContaining(['invest:read', 'airlines:read']));
  });

  it('every airlines tool requires airlines:read', () => {
    for (const name of AIRLINES) {
      expect(findTool(name)!.requiredScopes).toEqual(['airlines:read']);
    }
  });

  it('an invest:read token sees no airlines tools, and vice versa', () => {
    const investOnly = filterByScopes(ALL_TOOLS, ['invest:read']).map((t) => t.name);
    expect(investOnly).not.toEqual(expect.arrayContaining(AIRLINES));

    const airlinesOnly = filterByScopes(ALL_TOOLS, ['airlines:read']).map((t) => t.name);
    expect(airlinesOnly).toEqual(AIRLINES);
  });

  it('a zero-scope token sees nothing', () => {
    expect(filterByScopes(ALL_TOOLS, [])).toHaveLength(0);
  });
});

describe('airlines dispatch', () => {
  it('reads bookings out of SQLite, stamping the source and the match kind', async () => {
    const result: any = await dispatch('get_airline_bookings', {}, 'unused-token', 'unknown-sub');
    expect(result.source).toBe('sqlite');
    expect(result.matchedBy).toBe('demo-fallback');
    expect(result.upcomingTrips).toBe(2);
    expect(result.bookings[0].confirmationNumber).toBe('K7XR2M');
    expect(result.bookings[0].route).toBe('ORD to SFO');
  });

  it('reads flight status', async () => {
    const result: any = await dispatch('get_flight_status', { flight_number: 'ua328' }, '', '');
    expect(result.source).toBe('sqlite');
    expect(result.found).toBe(true);
    expect(result.gate).toBe('C12');
  });

  it('reports a missing flight instead of throwing', async () => {
    const result: any = await dispatch('get_flight_status', { flight_number: 'UA9999' }, '', '');
    expect(result.found).toBe(false);
  });

  // A chip carries no arguments. If flight_number were required, the chip would
  // stall on a "which flight?" clarify instead of answering.
  it('falls back to the next departing flight when none is named', async () => {
    const status: any = await dispatch('get_flight_status', {}, '', 'unknown-sub');
    expect(status.found).toBe(true);
    expect(status.usedNextFlight).toBe(true);
    expect(status.flightNumber).toBe('UA328');

    const seats: any = await dispatch('check_seat_availability', {}, '', 'unknown-sub');
    expect(seats.flightNumber).toBe('UA328');
    expect(seats.usedNextFlight).toBe(true);
  });

  it('returns only available seats by default', async () => {
    const result: any = await dispatch('check_seat_availability', { flight_number: 'UA328' }, '', '');
    expect(result.seats.every((s: any) => s.available)).toBe(true);

    const all: any = await dispatch('check_seat_availability', { flight_number: 'UA328', available_only: false }, '', '');
    expect(all.seatCount).toBeGreaterThan(result.seatCount);
  });
});
