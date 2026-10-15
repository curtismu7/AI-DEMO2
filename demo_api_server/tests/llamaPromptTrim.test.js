'use strict';

const { selectTools, LLAMACPP_MAX_TOOLS } = require('../services/llamaPromptTrim');

const tool = (name, description) => ({ name, description });
const TOOLS = [
  tool('pay_airline_fee', 'Pay a United change, checked-bag, or seat-upgrade fee.'),
  tool('book_airline_flight', 'Book a United flight.'),
  tool('get_airline_bookings', 'List the traveller upcoming bookings.'),
  tool('get_loyalty_status', 'Read MileagePlus loyalty tier and miles balance.'),
  tool('redeem_miles', 'Redeem miles for an award.'),
  tool('check_seat_availability', 'Check open seats on a flight.'),
  tool('get_flight_status', 'Look up flight status.'),
];

describe('selectTools', () => {
  it('keeps the tools the question points at, best match first', () => {
    const picked = selectTools(TOOLS, 'what is my miles balance and loyalty tier');
    expect(picked).toHaveLength(LLAMACPP_MAX_TOOLS);
    expect(picked[0].name).toBe('get_loyalty_status');
  });

  it('with no matching words keeps the first tools in their original order', () => {
    expect(selectTools(TOOLS, 'zzz').map((t) => t.name)).toEqual(TOOLS.slice(0, LLAMACPP_MAX_TOOLS).map((t) => t.name));
  });

  it('leaves a short list alone and does not modify the input', () => {
    const short = TOOLS.slice(0, 3);
    expect(selectTools(short, 'book a flight')).toBe(short);
    const before = JSON.stringify(TOOLS);
    selectTools(TOOLS, 'book a flight');
    expect(JSON.stringify(TOOLS)).toBe(before);
  });

  it('handles OpenAI-style function tools and a non-array', () => {
    const fn = TOOLS.map((t) => ({ type: 'function', function: t }));
    expect(selectTools(fn, 'redeem my miles')[0].function.name).toBe('redeem_miles');
    expect(selectTools(undefined, 'x')).toBeUndefined();
  });
});
