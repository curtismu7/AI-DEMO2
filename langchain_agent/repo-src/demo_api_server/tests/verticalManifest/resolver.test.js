jest.mock('../../services/lmdb/openEnv', () => {
  const dbs = new Map();
  function openDB(name) {
    if (!dbs.has(name)) dbs.set(name, new Map());
    const m = dbs.get(name);
    return {
      get(key) { return m.has(key) ? m.get(key) : undefined; },
      putSync(key, value) { m.set(key, value); },
      removeSync(key) { m.delete(key); },
      getRange({ start, end } = {}) {
        const out = [];
        for (const [key, value] of m.entries()) {
          if (start !== undefined && key < start) continue;
          if (end !== undefined && key >= end) continue;
          out.push({ key, value });
        }
        return out;
      },
    };
  }
  return {
    openEnv: () => ({ openDB }),
    getDb: (name) => openDB(name),
    LMDB_PATH: '/tmp/fake',
    __reset: () => dbs.clear(),
  };
});

// CR-01 bridge: resolver falls back to configStore.active_vertical when LMDB
// is empty. Mock with controllable state so tests don't pick up the real
// configStore default ('banking').
const _configStoreState = { active_vertical: null };
jest.mock('../../services/configStore', () => ({
  getEffective: (key) => _configStoreState[key] || null,
  setConfig: (data) => Object.assign(_configStoreState, data),
}));

const store = require('../../services/lmdb/verticalStore.lmdb');
const { createOverlay } = require('../../services/verticalManifest/overlay');
const { createResolver } = require('../../services/verticalManifest/resolver');
const openEnvMock = require('../../services/lmdb/openEnv');

const SEED = {
  id: 'demo', schemaVersion: 3,
  identity: { displayName: 'Demo', tagline: 'seed' },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'A' },
  dashboard: {
    kind: 'banking',
    chips: [{ key: 'a', label: 'A' }],
    hero: { cards: [] },
    llmChipGroups: {},
  },
};
const fakeLoader = { get: (id) => id === 'demo' ? { manifest: SEED } : null };

describe('resolver', () => {
  let resolver, overlay;
  beforeEach(() => {
    openEnvMock.__reset();
    _configStoreState.active_vertical = null;
    overlay = createOverlay(store, fakeLoader);
    resolver = createResolver(fakeLoader, overlay, store, { onEvent: () => {} });
  });

  test('resolve with no overlay returns seed (and result is isolated from later overlay writes)', () => {
    const m = resolver.resolve('demo');
    expect(m.identity.tagline).toBe('seed');
    // Mutating the returned manifest must not pollute the cache, because the
    // next resolve(demo) after no overlay change should still return 'seed'.
    m.identity.tagline = 'mutated';
    expect(resolver.resolve('demo').identity.tagline).toBe('seed');
  });

  test('resolve with overlay deep-merges', () => {
    resolver.overlay.setField('demo', 'identity.tagline', 'overridden');
    expect(resolver.resolve('demo').identity.tagline).toBe('overridden');
    expect(resolver.resolve('demo').identity.displayName).toBe('Demo');
  });

  test('array overlay replaces wholesale', () => {
    resolver.overlay.setField('demo', 'dashboard.chips', [{ key: 'z', label: 'Z' }]);
    expect(resolver.resolve('demo').dashboard.chips).toEqual([{ key: 'z', label: 'Z' }]);
  });

  test('Zod defaults applied AFTER merge (scopes)', () => {
    expect(resolver.resolve('demo').scopes.read).toBe('read');
  });

  test('cache invalidates on overlay write through wrapped overlay', () => {
    const m1 = resolver.resolve('demo');
    resolver.overlay.setField('demo', 'identity.tagline', 'new');
    const m2 = resolver.resolve('demo');
    expect(m1.identity.tagline).toBe('seed');
    expect(m2.identity.tagline).toBe('new');
  });

  test('activeId getter/setter; setActive fires onEvent', () => {
    const events = [];
    const r2 = createResolver(fakeLoader, overlay, store, { onEvent: (t, p) => events.push([t, p]) });
    expect(r2.activeId()).toBeNull();
    r2.setActive('demo');
    expect(r2.activeId()).toBe('demo');
    expect(events).toEqual([['vertical-switched', { activeId: 'demo' }]]);
  });

  test('CR-01 bridge: activeId falls back to configStore.active_vertical when LMDB empty', () => {
    _configStoreState.active_vertical = 'demo';
    const r2 = createResolver(fakeLoader, overlay, store, { onEvent: () => {} });
    expect(r2.activeId()).toBe('demo');
  });

  test('CR-01 bridge: setActive mirrors to configStore.active_vertical', () => {
    const r2 = createResolver(fakeLoader, overlay, store, { onEvent: () => {} });
    r2.setActive('demo');
    expect(_configStoreState.active_vertical).toBe('demo');
  });

  test('CR-01 bridge: LMDB takes precedence over configStore when both set', () => {
    _configStoreState.active_vertical = 'demo';
    store.setActiveId('demo');
    // Now imagine a divergence where someone wrote different values
    store.setActiveId('demo');           // LMDB authoritative
    _configStoreState.active_vertical = 'something-else';
    const r2 = createResolver(fakeLoader, overlay, store, { onEvent: () => {} });
    expect(r2.activeId()).toBe('demo');
  });

  test('wrapped overlay fires vertical-edited on setField / setBatch / clearField / clearAll', () => {
    const events = [];
    const r2 = createResolver(fakeLoader, overlay, store, { onEvent: (t, p) => events.push([t, p]) });
    r2.overlay.setField('demo', 'identity.tagline', 'X');
    r2.overlay.setBatch('demo', [{ path: 'identity.headerTitle', value: 'Y' }]);
    r2.overlay.clearField('demo', 'identity.tagline');
    r2.overlay.clearAll('demo');
    const types = events.map(([t]) => t);
    expect(types).toEqual([
      'vertical-edited', 'vertical-edited', 'vertical-edited', 'vertical-edited',
    ]);
    expect(events[0][1]).toEqual({ id: 'demo' });
  });

  test('resolve returns null for unknown id', () => {
    expect(resolver.resolve('nope')).toBeNull();
  });

  test('removeFromCache evicts both resolver cache and loader entry', () => {
    resolver.resolve('demo');
    resolver.removeFromCache('demo');
    // After removal, the (fake) loader still returns SEED so resolve still works.
    // The contract is just that the cache and version were cleared. Smoke-check:
    expect(resolver.resolve('demo').identity.tagline).toBe('seed');
  });
});
