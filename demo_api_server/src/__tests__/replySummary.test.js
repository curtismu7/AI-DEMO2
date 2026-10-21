const { enrichCannedReply, isCannedReply } = require('../../services/replySummary');
const { __test } = require('../../services/demoAgentLangGraphService');

const permits = [
  { id: 'P-1', permitType: 'Building', status: 'Active', issuedDate: '2026-02-10', expiresDate: '2026-12-01' },
  { id: 'P-2', permitType: 'Electrical', status: 'Pending', expiresDate: '2027-01-15' },
  { id: 'P-3', permitType: 'Signage', status: 'Active' },
  { id: 'P-4', permitType: 'Plumbing', status: 'Expired' },
];

describe('isCannedReply', () => {
  test.each([
    ['Here are your permits.', true],
    ['Here is your Patient Records.', true],
    ['Your pay fee request is complete.', true],
    ['Here are your Activity (10 total).', true],
    ['You have 2 upcoming trips: UA328.', false],
    ['Order placed for Headphones ($100).', false],
  ])('%s -> %s', (reply, expected) => expect(isCannedReply(reply)).toBe(expected));
});

describe('enrichCannedReply — lists', () => {
  test('shows count plus the first three items, with status, the deadline date and the id', () => {
    const out = enrichCannedReply('Here are your permits.', 'view_permits', { permits, count: 4, render: 'view_permits' });
    expect(out).toBe('Here are your permits (4): Building · Active · expires 2026-12-01 (P-1); Electrical · Pending · expires 2027-01-15 (P-2); Signage · Active (P-3) and 1 more.');
  });

  test('prefers the deadline date over an issued date, and shows ISO timestamps as the date', () => {
    const out = enrichCannedReply('Here are your orders.', 'list_orders', { orders: [{ id: 7, product: 'Boots', status: 'Shipped', createdAt: '2026-10-21T08:00:00Z', dueDate: '2026-10-30' }] });
    expect(out).toContain('Boots · Shipped · due 2026-10-30 (7)');
    const stamp = enrichCannedReply('Here are your orders.', 'list_orders', { orders: [{ id: 7, product: 'Boots', date: '2026-10-21T08:00:00Z' }] });
    expect(stamp).toContain('Boots · 2026-10-21 (7)');
  });

  test('keeps the vertical\'s own noun when the reply was count-only', () => {
    const out = enrichCannedReply('Here are your Activity (2 total).', 'list_orders', { orders: [{ id: 1, product: 'Hat', status: 'Delivered' }, { id: 2, product: 'Cap', status: 'Processing' }] });
    expect(out).toBe('Here are your Activity (2): Hat · Delivered (1); Cap · Processing (2).');
  });

  test('an empty list says so, in the vertical\'s noun', () => {
    expect(enrichCannedReply('Here are your permits.', 'view_permits', { permits: [], count: 0 })).toBe('You have no permits.');
    expect(enrichCannedReply('Here are your Activity (0 total).', 'list_orders', { orders: [] })).toBe('You have no Activity.');
  });

  test('uses the id alone when an item has no label, status or date', () => {
    expect(enrichCannedReply('Here are your things.', 'view_things', { things: [{ id: 'A1' }, { id: 'B2' }] })).toBe('Here are your things (2): A1; B2.');
  });
});

describe('enrichCannedReply — safety', () => {
  test('never expands sensitive_* tools', () => {
    expect(enrichCannedReply('Here are your sensitive tax record.', 'sensitive_tax_record', { records: [{ id: 1, name: 'x' }] })).toBeNull();
  });

  test('never repeats sensitive-looking fields', () => {
    const out = enrichCannedReply('Here are your records.', 'view_records', { records: [{ id: 1, name: 'Alex', ssn: '123-45-6789', cardNumber: '4111111111111111', passportNo: 'X1' }] });
    expect(out).toContain('Alex');
    expect(out).not.toMatch(/123-45|4111|X1|ssn|card|passport/i);
    const rec = enrichCannedReply('Your release record request is complete.', 'release_record', { status: 'Released', accessToken: 'abc', password: 'p' });
    expect(rec).toBe('Your release record request is complete: status Released.');
  });

  test('only replaces canned replies; specific replies come back null', () => {
    expect(enrichCannedReply('You have 2 upcoming trips: UA328.', 'get_airline_bookings', { bookings: [{ id: 1 }] })).toBeNull();
    expect(enrichCannedReply('Here are your permits.', 'view_permits', null)).toBeNull();
    expect(enrichCannedReply('Here are your permits.', 'view_permits', 'text')).toBeNull();
  });
});

describe('enrichCannedReply — writes', () => {
  test('a write that reports false passes its own note through, never "request is complete"', () => {
    expect(enrichCannedReply('Your pay fee request is complete.', 'pay_fee', { paid: false, note: '2500 exceeds tier ceiling 2000' })).toBe('2500 exceeds tier ceiling 2000');
    expect(enrichCannedReply('Your schedule run request is complete.', 'schedule_run', { scheduled: false })).toBeNull();
  });

  test('a successful write adds its first fields to the confirmation', () => {
    expect(enrichCannedReply('Your schedule run request is complete.', 'schedule_run', { runId: 'R-9', status: 'Scheduled', quantity: 240, render: 'x' }))
      .toBe('Your schedule run request is complete: run id R-9 · status Scheduled · quantity 240.');
  });
});

describe('buildVerticalReply uses it end to end (real result shape: { <plural>: [...], count, render })', () => {
  const { buildVerticalReply } = __test;
  test('view_permits is no longer the canned sentence', () => {
    const reply = buildVerticalReply('view_permits', { permits, count: 4, render: 'view_permits' }, 'view_permits', null);
    expect(reply).not.toBe('Here are your permits.');
    expect(reply).toMatch(/^Here are your permits \(4\): Building/);
  });
  test('replies that were already specific are unchanged', () => {
    expect(buildVerticalReply('order_status', { order: { product: 'Headphones', status: 'Processing' } }, 'order_status', null)).toBe('Your Headphones is Processing.');
  });
  test('empty data still gives the old sentence (nothing to say)', () => {
    expect(buildVerticalReply('view_permits', {}, 'text', null)).toBe('Here are your permits.');
  });
});
