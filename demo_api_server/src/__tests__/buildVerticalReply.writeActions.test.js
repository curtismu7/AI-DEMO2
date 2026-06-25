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
    expect(buildVerticalReply('view_records', { records: [] }, 'view_records', null))
      .toBe('Here is your records.');
  });
});
