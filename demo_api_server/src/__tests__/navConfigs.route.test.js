'use strict';

const express = require('express');
const request = require('supertest');
const navConfigsRouter = require('../../routes/navConfigs');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/nav-configs', navConfigsRouter);
  return app;
}

describe('GET /api/nav-configs', () => {
  test('lists the 3 builtin configs at minimum', async () => {
    const res = await request(makeApp()).get('/api/nav-configs');
    expect(res.status).toBe(200);
    const names = res.body.configs.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['Full mode', 'Demo mode', 'Learning']));
  });
});

describe('POST /api/nav-configs', () => {
  test('creates a custom config', async () => {
    const res = await request(makeApp())
      .post('/api/nav-configs')
      .send({ name: 'My Demo', hiddenLabels: ['Themes'], flagSnapshot: { ff_rar: true } });
    expect(res.status).toBe(201);
    expect(res.body.config.name).toBe('My Demo');
    expect(res.body.config.isBuiltin).toBe(false);
  });

  test('rejects a missing name with 400', async () => {
    const res = await request(makeApp())
      .post('/api/nav-configs')
      .send({ hiddenLabels: [] });
    expect(res.status).toBe(400);
  });

  test('rejects a non-array hiddenLabels with 400', async () => {
    const res = await request(makeApp())
      .post('/api/nav-configs')
      .send({ name: 'Bad', hiddenLabels: 'not-an-array' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/nav-configs/:id', () => {
  test('deletes a custom config', async () => {
    const app = makeApp();
    const created = await request(app)
      .post('/api/nav-configs')
      .send({ name: 'Temp', hiddenLabels: [], flagSnapshot: {} });
    const res = await request(app).delete(`/api/nav-configs/${created.body.config.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  test('refuses to delete a builtin with 403', async () => {
    const app = makeApp();
    const list = await request(app).get('/api/nav-configs');
    const full = list.body.configs.find(c => c.name === 'Full mode');
    const res = await request(app).delete(`/api/nav-configs/${full.id}`);
    expect(res.status).toBe(403);
  });

  test('returns 404 for an unknown id', async () => {
    const res = await request(makeApp()).delete('/api/nav-configs/cfg_does_not_exist');
    expect(res.status).toBe(404);
  });
});
