const path = require('path');
const fs = require('fs');
const os = require('os');

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

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'rdr-'));
const min = (id) => ({
  id, schemaVersion: 3,
  identity: { displayName: id },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'P' },
});
for (const id of ['banking', 'healthcare', 'admin-console']) {
  fs.mkdirSync(path.join(FIXTURE_ROOT, id), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_ROOT, id, 'manifest.json'), JSON.stringify(min(id)));
  fs.writeFileSync(path.join(FIXTURE_ROOT, id, 'mock-data.json'), '{}');
}
process.env.VERTICAL_SEED_ROOT = FIXTURE_ROOT;

const express = require('express');
const request = require('supertest');
const openEnvMock = require('../../services/lmdb/openEnv');
const { verticalManifest } = require('../../services/verticalManifest');
const router = require('../../routes/verticalManifest');

function makeApp({ user } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user || null; next(); });
  app.use('/api/verticals', router);
  return app;
}

beforeAll(() => verticalManifest.init());
beforeEach(() => {
  openEnvMock.__reset();
  verticalManifest._reset();
});
afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('GET /api/verticals/me', () => {
  test('401 when unauthenticated', async () => {
    const res = await request(makeApp()).get('/api/verticals/me');
    expect(res.status).toBe(401);
  });

  test('customer: pageManifest only, adminManifest null', async () => {
    verticalManifest.resolver.setActive('banking');
    const res = await request(makeApp({ user: { role: 'customer' } })).get('/api/verticals/me');
    expect(res.status).toBe(200);
    expect(res.body.pageManifest.id).toBe('banking');
    expect(res.body.adminManifest).toBeNull();
    expect(res.body.isAdmin).toBe(false);
    expect(res.body.pageMockData).toEqual({});
  });

  test('admin: both manifests present', async () => {
    verticalManifest.resolver.setActive('banking');
    const res = await request(makeApp({ user: { role: 'admin' } })).get('/api/verticals/me');
    expect(res.body.pageManifest.id).toBe('banking');
    expect(res.body.adminManifest.id).toBe('admin-console');
    expect(res.body.isAdmin).toBe(true);
  });
});

describe('GET /api/verticals/list', () => {
  test('401 when unauthenticated', async () => {
    const res = await request(makeApp()).get('/api/verticals/list');
    expect(res.status).toBe(401);
  });

  test('returns user-visible verticals (excludes admin-console)', async () => {
    const res = await request(makeApp({ user: { role: 'customer' } })).get('/api/verticals/list');
    expect(res.status).toBe(200);
    const ids = res.body.map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(['banking', 'healthcare']));
    expect(ids).not.toContain('admin-console');
  });
});

describe('GET /api/verticals/stream', () => {
  test('401 when unauthenticated', async () => {
    const res = await request(makeApp()).get('/api/verticals/stream');
    expect(res.status).toBe(401);
  });

  test('SSE headers set; initial vertical-switched sent', async () => {
    verticalManifest.resolver.setActive('banking');
    const app = makeApp({ user: { role: 'customer' } });
    const res = await request(app)
      .get('/api/verticals/stream')
      .buffer(true)
      .parse((r, cb) => {
        let body = '';
        r.on('data', (chunk) => {
          body += chunk;
          if (body.includes('vertical-switched')) r.destroy();
        });
        r.on('close', () => cb(null, body));
        r.on('error', () => cb(null, body));
      });
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.body).toContain('event: vertical-switched');
    expect(res.body).toContain('"activeId":"banking"');
  });
});
