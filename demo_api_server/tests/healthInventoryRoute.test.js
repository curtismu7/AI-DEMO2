'use strict';

jest.mock('axios');
const axios = require('axios');
const request = require('supertest');
const express = require('express');

const healthRoutes = require('../routes/health');

function buildApp() {
  const app = express();
  app.use('/api/health', healthRoutes);
  return app;
}

describe('GET /api/health/inventory', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 200 with all 24 services even when every probe fails', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('conn refused'), { code: 'ECONNREFUSED' }));
    const res = await request(buildApp()).get('/api/health/inventory');
    expect(res.status).toBe(200);
    expect(res.body.services).toHaveLength(24);
    const bff = res.body.services.find((s) => s.key === 'api-server');
    expect(bff.up).toBe(true); // self — this endpoint responding proves it
    const unprobed = res.body.services.find((s) => s.key === 'ungoverned-agent');
    expect(unprobed.up).toBeNull();
    const down = res.body.services.find((s) => s.key === 'mcp-gateway');
    expect(down.up).toBe(false);
    expect(down.error).toBe('ECONNREFUSED');
  });

  test('marks a service up with latency when a candidate responds', async () => {
    axios.get.mockResolvedValue({ status: 200 });
    const res = await request(buildApp()).get('/api/health/inventory');
    const gw = res.body.services.find((s) => s.key === 'mcp-gateway');
    expect(gw.up).toBe(true);
    expect(typeof gw.latencyMs).toBe('number');
    expect(gw.url).toBeTruthy();
  });

  test('tries candidates in order until one succeeds', async () => {
    axios.get.mockImplementation((url) =>
      url.startsWith('http://localhost:3005')
        ? Promise.resolve({ status: 200 })
        : Promise.reject(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }))
    );
    const res = await request(buildApp()).get('/api/health/inventory');
    const gw = res.body.services.find((s) => s.key === 'mcp-gateway');
    expect(gw.up).toBe(true);
    expect(gw.url).toContain('localhost:3005');
  });
});
