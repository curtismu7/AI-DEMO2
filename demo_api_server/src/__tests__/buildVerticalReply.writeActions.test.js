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

// The 71-across-12-verticals half (TECH_DEBT 2026-08-19): every write action
// WITHOUT a hand-written case above used to fall through to "Here are your
// <verb noun>." — "Here are your withdraw.", "Here are your pay bill.".
// Write-ness is derived from scope-topology.json, so this sweeps the whole
// tools section rather than listing actions that would drift.
describe('buildVerticalReply — generic write confirmation (no hand-written case)', () => {
  const { getRequiredTier } = require('../../services/agentRestrictionsService');
  const scopeTopology = require('../../services/scopeTopology')._manifest();

  test.each([
    ['pay_bill', 'Your pay bill request is complete.'],
    ['withdraw', 'Your withdraw request is complete.'],
    ['transfer', 'Your transfer request is complete.'],
    ['redeem_miles', 'Your redeem miles request is complete.'],
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
