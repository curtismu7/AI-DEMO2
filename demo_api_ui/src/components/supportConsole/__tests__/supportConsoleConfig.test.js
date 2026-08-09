// __tests__/supportConsoleConfig.test.js
import { CONFIGS, VERTICAL_ORDER, getVerticalConfig } from '../supportConsoleConfig';

// REGRESSION_PLAN §0 — the only emoji permitted anywhere in the UI.
const ALLOWED = ['⚠️', '✅', '❌', '🔐', '✕', '✓', '👤', '🔑', '🪟', '📚'];

function hasDisallowedEmoji(value) {
  let s = String(value);
  for (const ok of ALLOWED) s = s.split(ok).join('');
  return /\p{Extended_Pictographic}/u.test(s);
}

describe('supportConsoleConfig', () => {
  it('has all ten verticals in order', () => {
    expect(VERTICAL_ORDER).toEqual([
      'banking', 'healthcare', 'retail', 'sporting-goods', 'workforce',
      'university', 'government', 'manufacturing', 'investment', 'abercrombie-fitch',
    ]);
  });

  // A card whose slice key is absent from the lookup payload renders an empty
  // list and says nothing about why. The server test asserts the payload; this
  // asserts the config asks for slices by the same names.
  it('every category id is unique within a vertical', () => {
    for (const id of VERTICAL_ORDER) {
      const { categories } = CONFIGS[id].adaptLookup({ user: { id: 'u1', name: 'T' }, data: {} });
      const ids = categories.map((c) => c.id);
      expect(new Set(ids).size, `${id} has duplicate category ids`).toBe(ids.length);
    }
  });

  it('read-only verticals declare no actions', () => {
    for (const id of ['university', 'investment', 'abercrombie-fitch']) {
      expect(Object.keys(CONFIGS[id].actions)).toEqual([]);
      expect(Object.keys(CONFIGS[id].permissions)).toEqual([]);
    }
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

  it('no vertical config value uses an emoji outside the allowlist', () => {
    const offenders = [];
    for (const id of VERTICAL_ORDER) {
      const cfg = CONFIGS[id];
      if (hasDisallowedEmoji(cfg.icon)) offenders.push(`${id}.icon=${cfg.icon}`);
      const { categories } = cfg.adaptLookup({ user: { id: 'u1', name: 'T' }, data: {} });
      for (const c of categories) {
        if (hasDisallowedEmoji(c.icon)) offenders.push(`${id}.${c.id}.icon=${c.icon}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every icon token is one or two uppercase letters', () => {
    for (const id of VERTICAL_ORDER) {
      expect(CONFIGS[id].icon).toMatch(/^[A-Z]{1,2}$/);
    }
  });

  it('healthcare adaptLookup maps the user + data slices into customer + categories', () => {
    const c = getVerticalConfig('healthcare');
    const out = c.adaptLookup({
      user: { id: 'u1', name: 'Maya Chen', email: 'maya@x.com', username: 'maya' },
      data: { appointments: [{ id: 'a1', provider: 'Dr Park', reason: 'Follow-up', status: 'Scheduled' }], medications: null },
    });
    expect(out.customer.name).toBe('Maya Chen');
    expect(out.customer.id).toBe('u1');
    const appts = out.categories.find((x) => x.id === 'appointments');
    expect(appts.rows[0].id).toBe('a1');
    expect(appts.rows[0].actions).toContain('Cancel');
  });

  it('userCentric actions carry userId from customer.id (C1)', () => {
    expect(getVerticalConfig('healthcare').actions['Cancel'].body({ id: 'x' }, { id: 'u1' })).toEqual({ userId: 'u1' });
  });

  it('banking adaptLookup maps the resolved holder + accounts into customer + categories', () => {
    const c = getVerticalConfig('banking');
    const out = c.adaptLookup({
      user: { id: '1', username: 'john.doe', name: 'John Doe', email: 'john@bank.com' },
      data: { accounts: [{ id: 'ac1', accountNumber: '****4821', accountType: 'Checking', balance: 4210.55 }], transactions: [] },
    });
    expect(out.categories.find((x) => x.id === 'accounts').rows[0].id).toBe('ac1');
    expect(out.customer.name).toBe('John Doe');
  });

  it('banking adaptLookup falls back to a generic holder for an account-number-only lookup', () => {
    const c = getVerticalConfig('banking');
    const out = c.adaptLookup({
      user: null,
      data: { accounts: [{ id: 'ac1', accountNumber: '****4821', accountType: 'Checking', balance: 4210.55 }], transactions: [] },
    });
    expect(out.categories.find((x) => x.id === 'accounts').rows[0].id).toBe('ac1');
    expect(out.customer.name).toBe('Account holder');
  });
});
