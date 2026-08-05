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
    expect(SUPPORTED_SCOPES).toEqual(expect.arrayContaining(['invest:read', 'airlines:read', 'pnr:read']));
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

  /**
   * The A2A claim, enforced structurally rather than by wording: the sensitive
   * record is gated on `pnr:read`, which only the Passenger Records Specialist's
   * Exchange #2 bearer carries. A session token holding every ordinary airlines
   * scope still cannot see the tool, so the chip CANNOT be answered by an
   * ordinary consent read — the delegation chain is the only path to it.
   */
  it('the sensitive record is reachable only with the A2A specialist scope', () => {
    expect(findTool('sensitive_passenger_record')!.requiredScopes).toEqual(['pnr:read']);

    const ordinary = filterByScopes(ALL_TOOLS, ['airlines:read', 'airlines:write', 'read'])
      .map((t) => t.name);
    expect(ordinary).not.toContain('sensitive_passenger_record');

    const specialist = filterByScopes(ALL_TOOLS, ['pnr:read']).map((t) => t.name);
    expect(specialist).toEqual(['sensitive_passenger_record']);
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
    expect(result.provenance).toEqual(expect.objectContaining({
      backend: 'United Reservations DB',
      engine: 'SQLite',
      database: 'airlines.db',
      tool: 'get_airline_bookings',
      recordCount: 2,
      tables: ['passengers', 'bookings', 'flights'],
    }));
    expect(result.provenance.queryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(Number.isNaN(Date.parse(result.provenance.queriedAt))).toBe(false);
    expect(result.provenance.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('stamps the sensitive booking tool name into its query receipt', async () => {
    const result: any = await dispatch('sensitive_airline_bookings', {}, '', 'unknown-sub');
    expect(result.provenance.tool).toBe('sensitive_airline_bookings');
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

  it('returns the passenger PII the reservation tools never expose', async () => {
    const result: any = await dispatch('sensitive_passenger_record', {}, '', 'unknown-sub');
    expect(result.source).toBe('sqlite');
    expect(result.found).toBe(true);
    expect(result.passportNumber).toBe('X4820913');
    expect(result.paymentCard.last4).toBe('4417');
    expect(result.loyalty.accountNumber).toBe('MP-4453-8821');
    expect(result.pnrs).toEqual(['K7XR2M', 'P4QW9B']);

    // The claim this tool exists to make: the same passenger's ordinary
    // reservation read carries none of it.
    const bookings = JSON.stringify(await dispatch('get_airline_bookings', {}, '', 'unknown-sub'));
    expect(bookings).not.toContain('X4820913');
    expect(bookings).not.toContain('MP-4453-8821');
    expect(bookings).not.toContain('4417');
  });
});

describe('pay_airline_fee', () => {
  it('is invisible to a read-only airlines token', () => {
    const readOnly = filterByScopes(ALL_TOOLS, ['airlines:read']).map((t) => t.name);
    expect(readOnly).not.toContain('pay_airline_fee');
  });

  it('appears once the token also carries airlines:write', () => {
    const writer = filterByScopes(ALL_TOOLS, ['airlines:read', 'airlines:write']).map((t) => t.name);
    expect(writer).toContain('pay_airline_fee');
    expect(writer).toContain('cancel_airline_reservation');
  });

  it('records the payment and echoes the amount back in dollars', async () => {
    const result: any = await dispatch('pay_airline_fee', { amount: 300, fee_type: 'change' }, '', 'unknown-sub');
    expect(result.source).toBe('sqlite');
    expect(result.paid).toBe(true);
    expect(result.amount).toBe(300);
    expect(result.feeType).toBe('change');
    expect(result.receiptId).toBeGreaterThan(0);
  });

  it('defaults the fee type and attaches the next trip when none is named', async () => {
    const result: any = await dispatch('pay_airline_fee', { amount: 42.5 }, '', 'unknown-sub');
    expect(result.feeType).toBe('change');
    expect(result.confirmationNumber).toBe('K7XR2M');
    expect(result.amount).toBe(42.5);
  });

  it('rejects a non-positive amount instead of writing a row', async () => {
    const result: any = await dispatch('pay_airline_fee', { amount: 0 }, '', 'unknown-sub');
    expect(result.paid).toBe(false);
    expect(result.note).toMatch(/amount/i);
  });
});
