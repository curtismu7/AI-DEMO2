'use strict';

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (req, _res, next) => next(),
  requireScopes: () => (req, _res, next) => next(),
}));

jest.mock('../services/killSwitchService', () => ({
  enableAgentApplicationsAtPingOne: jest.fn(async () => ([{ id: 'app-1', enabled: true }])),
  unrevokeAgent: jest.fn(async () => true),
}));

jest.mock('../services/agentLifecycleEvents', () => ({
  emit: jest.fn(() => ({ eventId: 'ale-1' })),
  query: jest.fn(() => []),
  summary: jest.fn(() => ({ totalEvents: 0, byEventType: {} })),
}));

const request = require('supertest');
const express = require('express');

test('POST /agent/:agentId/re-enable emits a mover lifecycle event', async () => {
  const adminRoutes = require('../routes/admin');
  const agentLifecycleEvents = require('../services/agentLifecycleEvents');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);

  const res = await request(app).post('/api/admin/agent/demo-agent/re-enable').send({});

  expect(res.status).toBe(200);
  expect(agentLifecycleEvents.emit).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: 'mover', agentId: 'demo-agent', kind: 'live', reason: 're-enable' })
  );
});
