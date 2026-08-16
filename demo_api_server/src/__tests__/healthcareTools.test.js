const { createHealthcareStore } = require('../../config/verticals/healthcare/data');
const { buildHealthcareTools } = require('../../config/verticals/healthcare/tools');

describe('healthcare tools', () => {
  let store; let tools; let execute;
  beforeEach(() => {
    store = createHealthcareStore();
    ({ tools, execute } = buildHealthcareTools(store));
  });

  it('declares its own action names (no banking names)', () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'view_records', 'view_coverage', 'list_appointments', 'book_appointment', 'release_records',
    ]));
    expect(names).not.toContain('create_transfer');
    expect(names).not.toContain('get_my_accounts');
  });

  it('every tool declares scopes from the generic set', () => {
    for (const t of tools) {
      for (const s of t.scopes) expect(['read', 'write', 'transfer', 'records:read']).toContain(s);
    }
  });

  it('view_coverage returns the coverage object with a fieldList render', async () => {
    const out = await execute('view_coverage', {}, { userId: 'u' });
    expect(out.result.plan).toBe('BlueShield PPO Gold');
    expect(out.render).toBe('view_coverage');
  });

  it('book_appointment (novel action) writes and returns a card render', async () => {
    const out = await execute('book_appointment', { provider: 'Dr. Lee', clinic: 'Downtown', when: '2026-07-01', reason: 'Checkup' }, { userId: 'u' });
    expect(out.result.status).toBe('Confirmed');
    expect(out.render).toBe('book_appointment');
    expect(store.get('u').appointments.some((a) => a.provider === 'Dr. Lee')).toBe(true);
  });

  it('release_records flips status and is gated by authz in the tool def', async () => {
    const recId = store.get('u').patientRecords[0].id;
    const out = await execute('release_records', { recordId: recId }, { userId: 'u' });
    expect(out.result.status).toBe('Released');
    const def = tools.find((t) => t.name === 'release_records');
    expect(def.authz).toEqual({ stepUp: true, consent: true });
  });

  it('unknown tool returns an error result (no throw)', async () => {
    const out = await execute('not_a_tool', {}, { userId: 'u' });
    expect(out.result.error).toMatch(/unknown tool/i);
  });

  it('cancel_appointment accepts a bare "id" param (regression: handler previously only read appointmentId/recordId)', async () => {
    const apptId = store.get('u').appointments[0].id;
    const out = await execute('cancel_appointment', { id: apptId }, { userId: 'u' });
    expect(out.result.status).toBe('Cancelled');
    expect(out.render).toBe('cancel_appointment');
  });

  it('pay_bill with no id defaults to the first outstanding bill, not billingHistory[0] which is already Paid (regression)', async () => {
    const bills = store.get('u').billingHistory;
    expect(bills[0].status).toBe('Paid'); // sanity check on seed data shape
    const firstOutstanding = bills.find((b) => b.status !== 'Paid');
    const out = await execute('pay_bill', { amount: firstOutstanding.amountDue }, { userId: 'u' });
    expect(out.result.id).toBe(firstOutstanding.id);
    expect(out.result.status).toBe('Paid');
    expect(out.render).toBe('pay_bill');
    // The already-paid bill at index 0 must remain untouched.
    expect(bills[0].status).toBe('Paid');
  });

  it('pay_bill with no id and no outstanding bills returns an error instead of re-paying a Paid bill', async () => {
    const bills = store.get('u').billingHistory;
    for (const b of bills) b.status = 'Paid';
    const out = await execute('pay_bill', { amount: 10 }, { userId: 'u' });
    expect(out.result.error).toBe('no outstanding bills');
    expect(out.render).toBe('text');
  });
});
