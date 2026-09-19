const express = require('express');
const request = require('supertest');
const { createMcpDiscoveryRouter } = require('../routes/mcpDiscovery');

function testApp(client, { authenticated = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/mcp-discovery', createMcpDiscoveryRouter({
    client,
    authenticate: (_req, res, next) => authenticated ? next() : res.status(401).json({ error: 'authentication_required' }),
  }));
  return app;
}

test('requires authentication but allows any authenticated user to read inventory', async () => {
  const client = { getInventory: jest.fn() };
  expect((await request(testApp(client, { authenticated: false })).get('/api/admin/mcp-discovery/inventory')).status).toBe(401);
  expect((await request(testApp(client)).get('/api/admin/mcp-discovery/inventory')).status).toBe(200);
  expect(client.getInventory).toHaveBeenCalledTimes(1);
});

test('proxies normalized inventory and scan responses', async () => {
  const client = {
    getInventory: jest.fn().mockResolvedValue({ records: [{ id: 'one', status: 'healthy' }] }),
    requestScan: jest.fn().mockResolvedValue({ scanId: 'scan-1' }),
  };
  const app = testApp(client);
  expect((await request(app).get('/api/admin/mcp-discovery/inventory')).body).toEqual({ records: [{ id: 'one', status: 'healthy' }] });
  const response = await request(app).post('/api/admin/mcp-discovery/scan').send({ credentials: 'secret', tool: 'call' });
  expect(response.status).toBe(202);
  expect(response.body).toEqual({ scanId: 'scan-1' });
  expect(client.requestScan).toHaveBeenCalledWith();
});

test('returns safe degraded error for an unavailable agent', async () => {
  const client = { getInventory: jest.fn().mockRejectedValue(Object.assign(new Error('agent offline'), { httpStatus: 503 })) };
  const response = await request(testApp(client)).get('/api/admin/mcp-discovery/inventory');
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ error: 'mcp_discovery_unavailable' });
});
