// Mock openEnv with an in-memory store so Task 3's verticalStore.lmdb.js
// reads/writes don't hit real LMDB. (Same pattern as verticalStore.lmdb.test.js.)
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
const { createOverlay } = require('../../services/verticalManifest/overlay');
const openEnvMock = require('../../services/lmdb/openEnv');

const MIN = {
  id: 'demo', schemaVersion: 3,
  identity: { displayName: 'Demo' },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'A' },
  dashboard: {
    kind: 'default',
    chips: [{ key: 'q', label: 'Q' }],
    hero: { cards: [] },
    llmChipGroups: {},
  },
};
const fakeLoader = { get: (id) => id === 'demo' ? { manifest: MIN } : null };

describe('overlay', () => {
  let overlay;
  beforeEach(() => {
    openEnvMock.__reset();
    overlay = createOverlay(store, fakeLoader);
  });

  test('setField writes path, get returns deep-partial', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    expect(overlay.get('demo')).toEqual({ identity: { tagline: 'X' } });
  });

  test('setField on array path replaces whole array', () => {
    overlay.setField('demo', 'dashboard.chips', [{ key: 'a', label: 'A' }]);
    expect(overlay.get('demo').dashboard.chips).toEqual([{ key: 'a', label: 'A' }]);
  });

  test('clearField removes only that path', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    overlay.setField('demo', 'identity.headerTitle', 'Y');
    overlay.clearField('demo', 'identity.tagline');
    expect(overlay.get('demo')).toEqual({ identity: { headerTitle: 'Y' } });
  });

  test('clearField on absent path is a no-op', () => {
    expect(() => overlay.clearField('demo', 'nope.nope')).not.toThrow();
  });

  test('clearAll wipes all overlays for that id', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    overlay.clearAll('demo');
    expect(overlay.get('demo')).toEqual({});
  });

  test('list returns paths currently overridden', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    overlay.setField('demo', 'theme.cssVars.--y', '#111');
    expect(overlay.list('demo').sort()).toEqual(['identity.tagline', 'theme.cssVars.--y']);
  });

  test('setField rejected if merged manifest fails validation', () => {
    // Make displayName empty -- merged manifest fails identity.displayName.min(1)
    expect(() => overlay.setField('demo', 'identity.displayName', '')).toThrow();
  });

  test('setBatch applies every entry; rejects if final merged manifest invalid', () => {
    overlay.setBatch('demo', [
      { path: 'identity.tagline', value: 'X' },
      { path: 'identity.headerTitle', value: 'Y' },
    ]);
    expect(overlay.list('demo').sort()).toEqual(['identity.headerTitle', 'identity.tagline']);

    expect(() => overlay.setBatch('demo', [
      { path: 'identity.displayName', value: '' },  // invalid
    ])).toThrow();
  });

  test('WR-08: clearField that empties the overlay removes the LMDB row entirely', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    expect(store.listOverlayIds()).toContain('demo');
    overlay.clearField('demo', 'identity.tagline');
    // After clearing the only field, the LMDB row should be gone — not stored as {}.
    expect(store.listOverlayIds()).not.toContain('demo');
    expect(overlay.get('demo')).toEqual({});
  });

  test('WR-08: clearField that leaves other fields keeps the row', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    overlay.setField('demo', 'identity.headerTitle', 'Y');
    overlay.clearField('demo', 'identity.tagline');
    expect(store.listOverlayIds()).toContain('demo');
    expect(overlay.get('demo')).toEqual({ identity: { headerTitle: 'Y' } });
  });

  test('CR-04: replaceRaw writes a whole overlay blob with validation', () => {
    overlay.replaceRaw('demo', { identity: { tagline: 'X' } });
    expect(overlay.get('demo')).toEqual({ identity: { tagline: 'X' } });

    // Invalid blob (empty displayName) is rejected.
    expect(() => overlay.replaceRaw('demo', { identity: { displayName: '' } })).toThrow();

    // Empty blob clears the row.
    overlay.replaceRaw('demo', {});
    expect(store.listOverlayIds()).not.toContain('demo');
  });
});
