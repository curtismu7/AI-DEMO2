// Regression: vertical WRITE/confirmation actions (book_appointment, etc.) must
// produce a real confirmation reply, not the read-style "Here are your <noun>."
// fallback that mangled the action name into "Here are your book appointment."
// (CareConnect "Book an appointment" -> clarify -> broken reply + empty card).
const { __test } = require('../../services/demoAgentLangGraphService');
const { buildVerticalReply } = __test;

describe('buildVerticalReply — write/confirmation actions', () => {
  test('book_appointment confirms with provider and when', () => {
    const data = { id: 'appt-new-1', provider: 'Dr. Smith', when: 'Friday', status: 'Confirmed' };
    expect(buildVerticalReply('book_appointment', data, 'book_appointment', null))
      .toBe('Your appointment with Dr. Smith on Friday is confirmed.');
  });

  test('book_appointment degrades gracefully when data is empty (never "Here are your book appointment.")', () => {
    const reply = buildVerticalReply('book_appointment', {}, 'book_appointment', null);
    expect(reply).toBe('Your appointment is confirmed.');
    expect(reply).not.toMatch(/here are your/i);
    expect(reply).not.toContain('book appointment');
  });

  // On a failed MCP round-trip `render` degrades to 'text' while `action` stays
  // 'book_appointment' (the exact screenshot scenario). The confirmation must
  // still hold off the action — NOT fall through to the noun fallback.
  test('book_appointment confirmation holds even when render has degraded to "text"', () => {
    expect(buildVerticalReply('book_appointment', {}, 'text', null))
      .toBe('Your appointment is confirmed.');
    expect(buildVerticalReply('book_appointment', { provider: 'Dr. Smith', when: 'Friday' }, 'text', null))
      .toBe('Your appointment with Dr. Smith on Friday is confirmed.');
  });

  test('release_records confirms with record id', () => {
    expect(buildVerticalReply('release_records', { id: '102', status: 'Released' }, 'release_records', null))
      .toBe('Your record (102) has been released.');
  });

  test('checkout confirms product and amount', () => {
    expect(buildVerticalReply('checkout', { id: 'ord-new-1', product: 'laptop', amount: 999 }, 'checkout', null))
      .toBe('Order placed for laptop ($999).');
  });

  test('submit_expense confirms category and amount', () => {
    expect(buildVerticalReply('submit_expense', { id: 'exp-new-1', category: 'taxi', amount: 45 }, 'submit_expense', null))
      .toBe('Expense submitted for taxi ($45).');
  });

  test('request_time_off confirms days and remaining (singular/plural)', () => {
    expect(buildVerticalReply('request_time_off', { days: 3, remaining: 7 }, 'request_time_off', null))
      .toBe('Time-off request for 3 days submitted. 7 days remaining.');
    expect(buildVerticalReply('request_time_off', { days: 1, remaining: 1 }, 'request_time_off', null))
      .toBe('Time-off request for 1 day submitted. 1 day remaining.');
  });

  // Read actions must be unchanged (regression guard for the existing branches).
  test('read actions still use the "Here ... your" phrasing', () => {
    expect(buildVerticalReply('list_appointments', { appointments: [{}] }, 'list_appointments', null))
      .toBe('Here are your appointments (1 total).');
    // An empty list now says so ("Here is your records." was ungrammatical and said nothing about the data).
    expect(buildVerticalReply('view_records', { records: [] }, 'view_records', null))
      .toBe('You have no records.');
  });
});

// The 71-across-12-verticals half (TECH_DEBT 2026-08-19): every write action
// WITHOUT a hand-written case above used to fall through to "Here are your
// <verb noun>." — "Here are your withdraw.", "Here are your pay bill.".
// Write-ness is derived from scope-topology.json, so this sweeps the whole
// tools section rather than listing actions that would drift.
describe('buildVerticalReply — generic write confirmation (no hand-written case)', () => {
  const { getRequiredTier } = require('../../services/agentRestrictionsService');
  const scopeTopology = require('../../services/scopeTopology')._manifest();

  // (redeem_miles used to be in this table; it now has a hand-written airlines reply, tested below.)
  test.each([
    ['pay_bill', 'Your pay bill request is complete.'],
    ['withdraw', 'Your withdraw request is complete.'],
    ['transfer', 'Your transfer request is complete.'],
    ['cancel_order', 'Your cancel order request is complete.'],
    ['buy_security', 'Your buy security request is complete.'],
  ])('%s gets a write confirmation, not "Here are your ..."', (action, expected) => {
    expect(buildVerticalReply(action, {}, 'text', null)).toBe(expected);
  });

  // The whole-catalog gate: no write tool anywhere may produce a read heading.
  test('no write tool in scope-topology.json falls through to "Here are your ..."', () => {
    const writeTools = Object.keys(scopeTopology.tools || {})
      .filter((t) => getRequiredTier(t) === 'write');
    expect(writeTools.length).toBeGreaterThan(50); // vacuity guard
    const broken = writeTools
      .map((t) => [t, buildVerticalReply(t, {}, 'text', null)])
      .filter(([, reply]) => /^Here are your /.test(reply));
    expect(broken).toEqual([]);
  });

  // The trap the entry names: a name-based "no read verb => write" rule would
  // misclassify these genuine reads. Derivation from scope-topology must not.
  test.each(['afford_check', 'biggest_purchase', 'browse_gear', 'loyalty_balance'])(
    '%s is NOT treated as a write',
    (action) => {
      expect(getRequiredTier(action)).toBe('read');
      expect(buildVerticalReply(action, {}, 'text', null)).not.toMatch(/request is complete/);
    },
  );
});

// Airlines get_loyalty_status returns { loyaltyTier, loyaltyPoints } — not the
// { points | balance } shape the loyalty_balance render reads — so the reply was
// the data-free "Here are your loyalty status." (observed live, personal-agent page).
describe('buildVerticalReply — get_loyalty_status (airlines)', () => {
  test('states the tier and miles from the tool result', () => {
    const data = { loyaltyTier: 'Gold', loyaltyPoints: 48250, name: 'Pat', passengerRef: 'P1' };
    expect(buildVerticalReply('get_loyalty_status', data, 'text', null))
      .toBe('Your MileagePlus status: Gold · 48,250 miles.');
  });

  test('works with only a tier, or only miles', () => {
    expect(buildVerticalReply('get_loyalty_status', { loyaltyTier: 'Silver' }, 'text', null))
      .toBe('Your MileagePlus status: Silver.');
    expect(buildVerticalReply('get_loyalty_status', { loyaltyPoints: 1200 }, 'text', null))
      .toBe('Your MileagePlus status · 1,200 miles.');
  });

  test('passes through the not-found note instead of inventing a status', () => {
    const data = { found: false, note: 'No passenger records in the airlines database.' };
    expect(buildVerticalReply('get_loyalty_status', data, 'text', null)).toBe(data.note);
  });

  test('never falls back to "Here are your loyalty status."', () => {
    for (const data of [{}, null, undefined, { loyaltyTier: 'Gold' }]) {
      expect(buildVerticalReply('get_loyalty_status', data, 'text', null)).not.toMatch(/here are your/i);
    }
  });
});

// Airlines get_flight_status returns { flightNumber, route, status, departureTime, gate,
// usedNextFlight } and declares no render, so the reply was the data-free
// "Here are your flight status." (observed live, personal-agent page).
describe('buildVerticalReply — get_flight_status (airlines)', () => {
  const flight = {
    found: true, usedNextFlight: false, flightNumber: 'UA328', route: 'ORD to SFO',
    departureTime: '2026-08-15T08:40:00-05:00', arrivalTime: '2026-08-15T11:25:00-07:00',
    gate: 'C12', aircraft: 'Boeing 737 MAX 9', status: 'On Time',
  };

  test('states flight, route, status, departure (as written) and gate', () => {
    expect(buildVerticalReply('get_flight_status', flight, 'text', null))
      .toBe('UA328 (ORD to SFO): On Time · departs Aug 15, 08:40 · gate C12.');
  });

  test('says "Your next flight" when the tool defaulted to it', () => {
    expect(buildVerticalReply('get_flight_status', { ...flight, usedNextFlight: true }, 'text', null))
      .toBe('Your next flight, UA328 (ORD to SFO): On Time · departs Aug 15, 08:40 · gate C12.');
  });

  test('omits what the tool did not return instead of inventing it', () => {
    expect(buildVerticalReply('get_flight_status', { flightNumber: 'UA9', status: 'Delayed' }, 'text', null))
      .toBe('UA9: Delayed.');
  });

  test('passes through the not-found note', () => {
    const data = { found: false, note: 'No flight UA999 in the airlines database.' };
    expect(buildVerticalReply('get_flight_status', data, 'text', null)).toBe(data.note);
  });

  test('never falls back to "Here are your flight status."', () => {
    for (const data of [{}, null, undefined, { flightNumber: 'UA1' }]) {
      expect(buildVerticalReply('get_flight_status', data, 'text', null)).not.toMatch(/here are your/i);
    }
  });
});

// Every airlines tool returns a result shaped for its own card. None matched the generic shape the noun fallback
// reads, so each answered "Here are your <tool name>." / "Your <tool name> request is complete." with no data, and a
// failed write (paid / booked / cancelled / redeemed === false) was reported as complete.
describe('buildVerticalReply — airlines tools', () => {
  const reply = (action, data) => buildVerticalReply(action, data, action, null);
  const booking = { confirmationNumber: 'ABC123', flightNumber: 'UA328', route: 'ORD to SFO', departureTime: '2026-08-15T08:40:00-05:00', status: 'Confirmed' };
  const generic = /here are your|request is complete/i;

  test('bookings list the trips with route, local departure and confirmation', () => {
    const data = { upcomingTrips: 2, bookings: [booking, { ...booking, confirmationNumber: 'DEF456', flightNumber: 'UA1147', route: 'SFO to EWR', departureTime: '2026-09-03T14:10:00-07:00' }] };
    expect(reply('get_airline_bookings', data)).toBe('You have 2 upcoming trips: UA328, ORD to SFO, Aug 15, 08:40 (ABC123); UA1147, SFO to EWR, Sep 3, 14:10 (DEF456).');
    expect(reply('sensitive_airline_bookings', { bookings: [booking] })).toBe('You have 1 upcoming trip: UA328, ORD to SFO, Aug 15, 08:40 (ABC123).');
  });

  test('bookings cap the list at three and say how many more', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...booking, confirmationNumber: 'C' + i }));
    expect(reply('get_airline_bookings', { bookings: many })).toMatch(/5 upcoming trips: .*; and 2 more\.$/);
  });

  test('no bookings: the tool note, or a plain statement', () => {
    expect(reply('get_airline_bookings', { bookings: [], note: 'No passenger records in the airlines database.' })).toBe('No passenger records in the airlines database.');
    expect(reply('get_airline_bookings', { bookings: [] })).toBe('You have no upcoming trips.');
  });

  test('cancel: confirmation, refund and the demo caveat; a failure passes the note through', () => {
    const ok = reply('cancel_airline_reservation', { cancelled: true, simulated: true, confirmationNumber: 'ABC123', flightNumber: 'UA328', route: 'ORD to SFO', refund: { status: 'initiated', method: 'original form of payment' } });
    expect(ok).toBe('Cancellation recorded for reservation ABC123 (UA328, ORD to SFO). Refund initiated to the original form of payment. Demo: the reservation is left in place so it can be replayed.');
    expect(reply('cancel_airline_reservation', { cancelled: false, note: 'No reservation ZZZ999 for this passenger.' })).toBe('No reservation ZZZ999 for this passenger.');
  });

  test('pay fee: amount, type and receipt; a failed payment is NOT reported as complete', () => {
    expect(reply('pay_airline_fee', { paid: true, receiptId: 'rcpt_91', feeType: 'bag', amount: 35 })).toBe('Paid $35.00 bag fee — receipt rcpt_91.');
    const failed = reply('pay_airline_fee', { paid: false, note: 'A positive fee amount is required.' });
    expect(failed).toBe('A positive fee amount is required.');
    expect(failed).not.toMatch(generic);
  });

  test('book flight: flight, local departure, confirmation, cabin and price; failures pass the note through', () => {
    expect(reply('book_airline_flight', { booked: true, confirmationNumber: 'XYZ789', flightNumber: 'UA502', route: 'SFO to JFK', departureTime: '2026-09-03T14:10:00-07:00', cabin: 'Economy', amount: 346 }))
      .toBe('Booked UA502 (SFO to JFK), departing Sep 3, 14:10 — confirmation XYZ789, Economy, $346.00.');
    expect(reply('book_airline_flight', { booked: false, note: 'No flight UA999 in the airlines database.' })).toBe('No flight UA999 in the airlines database.');
  });

  test('seat map: how many seats are free, for the named flight', () => {
    const seats = [{ seat: '1A', available: true }, { seat: '1B', available: false }, { seat: '14A', available: true }];
    expect(reply('check_seat_availability', { flightNumber: 'UA328', availableOnly: false, seatCount: 3, seats })).toBe('Seat map for UA328: 2 of 3 seats available.');
    expect(reply('check_seat_availability', { flightNumber: 'UA328', usedNextFlight: true, availableOnly: true, seatCount: 1, seats: [seats[0]] })).toBe('Seat map for UA328 (your next flight): 1 seat available.');
    expect(reply('check_seat_availability', { seatCount: 0, seats: [], note: 'No upcoming flight on file — name a flight number.' })).toBe('No upcoming flight on file — name a flight number.');
  });

  test('redeem miles: what was upgraded and the balance left; failures pass the note through', () => {
    expect(reply('redeem_miles', { redeemed: true, confirmationNumber: 'ABC123', flightNumber: 'UA328', previousCabin: 'Economy', upgradedToCabin: 'Business', pointsRedeemed: 25000, pointsRemaining: 23250 }))
      .toBe('Upgraded ABC123 · UA328 from Economy to Business for 25,000 miles; 23,250 miles remaining.');
    expect(reply('redeem_miles', { redeemed: false, note: 'Insufficient miles. 25,000 required, 4,000 available.' })).toBe('Insufficient miles. 25,000 required, 4,000 available.');
  });

  test('passenger record: names the passenger and never repeats a sensitive field', () => {
    const data = { found: true, sensitivity: 'pii', name: 'Pat Rivera', dateOfBirth: '1984-03-09', passportNumber: 'X1234567', knownTravelerNumber: 'KTN998877', loyalty: { tier: 'Gold', points: 48250, accountNumber: 'ML-55-1234' }, paymentCard: { brand: 'Visa', last4: '4242' } };
    const text = reply('sensitive_passenger_record', data);
    expect(text).toBe('Passenger record on file for Pat Rivera (Gold, 48,250 miles). Sensitive fields are not repeated in chat.');
    for (const secret of ['1984', 'X1234567', 'KTN998877', 'ML-55-1234', '4242']) expect(text).not.toContain(secret);
    expect(reply('sensitive_passenger_record', { found: false, note: 'No passenger record on file for P1.' })).toBe('No passenger record on file for P1.');
  });

  test('missing or empty data never falls back to the generic sentence', () => {
    for (const action of ['get_airline_bookings', 'sensitive_airline_bookings', 'cancel_airline_reservation', 'pay_airline_fee', 'book_airline_flight', 'check_seat_availability', 'redeem_miles', 'sensitive_passenger_record']) {
      for (const data of [{}, null, undefined]) expect(`${action}: ${reply(action, data)}`).not.toMatch(generic);
    }
  });

  test('other verticals are untouched', () => {
    expect(buildVerticalReply('checkout', { product: 'Tent', amount: 99 }, 'text', null)).toBe('Order placed for Tent ($99).');
  });
});
