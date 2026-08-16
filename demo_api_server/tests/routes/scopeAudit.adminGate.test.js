'use strict';

/**
 * BUGS.md #12 — /api/admin/scope-audit was mounted with authenticateToken
 * only, no requireAdmin, unlike every sibling /api/admin/* route (see
 * server.js's mgmt-api mount for the established pattern). That let any
 * signed-in customer dump every PingOne resource server + its scopes
 * (GET /resources) and create a new OAuth scope on any resource
 * (POST /scopes) via the Management API worker token.
 *
 * This test rebuilds the same authenticateToken + requireAdmin + router
 * chain server.js now uses at the mount point, keeping the REAL requireAdmin
 * from middleware/auth so the gate itself is exercised, not a mock.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('worker-tkn'),
}));

// The route handlers make real PingOne Management API calls (axios) once past
// the gate — mock axios so an admin request never hits the network; we only
// care that the gate let the request reach the handler.
jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({ data: { _embedded: { resources: [] } } }),
  post: jest.fn().mockResolvedValue({ data: { id: 'scope-1', name: 's1' } }),
}));

// authenticateToken is faked (no real JWT to verify here); requireAdmin is
// the genuine implementation from middleware/auth.
jest.mock('../../middleware/auth', () => {
  const actual = jest.requireActual('../../middleware/auth');
  return {
    ...actual,
    authenticateToken: (req, res, next) => {
      const role = req.headers['x-test-role'];
      req.user = role ? { id: 'u1', username: 'tester', role, scopes: [] } : undefined;
      next();
    },
  };
});

const { authenticateToken, requireAdmin } = require('../../middleware/auth');
const scopeAuditRoutes = require('../../routes/scopeAudit');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/scope-audit', authenticateToken, requireAdmin, scopeAuditRoutes);
  return app;
}

describe('scope-audit admin gate (BUGS.md #12)', () => {
  test('GET /resources — non-admin authenticated user gets 403', async () => {
    const res = await request(buildApp())
      .get('/api/admin/scope-audit/resources')
      .set('x-test-role', 'customer');
    expect(res.status).toBe(403);
  });

  test('POST /scopes — non-admin authenticated user gets 403', async () => {
    const res = await request(buildApp())
      .post('/api/admin/scope-audit/scopes')
      .set('x-test-role', 'customer')
      .send({ resourceId: 'r1', scopeName: 's1' });
    expect(res.status).toBe(403);
  });

  test('GET /resources — admin user clears the gate (route runs, no 401/403)', async () => {
    const res = await request(buildApp())
      .get('/api/admin/scope-audit/resources')
      .set('x-test-role', 'admin');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test('POST /scopes — admin user clears the gate (route runs, no 401/403)', async () => {
    const res = await request(buildApp())
      .post('/api/admin/scope-audit/scopes')
      .set('x-test-role', 'admin')
      .send({ resourceId: 'r1', scopeName: 's1' });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
