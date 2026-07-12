'use strict';

jest.mock('axios');
jest.mock('../services/serverSizes', () => ({
  getServerSizes: jest.fn().mockResolvedValue({
    sizes: { 'api-server': { imageBytes: 1, memBytes: 2, memLimitBytes: 3, codeBytes: 4 } },
    timestamp: '2026-07-04T00:00:00.000Z',
  }),
}));
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

  test('returns 200 with all 22 services even when every probe fails', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('conn refused'), { code: 'ECONNREFUSED' }));
    const res = await request(buildApp()).get('/api/health/inventory');
    expect(res.status).toBe(200);
    expect(res.body.services).toHaveLength(22);
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

  // Deployment-awareness: INVENTORY_DEPLOYED_KEYS lets an environment (e.g. the
  // lean K8s deploy) declare which services it actually runs, so the ones it
  // does not run are greyed out (deployed:false, not probed) instead of red.
  describe('INVENTORY_DEPLOYED_KEYS filter', () => {
    const ORIGINAL = process.env.INVENTORY_DEPLOYED_KEYS;
    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.INVENTORY_DEPLOYED_KEYS;
      else process.env.INVENTORY_DEPLOYED_KEYS = ORIGINAL;
    });

    test('unset → every service is probed (unchanged behavior)', async () => {
      delete process.env.INVENTORY_DEPLOYED_KEYS;
      axios.get.mockResolvedValue({ status: 200 });
      const res = await request(buildApp()).get('/api/health/inventory');
      const gw = res.body.services.find((s) => s.key === 'mcp-gateway');
      expect(gw.up).toBe(true);
      expect(gw.deployed).toBe(true);
    });

    test('set → listed keys probed, unlisted keys greyed (deployed:false, up:null, no probe)', async () => {
      process.env.INVENTORY_DEPLOYED_KEYS = 'api-server,mcp-gateway';
      axios.get.mockResolvedValue({ status: 200 });
      const res = await request(buildApp()).get('/api/health/inventory');

      const gw = res.body.services.find((s) => s.key === 'mcp-gateway');
      expect(gw.deployed).toBe(true);
      expect(gw.up).toBe(true);

      const notHere = res.body.services.find((s) => s.key === 'authz-server');
      expect(notHere.deployed).toBe(false);
      expect(notHere.up).toBeNull();
      expect(notHere.error).toBeUndefined();
    });

    test('set → whitespace and blank entries are tolerated', async () => {
      process.env.INVENTORY_DEPLOYED_KEYS = ' api-server , mcp-gateway ,';
      axios.get.mockResolvedValue({ status: 200 });
      const res = await request(buildApp()).get('/api/health/inventory');
      const gw = res.body.services.find((s) => s.key === 'mcp-gateway');
      expect(gw.deployed).toBe(true);
      expect(gw.up).toBe(true);
    });
  });
});

describe('GET /api/health/inventory/sizes', () => {
  test('returns 200 with the serverSizes payload', async () => {
    const res = await request(buildApp()).get('/api/health/inventory/sizes');
    expect(res.status).toBe(200);
    expect(res.body.sizes['api-server']).toEqual({ imageBytes: 1, memBytes: 2, memLimitBytes: 3, codeBytes: 4 });
    expect(res.body.timestamp).toBeTruthy();
  });
});
