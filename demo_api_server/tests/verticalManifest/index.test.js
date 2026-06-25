const path = require('path');
const fs = require('fs');
const os = require('os');

// Mock openEnv first (before any module that touches it loads).
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

// Build a fixture seed root with 2 verticals before requiring the barrel.
const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'vidx-'));
const min = (id) => ({
  id, schemaVersion: 3,
  identity: { displayName: id },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'P' },
});
for (const id of ['banking', 'admin-console']) {
  fs.mkdirSync(path.join(FIXTURE_ROOT, id), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_ROOT, id, 'manifest.json'), JSON.stringify(min(id)));
  fs.writeFileSync(path.join(FIXTURE_ROOT, id, 'mock-data.json'), '{}');
}
process.env.VERTICAL_SEED_ROOT = FIXTURE_ROOT;

const openEnvMock = require('../../services/lmdb/openEnv');
const { verticalManifest } = require('../../services/verticalManifest');

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('verticalManifest singleton', () => {
  beforeEach(() => {
    openEnvMock.__reset();
    verticalManifest._reset();
  });

  test('init loads all seeds', () => {
    verticalManifest.init();
    const ids = verticalManifest.listAll().map(v => v.id).sort();
    expect(ids).toEqual(['admin-console', 'banking']);
  });

  test('list() hides admin-console from user-facing surface', () => {
    verticalManifest.init();
    const ids = verticalManifest.list().map(v => v.id);
    expect(ids).toEqual(['banking']);
  });

  test('scope.resolveForRequest returns expected shape for admin', () => {
    verticalManifest.init();
    verticalManifest.resolver.setActive('banking');
    const out = verticalManifest.scope.resolveForRequest({ user: { role: 'admin' } });
    expect(out.activeId).toBe('banking');
    expect(out.pageManifest.id).toBe('banking');
    expect(out.adminManifest.id).toBe('admin-console');
    expect(out.isAdmin).toBe(true);
    expect(out.pageMockData).toEqual({});
  });

  test('overlay write fires vertical-edited through events', () => {
    verticalManifest.init();
    const received = [];
    const fakeRes = {
      setHeader() {}, writeHead() {}, flushHeaders() {},
      write(s) { received.push(s); },
      on() {}, end() {},
    };
    verticalManifest.events.onClient({}, fakeRes);
    received.length = 0;  // discard hydration
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');
    expect(received.join('')).toContain('event: vertical-edited');
    expect(received.join('')).toContain('"id":"banking"');
  });

  test('setActive fires vertical-switched through events', () => {
    verticalManifest.init();
    const received = [];
    const fakeRes = {
      setHeader() {}, writeHead() {}, flushHeaders() {},
      write(s) { received.push(s); },
      on() {}, end() {},
    };
    verticalManifest.events.onClient({}, fakeRes);
    received.length = 0;
    verticalManifest.resolver.setActive('banking');
    expect(received.join('')).toContain('event: vertical-switched');
    expect(received.join('')).toContain('"activeId":"banking"');
  });

  test('snapshot integrates with overlay + active id + events', () => {
    verticalManifest.init();
    verticalManifest.resolver.setActive('banking');
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');
    const t = verticalManifest.snapshot.save('user1');
    expect(t).toBeGreaterThan(0);

    verticalManifest.resolver.overlay.clearAll('banking');
    expect(verticalManifest.resolver.overlay.get('banking')).toEqual({});

    const r = verticalManifest.snapshot.restore('user1');
    expect(r.restored).toBe(true);
    expect(verticalManifest.resolver.overlay.get('banking').identity.tagline).toBe('X');
  });

  test('HIDDEN_IDS is exposed for callers', () => {
    expect(verticalManifest.HIDDEN_IDS instanceof Set).toBe(true);
    expect(verticalManifest.HIDDEN_IDS.has('admin-console')).toBe(true);
  });
});
