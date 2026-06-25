'use strict';

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, res, next) => next(),
  authenticateToken: (req, res, next) => { req.user = { id: 'admin-1' }; next(); },
}));

jest.mock('../services/pingoneManagementService', () => ({
  managementService: {
    initialize: jest.fn(),
    baseURL: 'https://api.pingone.com/v1/environments/test-env',
    getHeaders: jest.fn(() => ({ Authorization: 'Bearer worker-token' })),
  },
}));

jest.mock('axios', () => ({
  patch: jest.fn().mockResolvedValue({ data: { agentRestrictions: 'read' } }),
}));

jest.mock('../middleware/agentRestrictionsCache', () => ({
  cache: { get: jest.fn(() => null), set: jest.fn(), invalidate: jest.fn() },
}));

const request = require('supertest');
const express = require('express');

let adminManagementRoutes;
let app;

beforeEach(() => {
  jest.clearAllMocks();
  // Re-require after resetModules so all module-level variables
  // bind to the current (fresh) mock instances.
  adminManagementRoutes = require('../routes/adminManagement');
  app = express();
  app.use(express.json());
  app.use('/api/admin/management', adminManagementRoutes);

  // Restore mock implementations
  require('axios').patch.mockResolvedValue({ data: { agentRestrictions: 'read' } });
  require('../services/pingoneManagementService').managementService.getHeaders
    .mockReturnValue({ Authorization: 'Bearer worker-token' });
  require('../middleware/agentRestrictionsCache').cache.invalidate.mockImplementation(() => {});
});

describe('PATCH /users/:userId/agent-restrictions', () => {
  test('returns 400 for invalid value', async () => {
    const res = await request(app)
      .patch('/api/admin/management/users/user-1/agent-restrictions')
      .send({ agentRestrictions: 'superadmin' });
    expect(res.status).toBe(400);
  });

  test('returns 200 and calls PingOne PATCH for valid value', async () => {
    const axios = require('axios');
    const { managementService } = require('../services/pingoneManagementService');
    const res = await request(app)
      .patch('/api/admin/management/users/user-1/agent-restrictions')
      .send({ agentRestrictions: 'read' });
    expect(res.status).toBe(200);
    expect(axios.patch).toHaveBeenCalledWith(
      `${managementService.baseURL}/users/user-1`,
      { agentRestrictions: 'read' },
      { headers: managementService.getHeaders() }
    );
  });

  test('invalidates the attribute cache on success', async () => {
    const { cache } = require('../middleware/agentRestrictionsCache');
    await request(app)
      .patch('/api/admin/management/users/user-1/agent-restrictions')
      .send({ agentRestrictions: 'none' });
    expect(cache.invalidate).toHaveBeenCalledWith('user-1');
  });
});
