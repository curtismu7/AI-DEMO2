// demo_api_server/tests/verticalLogo.route.test.js
'use strict';

// Logo upload/serve/delete routes. Store is the real verticalStore module mocked
// at openEnv (same pattern as verticalStore.lmdb.test.js) so logo:<id> behavior
// — including setLogo's savedAt stamp and base64 round-trip — is exercised.

jest.mock('../services/lmdb/openEnv', () => {
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

jest.mock('../services/verticalManifest', () => {
  const store = require('../services/lmdb/verticalStore.lmdb');
  const versions = new Map();
  const bump = (id) => versions.set(id, (versions.get(id) || 0) + 1);
  return {
    verticalManifest: {
      listAll: () => [{ id: 'banking' }, { id: 'healthcare' }],
      store,
      resolver: {
        logos: {
          get: (id) => store.getLogo(id),
          put: (id, logo) => { store.setLogo(id, logo); bump(id); },
          clear: (id) => { store.clearLogo(id); bump(id); },
        },
      },
    },
  };
});

const request = require('supertest');
const express = require('express');
const router = require('../routes/verticalManifest');
const openEnvMock = require('../services/lmdb/openEnv');

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/verticals', router);
  return app;
}

const asAdmin = () => buildApp({ id: 'a1', role: 'admin' });
const asUser = () => buildApp({ id: 'u1', role: 'user' });

beforeEach(() => { openEnvMock.__reset(); });

describe('GET /api/verticals/:id/logo', () => {
  test('serves uploaded bytes with the stored mime type', async () => {
    const app = asAdmin();
    await request(app).post('/api/verticals/banking/logo')
      .field('name', 'logo')
      .attach('logo', Buffer.from(PNG_BASE64, 'base64'), { filename: 'l.png', contentType: 'image/png' })
      .expect(200);
    const res = await request(app).get('/api/verticals/banking/logo').expect(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.body.toString('base64')).toBe(PNG_BASE64);
  });

  test('404 when nothing uploaded (UI falls back to logoPath)', async () => {
    await request(asAdmin()).get('/api/verticals/banking/logo').expect(404);
  });

  test('public: no req.user required (brand chrome, like /:id/hero)', async () => {
    const app = buildApp(null);
    await request(app).get('/api/verticals/banking/logo').expect(404);
  });
});

describe('POST /api/verticals/:id/logo', () => {
  test('admin upload succeeds', async () => {
    const res = await request(asAdmin()).post('/api/verticals/banking/logo')
      .attach('logo', Buffer.from(PNG_BASE64, 'base64'), { filename: 'l.png', contentType: 'image/png' })
      .expect(200);
    expect(res.body).toEqual({ ok: true, logoUrl: '/api/verticals/banking/logo' });
  });

  test('401 unauthenticated / 403 non-admin', async () => {
    await request(buildApp(null)).post('/api/verticals/banking/logo')
      .attach('logo', Buffer.from(PNG_BASE64, 'base64'), { filename: 'l.png', contentType: 'image/png' })
      .expect(401);
    await request(asUser()).post('/api/verticals/banking/logo')
      .attach('logo', Buffer.from(PNG_BASE64, 'base64'), { filename: 'l.png', contentType: 'image/png' })
      .expect(403);
  });

  test('rejects non-image mime types', async () => {
    await request(asAdmin()).post('/api/verticals/banking/logo')
      .attach('logo', Buffer.from('hello'), { filename: 'e.txt', contentType: 'text/plain' })
      .expect(400);
  });

  test('rejects unknown vertical id', async () => {
    await request(asAdmin()).post('/api/verticals/nope/logo')
      .attach('logo', Buffer.from(PNG_BASE64, 'base64'), { filename: 'l.png', contentType: 'image/png' })
      .expect(404);
  });

  test('rejects when no file attached', async () => {
    await request(asAdmin()).post('/api/verticals/banking/logo').expect(400);
  });
});

describe('DELETE /api/verticals/:id/logo', () => {
  test('admin delete removes the upload; then GET 404s', async () => {
    const app = asAdmin();
    await request(app).post('/api/verticals/banking/logo')
      .attach('logo', Buffer.from(PNG_BASE64, 'base64'), { filename: 'l.png', contentType: 'image/png' })
      .expect(200);
    await request(app).delete('/api/verticals/banking/logo').expect(200);
    await request(app).get('/api/verticals/banking/logo').expect(404);
  });

  test('non-admin is refused', async () => {
    await request(asUser()).delete('/api/verticals/banking/logo').expect(403);
  });
});
