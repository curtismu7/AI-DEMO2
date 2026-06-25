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
});
