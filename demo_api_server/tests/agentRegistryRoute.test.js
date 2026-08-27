'use strict';

const request = require('supertest');
const express = require('express');

// authenticateToken is the guard controlPlane.js uses for the same kind of
// surface; mock it to a pass-through so this suite tests the route, not auth.
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { sub: 'u-1' }; next(); },
}));
jest.mock('../services/agentRegistryService', () => ({ buildRegistry: jest.fn() }));

const registryService = require('../services/agentRegistryService');
const agentRegistryRoutes = require('../routes/agentRegistry');

function buildApp() {
  const app = express();
  app.use('/api/registry', agentRegistryRoutes);
  return app;
}

const PAYLOAD = {
  generatedAt: '2026-08-26T00:00:00.000Z',
  sources: { pingone: { up: false, rows: 0, error: 'PingOne unreachable' },
             demoRegistry: { up: true, rows: 1 } },
  rows: [{ id: 'mcp-client-abc', name: 'Batch job', identityType: 'workload', source: 'demo-registry' }],
};

describe('GET /api/registry/agents', () => {
  beforeEach(() => {
    registryService.buildRegistry.mockReset();
    registryService.buildRegistry.mockResolvedValue(PAYLOAD);
  });

  test('returns the merged registry', async () => {
    const res = await request(buildApp()).get('/api/registry/agents');
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
  });

  // The reason the service degrades per source at all: a dead PingOne must
  // still render every other identity, with the failure named rather than
  // swallowed. A 500 here would defeat the whole design.
  test('still 200s when a source is down, and names which one', async () => {
    const res = await request(buildApp()).get('/api/registry/agents');
    expect(res.status).toBe(200);
    expect(res.body.sources.pingone.up).toBe(false);
    expect(res.body.sources.pingone.error).toMatch(/unreachable/i);
  });

  test('500s only when the registry itself cannot be built', async () => {
    registryService.buildRegistry.mockRejectedValue(new Error('catastrophe'));
    const res = await request(buildApp()).get('/api/registry/agents');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
    // Never echo the raw upstream message back to the caller.
    expect(res.body.error).not.toMatch(/catastrophe/);
  });
});

// A router that is never mounted is the repo's most expensive failure mode:
// correct, tested, merged and unreachable. Assert the wiring, not just the
// handler.
describe('the router is actually mounted', () => {
  test('server.js mounts agentRegistry at /api/registry', () => {
    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(server).toMatch(/app\.use\(\s*['"]\/api\/registry['"]\s*,\s*require\(\s*['"]\.\/routes\/agentRegistry['"]\s*\)\s*\)/);
  });
});

describe('GET /api/registry/agents/:id', () => {
  beforeEach(() => {
    registryService.buildRegistry.mockReset();
    registryService.buildRegistry.mockResolvedValue(PAYLOAD);
  });

  test('returns the single row', async () => {
    const res = await request(buildApp()).get('/api/registry/agents/mcp-client-abc');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('mcp-client-abc');
  });

  test('404s for an unknown id', async () => {
    const res = await request(buildApp()).get('/api/registry/agents/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});
