// demo_api_server/tests/verticalThemes.route.test.js
'use strict';

// In-memory configStore stub (mirrors get/setRaw string-blob semantics).
const _store = {};
jest.mock('../services/configStore', () => ({
  get: jest.fn((k) => {
    const v = _store[String(k).toUpperCase()];
    return v !== undefined && v !== '' ? v : null;
  }),
  setRaw: jest.fn(async (data) => {
    for (const [k, v] of Object.entries(data)) _store[String(k).toUpperCase()] = String(v);
  }),
}));

jest.mock('../services/verticalManifest', () => ({
  verticalManifest: {
    list: () => [{ id: 'banking' }, { id: 'healthcare' }],
    listAll: () => [{ id: 'banking' }, { id: 'healthcare' }],
  },
}));

// The route is fully public — server.js mounts it with no auth middleware at
// all — so there is no admin middleware to stub, and no req.user is required.

const request = require('supertest');
const express = require('express');
const router = require('../routes/verticalThemes');

function buildApp({ user } = { user: { role: 'admin' } }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin', router);
  return app;
}

// Mirrors server.js's actual mount — no req.user seeded at all.
function buildAppNoAuth() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  return app;
}

beforeEach(() => { for (const k of Object.keys(_store)) delete _store[k]; });

describe('verticalThemes route', () => {
  test('PUT merges cssVars without clobbering existing zones', async () => {
    const app = buildApp();
    await request(app).put('/api/admin/vertical-themes/banking')
      .send({ cssVars: { '--brand-card-accent': '#7C3AED' } }).expect(200);
    const res = await request(app).put('/api/admin/vertical-themes/banking')
      .send({ cssVars: { '--app-primary-red': '#2563EB' } }).expect(200);
    expect(res.body.cssVars).toEqual({
      '--brand-card-accent': '#7C3AED',
      '--app-primary-red': '#2563EB',
    });
  });

  test('PUT rejects non-theme keys and non-color values', async () => {
    const app = buildApp();
    await request(app).put('/api/admin/vertical-themes/banking')
      .send({ cssVars: { '--evil-key': '#fff' } }).expect(400);
    await request(app).put('/api/admin/vertical-themes/banking')
      .send({ cssVars: { '--brand-card-accent': 'red; }' } }).expect(400);
  });

  test('PUT rejects an invalid vertical id (fails ID_RE)', async () => {
    const app = buildApp();
    await request(app).put('/api/admin/vertical-themes/Bad_Id')
      .send({ cssVars: { '--brand-card-accent': '#fff' } }).expect(400);
  });

  test('PUT rejects an unknown (well-formed) vertical id with 404', async () => {
    const app = buildApp();
    await request(app).put('/api/admin/vertical-themes/nope')
      .send({ cssVars: { '--brand-card-accent': '#fff' } }).expect(404);
  });

  test('PUT rejects an uppercase css var key (case-sensitive)', async () => {
    const app = buildApp();
    await request(app).put('/api/admin/vertical-themes/banking')
      .send({ cssVars: { '--Brand-Card-Accent': '#fff' } }).expect(400);
  });

  test('GET returns parsed blobs only for verticals with overrides', async () => {
    const app = buildApp();
    await request(app).put('/api/admin/vertical-themes/banking')
      .send({ cssVars: { '--theme-accent': '#0891B2' } }).expect(200);
    const res = await request(app).get('/api/admin/vertical-themes').expect(200);
    expect(res.body).toEqual({ banking: { '--theme-accent': '#0891B2' } });
  });

  test('DELETE with vars removes only those; without body clears all', async () => {
    const app = buildApp();
    await request(app).put('/api/admin/vertical-themes/banking')
      .send({ cssVars: { '--brand-card-accent': '#7C3AED', '--theme-accent': '#0891B2' } }).expect(200);

    const partial = await request(app).delete('/api/admin/vertical-themes/banking')
      .send({ vars: ['--brand-card-accent'] }).expect(200);
    expect(partial.body.cssVars).toEqual({ '--theme-accent': '#0891B2' });

    await request(app).delete('/api/admin/vertical-themes/banking').expect(200);
    const res = await request(app).get('/api/admin/vertical-themes').expect(200);
    expect(res.body).toEqual({});
  });

  test('a non-admin signed-in user can write (feature is open to everyone)', async () => {
    const app = buildApp({ user: { role: 'user' } });
    await request(app).put('/api/admin/vertical-themes/banking')
      .send({ cssVars: { '--theme-accent': '#0891B2' } }).expect(200);
  });

  test('a signed-out visitor (no req.user at all) can read and write', async () => {
    const app = buildAppNoAuth();
    await request(app).put('/api/admin/vertical-themes/banking')
      .send({ cssVars: { '--theme-accent': '#0891B2' } }).expect(200);
    const res = await request(app).get('/api/admin/vertical-themes').expect(200);
    expect(res.body).toEqual({ banking: { '--theme-accent': '#0891B2' } });
  });
});
