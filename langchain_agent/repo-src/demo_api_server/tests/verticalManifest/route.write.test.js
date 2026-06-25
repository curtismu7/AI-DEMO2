'use strict';
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

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wrt-'));
const min = (id) => ({
  id, schemaVersion: 3,
  identity: { displayName: id },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'P' },
});
function writeFixture(id) {
  fs.mkdirSync(path.join(FIXTURE_ROOT, id), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_ROOT, id, 'manifest.json'), JSON.stringify(min(id)));
  fs.writeFileSync(path.join(FIXTURE_ROOT, id, 'mock-data.json'), '{}');
}
for (const id of ['banking', 'healthcare', 'admin-console']) writeFixture(id);

process.env.VERTICAL_SEED_ROOT = FIXTURE_ROOT;

const express = require('express');
const request = require('supertest');
const openEnvMock = require('../../services/lmdb/openEnv');
const { verticalManifest } = require('../../services/verticalManifest');
const router = require('../../routes/verticalManifest');

function makeApp({ user } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user || null;
    // Minimal session stub: POST /active is session-scoped (writes
    // req.session.active_vertical, then req.session.save(cb)). The real
    // express-session middleware isn't mounted in this unit harness.
    req.session = { save: (cb) => cb && cb() };
    next();
  });
  app.use('/api/verticals', router);
  return app;
}

beforeAll(() => verticalManifest.init());
beforeEach(() => {
  openEnvMock.__reset();
  // Reset on-disk state: delete any fixtures that aren't in the original 3.
  for (const e of fs.readdirSync(FIXTURE_ROOT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (!['banking', 'healthcare', 'admin-console'].includes(e.name)) {
      fs.rmSync(path.join(FIXTURE_ROOT, e.name), { recursive: true, force: true });
    }
  }
  verticalManifest._reset();
});
afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('POST /active', () => {
  // Switching the active vertical is open to any authenticated user (requireSession),
  // not admin-only — it's a demo affordance. Unauthenticated requests are still 401.
  test('unauthenticated → 401', async () => {
    const res = await request(makeApp())
      .post('/api/verticals/active').send({ id: 'healthcare' });
    expect(res.status).toBe(401);
  });

  test('non-admin authenticated → 204', async () => {
    const res = await request(makeApp({ user: { role: 'customer' } }))
      .post('/api/verticals/active').send({ id: 'healthcare' });
    expect(res.status).toBe(204);
    expect(verticalManifest.resolver.activeId()).toBe('healthcare');
  });

  test('admin → 204', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/active').send({ id: 'healthcare' });
    expect(res.status).toBe(204);
    expect(verticalManifest.resolver.activeId()).toBe('healthcare');
  });

  test('missing id → 400', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/active').send({});
    expect(res.status).toBe(400);
  });

  test('unknown id → 404', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/active').send({ id: 'nope' });
    expect(res.status).toBe(404);
  });
});

describe('POST /:id/overlay', () => {
  test('admin: writes field, returns 204', async () => {
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .post('/api/verticals/banking/overlay').send({ path: 'identity.tagline', value: 'X' });
    expect(res.status).toBe(204);
    expect(verticalManifest.resolver.overlay.get('banking').identity.tagline).toBe('X');
  });

  test('missing path → 400', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/banking/overlay').send({ value: 'X' });
    expect(res.status).toBe(400);
  });

  test('unknown id → 404', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/nope/overlay').send({ path: 'identity.tagline', value: 'X' });
    expect(res.status).toBe(404);
  });

  test('invalid merged manifest → 400', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/banking/overlay').send({ path: 'identity.displayName', value: '' });
    expect(res.status).toBe(400);
  });
});

describe('POST /:id/overlay/batch (replace semantics)', () => {
  test('admin: writes batch, returns 204', async () => {
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .post('/api/verticals/banking/overlay/batch').send({
        entries: [
          { path: 'identity.tagline', value: 'X' },
          { path: 'identity.headerTitle', value: 'Y' },
        ],
      });
    expect(res.status).toBe(204);
    const ov = verticalManifest.resolver.overlay.get('banking');
    expect(ov.identity.tagline).toBe('X');
    expect(ov.identity.headerTitle).toBe('Y');
  });

  test('replace: a field absent from the new entries is cleared', async () => {
    // Pre-existing override on two fields…
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'OLD');
    verticalManifest.resolver.overlay.setField('banking', 'identity.headerTitle', 'KEEP');
    // …then a batch that omits tagline — replace semantics should drop it.
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .post('/api/verticals/banking/overlay/batch').send({
        entries: [{ path: 'identity.headerTitle', value: 'KEEP' }],
      });
    expect(res.status).toBe(204);
    const ov = verticalManifest.resolver.overlay.get('banking');
    expect(ov.identity.tagline).toBeUndefined();
    expect(ov.identity.headerTitle).toBe('KEEP');
  });

  test('replace: empty entries clears all overrides', async () => {
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .post('/api/verticals/banking/overlay/batch').send({ entries: [] });
    expect(res.status).toBe(204);
    expect(verticalManifest.resolver.overlay.get('banking')).toEqual({});
  });

  test('non-array entries → 400', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/banking/overlay/batch').send({ entries: 'notarray' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /:id/overlay', () => {
  test('with path: clears one field', async () => {
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');
    verticalManifest.resolver.overlay.setField('banking', 'identity.headerTitle', 'Y');
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .delete('/api/verticals/banking/overlay').send({ path: 'identity.tagline' });
    expect(res.status).toBe(204);
    const ov = verticalManifest.resolver.overlay.get('banking');
    expect(ov.identity.tagline).toBeUndefined();
    expect(ov.identity.headerTitle).toBe('Y');
  });

  test('without path: clears all', async () => {
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .delete('/api/verticals/banking/overlay').send({});
    expect(res.status).toBe(204);
    expect(verticalManifest.resolver.overlay.get('banking')).toEqual({});
  });
});

describe('POST /reset-all', () => {
  test('clears every overlay', async () => {
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');
    verticalManifest.resolver.overlay.setField('healthcare', 'identity.tagline', 'Y');
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .post('/api/verticals/reset-all');
    expect(res.status).toBe(204);
    expect(verticalManifest.resolver.overlay.get('banking')).toEqual({});
    expect(verticalManifest.resolver.overlay.get('healthcare')).toEqual({});
  });
});

describe('POST /:sourceId/clone', () => {
  test('invalid newId regex → 400', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/banking/clone').send({ newId: 'Bad_ID', displayName: 'X' });
    expect(res.status).toBe(400);
  });

  test('existing newId → 409', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/banking/clone').send({ newId: 'healthcare', displayName: 'X' });
    expect(res.status).toBe(409);
  });

  test('unknown source → 404', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/nope/clone').send({ newId: 'fresh', displayName: 'F' });
    expect(res.status).toBe(404);
  });

  test('valid clone → 201, folder written, list updated', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/banking/clone').send({ newId: 'new-thing', displayName: 'New Thing' });
    expect(res.status).toBe(201);
    expect(fs.existsSync(path.join(FIXTURE_ROOT, 'new-thing', 'manifest.json'))).toBe(true);
    const list = verticalManifest.list().map((v) => v.id);
    expect(list).toContain('new-thing');
  });
});

describe('DELETE /:id', () => {
  test('protected ids (banking, admin-console) → 403', async () => {
    for (const id of ['banking', 'admin-console']) {
      const res = await request(makeApp({ user: { role: 'admin' } }))
        .delete(`/api/verticals/${id}`);
      expect(res.status).toBe(403);
    }
  });

  test('currently-active id → 409', async () => {
    verticalManifest.resolver.setActive('healthcare');
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .delete('/api/verticals/healthcare');
    expect(res.status).toBe(409);
  });

  test('valid delete → 204, folder removed, list shrinks', async () => {
    verticalManifest.resolver.setActive('banking');
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .delete('/api/verticals/healthcare');
    expect(res.status).toBe(204);
    expect(fs.existsSync(path.join(FIXTURE_ROOT, 'healthcare'))).toBe(false);
    expect(verticalManifest.list().map((v) => v.id)).not.toContain('healthcare');
  });
});

describe('snapshot endpoints', () => {
  test('save → restore round-trip', async () => {
    const user = { role: 'admin', id: 'u1' };
    verticalManifest.resolver.setActive('banking');
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');

    const save = await request(makeApp({ user })).post('/api/verticals/snapshot');
    expect(save.status).toBe(200);
    expect(save.body.savedAt).toBeGreaterThan(0);

    verticalManifest.resolver.overlay.clearAll('banking');
    verticalManifest.resolver.setActive('healthcare');

    const restore = await request(makeApp({ user })).post('/api/verticals/snapshot/restore');
    expect(restore.status).toBe(204);
    expect(verticalManifest.resolver.overlay.get('banking').identity.tagline).toBe('X');
    expect(verticalManifest.resolver.activeId()).toBe('banking');
  });

  test('DELETE clears snapshot', async () => {
    const user = { role: 'admin', id: 'u1' };
    await request(makeApp({ user })).post('/api/verticals/snapshot');
    const del = await request(makeApp({ user })).delete('/api/verticals/snapshot');
    expect(del.status).toBe(204);
    expect(verticalManifest.snapshot.peek('u1')).toBeNull();
  });

  test('non-admin → 403 on save', async () => {
    const res = await request(makeApp({ user: { role: 'customer' } })).post('/api/verticals/snapshot');
    expect(res.status).toBe(403);
  });
});

describe('GET /:id/seed', () => {
  test('admin: returns raw seed manifest + overlay paths', async () => {
    verticalManifest.resolver.overlay.clearAll('banking');
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'Overridden');
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .get('/api/verticals/banking/seed');
    expect(res.status).toBe(200);
    // seedManifest is the RAW seed, NOT the merged view — tagline is the on-disk value.
    expect(res.body.seedManifest.id).toBe('banking');
    expect(res.body.seedManifest.identity.tagline).not.toBe('Overridden');
    expect(res.body.overlayPaths).toContain('identity.tagline');
  });

  test('non-admin → 403', async () => {
    const res = await request(makeApp({ user: { role: 'customer' } }))
      .get('/api/verticals/banking/seed');
    expect(res.status).toBe(403);
  });

  test('unknown id → 404', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .get('/api/verticals/nope/seed');
    expect(res.status).toBe(404);
  });
});

describe('parameterized :id validation (path-traversal guard)', () => {
  // requireValidId rejects any id outside ^[a-z][a-z0-9-]*$ with 400 before any
  // path.join / fs call. Covers chars outside the charset (dots) and the
  // %2F-decoded-to-'/' traversal vector (Express decodes %2F inside params).
  test.each([
    ['get',    '/api/verticals/bad..id/seed'],
    ['delete', '/api/verticals/bad..id'],
    ['post',   '/api/verticals/bad..id/overlay'],
    ['post',   '/api/verticals/bad..id/overlay/batch'],
    ['delete', '/api/verticals/bad..id/overlay'],
    ['delete', '/api/verticals/banking%2F..%2F..%2Ftmp'],
  ])('%s %s → 400 invalid id', async (method, url) => {
    const res = await request(makeApp({ user: { role: 'admin' } }))[method](url).send({});
    expect(res.status).toBe(400);
  });
});
