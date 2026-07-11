'use strict';
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'u1', role: 'user' }; next(); },
}));
// Deterministic registry: two light checks + one heavy.
jest.mock('../services/checks', () => {
  const { register } = require('../services/checks/registry');
  register(
    { id: 'a', name: 'A', category: 'C', run: async () => ({ status: 'pass', detail: 'ok' }) },
    { id: 'warnable', name: 'W', category: 'C', run: async () => ({ status: 'warn', detail: 'meh' }) },
    { id: 'heavy1', name: 'H', category: 'C', heavy: true, run: async () => ({ status: 'pass' }) },
  );
}, { virtual: false });
jest.mock('../routes/featureFlags', () => ({
  FLAG_REGISTRY: [{ id: 'ff_x', type: 'boolean', defaultValue: true }],
  serializeFlag: () => ({ id: 'ff_x', value: true }),
}));

const express = require('express');
const request = require('supertest');
const { router } = require('../routes/check');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/check', router);
  return app;
}

describe('/api/check', () => {
  test('catalog lists checks incl. heavy for current flags', async () => {
    const res = await request(makeApp()).get('/api/check/catalog');
    expect(res.status).toBe(200);
    expect(res.body.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['a', 'warnable', 'heavy1']));
    expect(res.body.flags).toEqual({ ff_x: true });
  });

  test('run streams SSE results + done verdict (light only by default)', async () => {
    const res = await request(makeApp()).post('/api/check/run').send({});
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toMatch(/event: result/);
    expect(res.text).toContain('"id":"a"');
    expect(res.text).not.toContain('"id":"heavy1"'); // heavy excluded by default
    expect(res.text).toMatch(/event: done/);
    expect(res.text).toMatch(/"verdict":"ready_with_warnings"/);
  });

  test('run with includeHeavy runs heavy checks', async () => {
    const res = await request(makeApp()).post('/api/check/run').send({ includeHeavy: true });
    expect(res.text).toContain('"id":"heavy1"');
  });
});
