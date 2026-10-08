'use strict';

// Canvas "Ping All" — POST /api/canvas/ping health-checks the Docker services
// behind the Architecture Canvas. The route file was deleted by the #2521
// dead-code sweep after a merge silently dropped its server.js mount, so the
// UI's Ping All button 404s. These tests pin the route's contract.

const express = require('express');
const request = require('supertest');

const canvasPingRoutes = require('../../routes/canvasPing');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/canvas', canvasPingRoutes);
  return app;
}

describe('routes/canvasPing', () => {
  test('POST /ping with unknown ids reports them as unknown without hitting the network', async () => {
    const res = await request(buildApp())
      .post('/api/canvas/ping')
      .send({ ids: ['not-a-service'] });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { id: 'not-a-service', status: 'unknown', ms: null },
    ]);
  });

  test('POST /ping with no body returns a result for every known service', async () => {
    const res = await request(buildApp())
      .post('/api/canvas/ping')
      .send({});
    expect(res.status).toBe(200);
    const ids = res.body.results.map(r => r.id);
    expect(ids).toContain('bff');
    expect(ids).toContain('mcp-server');
    expect(res.body.results.every(r => typeof r.status === 'string')).toBe(true);
  });

  test('POST /ping with a mixed list keeps every requested id, unknown ones reported as unknown', async () => {
    const res = await request(buildApp())
      .post('/api/canvas/ping')
      .send({ ids: ['bff', 'bogus', 'hitl-service'] });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.results.map(r => [r.id, r.status]));
    expect(byId['bogus']).toBe('unknown');
    // Real services get a real status, never the unknown placeholder.
    expect(['up', 'down', 'timeout', 'error']).toContain(byId['bff']);
  });
});
