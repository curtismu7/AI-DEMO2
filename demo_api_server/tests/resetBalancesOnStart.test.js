'use strict';
const { resetBalancesOnStart, isEnabled } = require('../services/resetBalancesOnStart');

const quiet = { log: jest.fn(), warn: jest.fn() };
function makeDeps({ users, accounts = {}, vertical = {}, provision = jest.fn(async () => []), env = {} }) {
  return {
    dataStore: { getAllUsers: () => users.map((id) => ({ id })), getAccountsByUserId: (id) => accounts[id] || [] },
    getVertical: async (id) => vertical[id] ?? null,
    provision, env, log: quiet,
  };
}

describe('resetBalancesOnStart', () => {
  test('re-provisions each banking user who has accounts, in order', async () => {
    const provision = jest.fn(async () => []);
    const r = await resetBalancesOnStart(makeDeps({ users: ['a', 'b'], accounts: { a: [{}], b: [{}] }, provision }));
    expect(provision.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(r).toEqual({ enabled: true, reset: 2, skipped: 0, failed: 0 });
  });

  test('skips a user with no accounts (nothing to reset, nothing created for them)', async () => {
    const provision = jest.fn();
    const r = await resetBalancesOnStart(makeDeps({ users: ['a'], accounts: {}, provision }));
    expect(provision).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  test('skips a user whose live data belongs to another vertical, resets banking and unknown ones', async () => {
    const provision = jest.fn(async () => []);
    const r = await resetBalancesOnStart(makeDeps({
      users: ['h', 'b', 'u'], accounts: { h: [{}], b: [{}], u: [{}] }, vertical: { h: 'healthcare', b: 'banking' }, provision,
    }));
    expect(provision.mock.calls.map((c) => c[0])).toEqual(['b', 'u']);
    expect(r).toMatchObject({ reset: 2, skipped: 1 });
  });

  test.each(['0', 'false', 'OFF', ' no '])('DEMO_RESET_BALANCES_ON_START=%p turns it off and touches nothing', async (v) => {
    const provision = jest.fn();
    const r = await resetBalancesOnStart(makeDeps({ users: ['a'], accounts: { a: [{}] }, provision, env: { DEMO_RESET_BALANCES_ON_START: v } }));
    expect(provision).not.toHaveBeenCalled();
    expect(r.enabled).toBe(false);
  });

  test('on by default, and for 1/true/empty', () => {
    expect(isEnabled({})).toBe(true);
    for (const v of ['1', 'true', '']) expect(isEnabled({ DEMO_RESET_BALANCES_ON_START: v })).toBe(true);
  });

  test('one user failing is counted and logged; the others are still reset and nothing throws', async () => {
    const provision = jest.fn(async (id) => { if (id === 'a') throw new Error('store busy'); return []; });
    const r = await resetBalancesOnStart(makeDeps({ users: ['a', 'b'], accounts: { a: [{}], b: [{}] }, provision }));
    expect(r).toMatchObject({ reset: 1, failed: 1 });
    expect(quiet.warn).toHaveBeenCalledWith(expect.stringContaining('store busy'));
  });
});
