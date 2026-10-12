'use strict';

const request = require('supertest');

// The routes module is an express Router mounted at /api/agent in server.js.
// Supertest drives it directly, with the same optionalAuth+guest middleware
// the invoke route uses, so ownership scoping is exercised for real.
const express = require('express');
const { agentGuestSessionMiddleware } = require('../middleware/agentSessionMiddleware');

// Tests override LMDB_PATH (src/__tests__/setup.js); the store must read it
// lazily per call, which createDotMemoryStore's default does.
const dotMemoryRoutes = require('../routes/dotMemory');
const { createDotMemoryStore } = require('../services/lmdb/dotMemoryStore.lmdb');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/agent/dot', agentGuestSessionMiddleware, dotMemoryRoutes);
  return app;
}

describe('dot memory routes', () => {
  test('unauthenticated caller gets memories for their guest session id scope', async () => {
    const app = buildApp(null);
    const res = await request(app).get('/api/agent/dot/memory');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ memories: [], count: 0 });
  });

  test('save, list, delete round-trip scoped to the signed-in subject', async () => {
    const app = buildApp({ sub: 'user-a' });
    const save = await request(app).post('/api/agent/dot/memory')
      .send({ text: 'Always address me as Captain' });
    expect(save.status).toBe(200);
    expect(save.body.saved).toBe(true);

    // A different subject must not see user-a's memory.
    const other = await request(buildApp({ sub: 'user-b' })).get('/api/agent/dot/memory');
    expect(other.body.count).toBe(0);

    const list = await request(app).get('/api/agent/dot/memory');
    expect(list.body.count).toBe(1);
    expect(list.body.memories[0].text).toBe('Always address me as Captain');

    const del = await request(app).delete('/api/agent/dot/memory');
    expect(del.status).toBe(200);
    const after = await request(app).get('/api/agent/dot/memory');
    expect(after.body.count).toBe(0);
  });

  test('POST rejects missing or oversize text', async () => {
    const app = buildApp({ sub: 'user-a' });
    expect((await request(app).post('/api/agent/dot/memory').send({})).status).toBe(400);
    expect((await request(app).post('/api/agent/dot/memory').send({ text: 'x'.repeat(501) })).status).toBe(400);
  });
});
