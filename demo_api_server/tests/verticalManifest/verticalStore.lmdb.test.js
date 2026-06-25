// Mock openEnv with an in-memory Map-backed fake before importing the module.
// The fake mimics the LMDB API surface used by stores: openDB returns an object
// with get/putSync/removeSync/getRange.

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

const store = require('../../services/lmdb/verticalStore.lmdb');
const openEnvMock = require('../../services/lmdb/openEnv');

describe('verticalStore', () => {
  beforeEach(() => { openEnvMock.__reset(); });

  test('overlay get/set/clear round-trip', () => {
    expect(store.getOverlay('healthcare')).toEqual({});
    store.setOverlay('healthcare', { identity: { tagline: 'X' } });
    expect(store.getOverlay('healthcare')).toEqual({ identity: { tagline: 'X' } });
    store.clearOverlay('healthcare');
    expect(store.getOverlay('healthcare')).toEqual({});
  });

  test('active id round-trip', () => {
    expect(store.getActiveId()).toBeNull();
    store.setActiveId('retail');
    expect(store.getActiveId()).toBe('retail');
  });

  test('listOverlayIds returns ids with non-empty overlays', () => {
    store.setOverlay('a', { x: 1 });
    store.setOverlay('b', { y: 2 });
    store.clearOverlay('a');
    expect(store.listOverlayIds().sort()).toEqual(['b']);
  });

  test('listOverlayIds excludes ids with empty-object overlays', () => {
    store.setOverlay('a', {});       // empty object -> should NOT be listed
    store.setOverlay('b', { y: 2 });
    expect(store.listOverlayIds().sort()).toEqual(['b']);
  });

  test('snapshot per-user round-trip', () => {
    expect(store.getSnapshot('user1')).toBeNull();
    const snap = { activeId: 'banking', overlays: { banking: { x: 1 } }, savedAt: 123 };
    store.setSnapshot('user1', snap);
    expect(store.getSnapshot('user1')).toEqual(snap);
    expect(store.getSnapshot('user2')).toBeNull();
    store.clearSnapshot('user1');
    expect(store.getSnapshot('user1')).toBeNull();
  });

  test('clearAll wipes everything', () => {
    store.setOverlay('a', { x: 1 });
    store.setActiveId('a');
    store.setSnapshot('u', { activeId: 'a', overlays: {} });
    store.clearAll();
    expect(store.getOverlay('a')).toEqual({});
    expect(store.getActiveId()).toBeNull();
    expect(store.getSnapshot('u')).toBeNull();
  });
});
