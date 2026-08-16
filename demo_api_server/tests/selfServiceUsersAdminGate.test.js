'use strict';

// Regression test for the privilege-escalation fix in routes/selfServiceUsers.js
// POST '/': a logged-in customer must not be able to grant themselves (or any
// new account) the 'admin' role by posting role: 'admin'. Legitimate
// self-service customer signup (role omitted or 'customer') must keep working.

jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  searchUsers: jest.fn().mockResolvedValue({ _embedded: { users: [] } }),
  createPingOneUser: jest.fn().mockImplementation(async ({ email, username, role }) => ({
    id: 'new-user-1',
    email,
    username,
    name: { given: 'Test', family: 'User' },
    enabled: true,
    role,
    createdAt: new Date().toISOString(),
  })),
  ensureAdminRoleAssignments: jest.fn().mockResolvedValue({ assigned: true }),
}));

const express = require('express');
const request = require('supertest');

const pingOneUserService = require('../services/pingOneUserService');
const selfServiceUsersRouter = require('../routes/selfServiceUsers');

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use('/api/self-service/users', selfServiceUsersRouter);
  return app;
}

const basePayload = {
  email: 'newuser@example.com',
  username: 'newuser1',
  firstName: 'New',
  lastName: 'User',
  password: 'Password123',
};

beforeEach(() => {
  jest.clearAllMocks();
  pingOneUserService.searchUsers.mockResolvedValue({ _embedded: { users: [] } });
  pingOneUserService.createPingOneUser.mockImplementation(async ({ email, username, role }) => ({
    id: 'new-user-1',
    email,
    username,
    name: { given: 'Test', family: 'User' },
    enabled: true,
    role,
    createdAt: new Date().toISOString(),
  }));
  pingOneUserService.ensureAdminRoleAssignments.mockResolvedValue({ assigned: true });
});

describe('POST /api/self-service/users — admin-role escalation gate', () => {
  test('a non-admin customer requesting role: "admin" is rejected with 403', async () => {
    const app = makeApp({ id: 'cust-1', role: 'customer' });

    const res = await request(app)
      .post('/api/self-service/users')
      .send({ ...basePayload, role: 'admin' });

    expect(res.status).toBe(403);
    expect(pingOneUserService.createPingOneUser).not.toHaveBeenCalled();
    expect(pingOneUserService.ensureAdminRoleAssignments).not.toHaveBeenCalled();
  });

  test('an unauthenticated caller requesting role: "admin" is rejected with 403', async () => {
    const app = makeApp(null);

    const res = await request(app)
      .post('/api/self-service/users')
      .send({ ...basePayload, role: 'admin' });

    expect(res.status).toBe(403);
    expect(pingOneUserService.createPingOneUser).not.toHaveBeenCalled();
  });

  test('an admin caller may still create an admin user via this endpoint', async () => {
    const app = makeApp({ id: 'admin-1', role: 'admin' });

    const res = await request(app)
      .post('/api/self-service/users')
      .send({ ...basePayload, email: 'newadmin@example.com', username: 'newadmin1', role: 'admin' });

    expect(res.status).toBe(201);
    expect(pingOneUserService.createPingOneUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' })
    );
    expect(pingOneUserService.ensureAdminRoleAssignments).toHaveBeenCalledWith('new-user-1');
  });

  test('legitimate customer self-service signup with no role still works', async () => {
    const app = makeApp({ id: 'cust-2', role: 'customer' });

    const res = await request(app)
      .post('/api/self-service/users')
      .send(basePayload);

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('customer');
    expect(pingOneUserService.createPingOneUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'customer' })
    );
  });

  test('legitimate customer self-service signup with explicit role: "customer" still works', async () => {
    const app = makeApp({ id: 'cust-3', role: 'customer' });

    const res = await request(app)
      .post('/api/self-service/users')
      .send({ ...basePayload, email: 'another@example.com', username: 'another1', role: 'customer' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('customer');
  });
});
