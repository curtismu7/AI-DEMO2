const { createWorkforceStore } = require('../../config/verticals/workforce/data');
const { buildWorkforceTools } = require('../../config/verticals/workforce/tools');

describe('workforce tools', () => {
  let store;
  let tools;
  let execute;

  beforeEach(() => {
    store = createWorkforceStore();
    ({ tools, execute } = buildWorkforceTools(store));
  });

  it('declares its own action names (no banking names)', () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['view_benefits', 'pto_balance', 'list_expenses', 'submit_expense', 'request_time_off']));
    expect(names).not.toContain('create_transfer');
  });

  it('scopes from the generic set', () => {
    for (const t of tools) {
      for (const s of t.scopes) {
        expect(['read', 'write', 'transfer', 'expense:read']).toContain(s);
      }
    }
  });

  it('view_benefits returns benefits (table render)', async () => {
    const out = await execute('view_benefits', {}, { userId: 'u' });
    expect(Array.isArray(out.result.benefits)).toBe(true);
    expect(out.render).toBe('view_benefits');
  });

  it('pto_balance returns the pto object (fieldList)', async () => {
    const out = await execute('pto_balance', {}, { userId: 'u' });
    expect(out.result.balance).toBeDefined();
    expect(out.render).toBe('pto_balance');
  });

  it('list_expenses returns expenses (table)', async () => {
    const out = await execute('list_expenses', {}, { userId: 'u' });
    expect(Array.isArray(out.result.expenses)).toBe(true);
  });

  it('submit_expense (write) writes + stepUp+consent authz', async () => {
    const out = await execute('submit_expense', { category: 'Meals', amount: 42 }, { userId: 'u' });
    expect(out.result.status).toBe('Submitted');
    const def = tools.find((t) => t.name === 'submit_expense');
    expect(def.authz).toEqual({ stepUp: true, consent: true });
  });

  it('request_time_off (write) decrements pto + consent authz', async () => {
    const out = await execute('request_time_off', { days: 2 }, { userId: 'u' });
    expect(out.result.remaining).toBeDefined();
    const def = tools.find((t) => t.name === 'request_time_off');
    expect(def.authz).toEqual({ consent: true });
  });

  it('request_time_off surfaces insufficient-balance error', async () => {
    const out = await execute('request_time_off', { days: 999 }, { userId: 'u' });
    expect(out.result.error).toBeDefined();
  });

  it('unknown tool returns error', async () => {
    const out = await execute('nope', {}, { userId: 'u' });
    expect(out.result.error).toMatch(/unknown tool/i);
  });
});
