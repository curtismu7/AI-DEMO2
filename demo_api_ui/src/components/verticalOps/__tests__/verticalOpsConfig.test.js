// __tests__/verticalOpsConfig.test.js
import { VERTICAL_ORDER, getVerticalConfig } from '../verticalOpsConfig';

describe('verticalOpsConfig', () => {
  it('has all five verticals in order', () => {
    expect(VERTICAL_ORDER).toEqual(['banking','healthcare','retail','sporting-goods','workforce']);
  });

  it('each config has required fields and a theme', () => {
    for (const id of VERTICAL_ORDER) {
      const c = getVerticalConfig(id);
      expect(c.id).toBe(id);
      expect(typeof c.name).toBe('string');
      expect(c.theme.accent).toMatch(/^#/);
      expect(c.lookupPath).toBe(`/api/admin/${id}/lookup`);
      expect(typeof c.adaptLookup).toBe('function');
    }
  });

  it('healthcare adaptLookup maps the user + data slices into customer + categories', () => {
    const c = getVerticalConfig('healthcare');
    const out = c.adaptLookup({
      user: { id: 'u1', name: 'Maya Chen', email: 'maya@x.com', username: 'maya' },
      data: { appointments: [{ id: 'a1', provider: 'Dr Park', reason: 'Follow-up', status: 'Scheduled' }], medications: null },
    });
    expect(out.customer.name).toBe('Maya Chen');
    const appts = out.categories.find((x) => x.id === 'appointments');
    expect(appts.rows[0].id).toBe('a1');
    expect(appts.rows[0].actions).toContain('Cancel');
  });

  it('banking adaptLookup synthesizes a customer from account-centric response', () => {
    const c = getVerticalConfig('banking');
    const out = c.adaptLookup({ accounts: [{ id: 'ac1', accountNumber: '****4821', type: 'Checking', balance: 4210.55 }], transactions: [] });
    expect(out.categories.find((x) => x.id === 'accounts').rows[0].id).toBe('ac1');
    expect(out.customer).toBeTruthy();
  });
});
