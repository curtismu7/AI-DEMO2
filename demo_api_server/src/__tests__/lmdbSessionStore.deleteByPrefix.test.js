'use strict';

/**
 * deleteByPrefix() — bulk-delete for agent:<id>:* synthetic keys.
 * killSwitchService's invalidateSessionsInRedis() uses this on LmdbSessionStore
 * (no Redis SCAN equivalent otherwise). See REGRESSION_PLAN.md §4, 2026-08-10.
 */

const { LmdbSessionStore } = require('../../services/lmdb/sessionStore');

// Build a store without opening LMDB (skip the constructor) and inject a fake db
// backed by a real Map, so getRange()/removeSync() behave like the real thing.
function makeStore() {
  const backing = new Map();
  const db = {
    get: (key) => backing.get(key),
    putSync: (key, value) => backing.set(key, value),
    removeSync: (key) => backing.delete(key),
    getRange: () => Array.from(backing.entries()).map(([key, value]) => ({ key, value })),
  };
  const store = Object.create(LmdbSessionStore.prototype);
  store.ttl = 24 * 60 * 60 * 1000;
  store._db = db;
  return { store, backing };
}

describe('LmdbSessionStore.deleteByPrefix', () => {
  test('deletes only keys matching the prefix, returns the count', () => {
    const { store, backing } = makeStore();
    backing.set('agent:agent-1:revoked', { revoked: true });
    backing.set('agent:agent-1:requests', { n: 3 });
    backing.set('agent:agent-2:revoked', { revoked: true }); // different agent — must survive
    backing.set('s:some-real-session-id', { cookie: {} }); // real session — must survive

    const count = store.deleteByPrefix('agent:agent-1:');

    expect(count).toBe(2);
    expect(backing.has('agent:agent-1:revoked')).toBe(false);
    expect(backing.has('agent:agent-1:requests')).toBe(false);
    expect(backing.has('agent:agent-2:revoked')).toBe(true);
    expect(backing.has('s:some-real-session-id')).toBe(true);
  });

  test('returns 0 when nothing matches', () => {
    const { store } = makeStore();
    expect(store.deleteByPrefix('agent:nonexistent:')).toBe(0);
  });
});
