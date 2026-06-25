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
const { createSnapshot } = require('../../services/verticalManifest/snapshot');
const openEnvMock = require('../../services/lmdb/openEnv');

const SEED = {
  id: 'demo', schemaVersion: 3,
  identity: { displayName: 'Demo' },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'A' },
};
// Returns a seed for any id EXCEPT 'nonexistent-vertical' (used by the CR-04
// test to simulate a snapshot whose seed disappeared between save and restore).
const fakeLoader = {
  get: (id) => id === 'nonexistent-vertical' ? null : ({ manifest: { ...SEED, id } }),
};

describe('snapshot', () => {
  let snap, overlay, events;
  beforeEach(() => {
    openEnvMock.__reset();
    overlay = createOverlay(store, fakeLoader);
    events = [];
    snap = createSnapshot(store, overlay, {
      getActiveId: () => store.getActiveId(),
      setActiveId: (id) => store.setActiveId(id),
      onRestoredId: (id) => events.push(id),
      onRestoredActive: (id) => events.push(`switched:${id}`),
    });
  });

  test('save captures activeId + all overlays + timestamp', () => {
    store.setActiveId('demo');
    overlay.setField('demo', 'identity.tagline', 'X');
    const t = snap.save('user1');
    expect(typeof t).toBe('number');
    expect(t).toBeGreaterThan(0);
    const s = store.getSnapshot('user1');
    expect(s.activeId).toBe('demo');
    expect(s.overlays.demo).toEqual({ identity: { tagline: 'X' } });
    expect(s.savedAt).toBe(t);
  });

  test('restore writes overlays back and switches active; fires hooks', () => {
    store.setActiveId('demo');
    overlay.setField('demo', 'identity.tagline', 'X');
    snap.save('user1');

    // Clobber state
    overlay.clearAll('demo');
    store.setActiveId('other');

    const result = snap.restore('user1');
    expect(result.restored).toBe(true);
    expect(overlay.get('demo')).toEqual({ identity: { tagline: 'X' } });
    expect(store.getActiveId()).toBe('demo');
    expect(events).toContain('demo');
    expect(events).toContain('switched:demo');
  });

  test('restore is idempotent', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    snap.save('u');
    snap.restore('u');
    snap.restore('u');
    expect(overlay.get('demo')).toEqual({ identity: { tagline: 'X' } });
  });

  test('restore with no snapshot returns { restored: false }', () => {
    expect(snap.restore('nope')).toEqual({ restored: false });
  });

  test('restore wipes overlays that were active but not in snapshot', () => {
    // Save with overlay only on demo.
    overlay.setField('demo', 'identity.tagline', 'X');
    snap.save('u');

    // After save, add a new overlay on a different id; restore should wipe it.
    overlay.setField('other', 'identity.tagline', 'Y');
    expect(overlay.get('other')).toEqual({ identity: { tagline: 'Y' } });

    snap.restore('u');
    expect(overlay.get('other')).toEqual({});
    expect(overlay.get('demo')).toEqual({ identity: { tagline: 'X' } });
  });

  test('peek returns { savedAt } or null', () => {
    expect(snap.peek('u')).toBeNull();
    const t = snap.save('u');
    expect(snap.peek('u')).toEqual({ savedAt: t });
  });

  test('clear removes the snapshot', () => {
    snap.save('u');
    snap.clear('u');
    expect(snap.peek('u')).toBeNull();
  });

  test('snapshots are per-user (no cross-contamination)', () => {
    overlay.setField('demo', 'identity.tagline', 'A');
    snap.save('user1');
    overlay.clearAll('demo');
    overlay.setField('demo', 'identity.tagline', 'B');
    snap.save('user2');

    snap.restore('user1');
    expect(overlay.get('demo')).toEqual({ identity: { tagline: 'A' } });
  });

  test('CR-04: restore validates each overlay; bad ones land in `skipped`, good ones still restore', () => {
    // Set up: snapshot containing one valid overlay (demo) and one that the
    // seed CANNOT represent (a fake id the fakeLoader doesn't know about).
    overlay.setField('demo', 'identity.tagline', 'X');
    snap.save('user1');
    // Manually poison the stored snapshot to include a bad-id entry.
    const stored = store.getSnapshot('user1');
    stored.overlays['nonexistent-vertical'] = { identity: { tagline: 'Y' } };
    store.setSnapshot('user1', stored);

    overlay.clearAll('demo');
    const result = snap.restore('user1');

    expect(result.restored).toBe(true);
    expect(result.skipped).toEqual([
      { id: 'nonexistent-vertical', error: expect.stringContaining('No seed') },
    ]);
    // Valid overlay still restored.
    expect(overlay.get('demo')).toEqual({ identity: { tagline: 'X' } });
  });
});
