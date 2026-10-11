'use strict';

/**
 * POST /api/demo/provision-wizard — welcome-wizard provisioning endpoint.
 *
 * Composes existing services into one idempotent per-person setup call:
 * customer user (email) + admin user (email → +admin), both with a random
 * temp password marked forceChange, mayAct delegation attribute, email + SMS
 * OTP enrolled, and (admin only) PingOne role assignments + admin_username
 * allowlist append so the BFF resolves the admin role at login.
 *
 * The endpoint must be idempotent: re-running with the same email reuses the
 * existing PingOne users instead of failing or duplicating.
 */

jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  searchUsers: jest.fn().mockResolvedValue({ _embedded: { users: [] } }),
  createPingOneUser: jest.fn().mockImplementation(async ({ email, username, role }) => ({
    id: role === 'admin' ? 'admin-user-1' : 'cust-user-1',
    email,
    username,
    name: { given: 'Demo', family: 'User' },
    enabled: true,
  })),
  updatePingOneUser: jest.fn().mockResolvedValue({}),
  setUserPassword: jest.fn().mockResolvedValue(undefined),
  setMayActAttribute: jest.fn().mockResolvedValue(undefined),
  ensureAdminRoleAssignments: jest.fn().mockResolvedValue({ assigned: ['Environment Admin'], existing: [], failed: [] }),
}));
jest.mock('../services/mfaService', () => ({
  enrollEmailDevice: jest.fn().mockResolvedValue({ id: 'device-email-1', status: 'ACTIVE' }),
  enrollSmsDevice: jest.fn().mockResolvedValue({ id: 'device-sms-1', status: 'ACTIVE' }),
}));
jest.mock('../services/configStore', () => {
  const store = {
    getEffective: jest.fn((key) => {
      if (key === 'admin_username' || key === 'ADMIN_USERNAME') return 'demoAdmin';
      if (key === 'pingone_mcp_token_exchanger_client_id') return 'mcp-exchanger-client';
      return null;
    }),
    setConfig: jest.fn().mockResolvedValue(undefined),
  };
  return store;
});
jest.mock('../data/store', () => ({
  seedAccountsForUser: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), logErrorHandling: jest.fn(), logAuthorizationAttempt: jest.fn() };
  return { logger, LOG_CATEGORIES: { USER_MANAGEMENT: 'user_management' } };
});

const express = require('express');
const request = require('supertest');

const pingOneUserService = require('../services/pingOneUserService');
const mfaService = require('../services/mfaService');
const configStore = require('../services/configStore');
const dataStore = require('../data/store');
const demoProvisioningRouter = require('../routes/demoProvisioning');

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use('/api/demo', demoProvisioningRouter);
  return app;
}

const basePayload = {
  email: 'se.new@pingidentity.com',
  cell: '+12065550123',
};

beforeEach(() => {
  jest.clearAllMocks();
  // Re-apply default mock resolvers cleared by clearAllMocks
  pingOneUserService.searchUsers.mockResolvedValue({ _embedded: { users: [] } });
  pingOneUserService.createPingOneUser.mockImplementation(async ({ email, username, role }) => ({
    id: role === 'admin' ? 'admin-user-1' : 'cust-user-1',
    email,
    username,
    name: { given: 'Demo', family: 'User' },
    enabled: true,
  }));
  pingOneUserService.updatePingOneUser.mockResolvedValue({});
  pingOneUserService.setUserPassword.mockResolvedValue(undefined);
  pingOneUserService.setMayActAttribute.mockResolvedValue(undefined);
  pingOneUserService.ensureAdminRoleAssignments.mockResolvedValue({ assigned: ['Environment Admin'], existing: [], failed: [] });
  mfaService.enrollEmailDevice.mockResolvedValue({ id: 'device-email-1', status: 'ACTIVE' });
  mfaService.enrollSmsDevice.mockResolvedValue({ id: 'device-sms-1', status: 'ACTIVE' });
  configStore.getEffective.mockImplementation((key) => {
    if (key === 'admin_username' || key === 'ADMIN_USERNAME') return 'demoAdmin';
    if (key === 'pingone_mcp_token_exchanger_client_id') return 'mcp-exchanger-client';
    return null;
  });
  configStore.setConfig.mockResolvedValue(undefined);
  dataStore.seedAccountsForUser.mockResolvedValue(undefined);
});

describe('POST /api/demo/provision-wizard', () => {
  test('requires admin caller', async () => {
    const res = await request(makeApp({ id: 'cust-1', role: 'customer' }))
      .post('/api/demo/provision-wizard')
      .send(basePayload);

    expect(res.status).toBe(403);
    expect(pingOneUserService.createPingOneUser).not.toHaveBeenCalled();
  });

  test('requires email and cell', async () => {
    const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
      .post('/api/demo/provision-wizard')
      .send({ email: 'se.new@pingidentity.com' });

    expect(res.status).toBe(400);
  });

  test('provisions customer + admin users with all steps', async () => {
    const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
      .post('/api/demo/provision-wizard')
      .send(basePayload);

    expect(res.status).toBe(201);

    // Two users created: customer (email as username) + admin (plus-addressed admin username)
    expect(pingOneUserService.createPingOneUser).toHaveBeenCalledTimes(2);
    const calls = pingOneUserService.createPingOneUser.mock.calls.map(c => c[0]);
    expect(calls[0]).toEqual(expect.objectContaining({
      email: 'se.new@pingidentity.com',
      username: 'se.new@pingidentity.com',
      role: 'customer',
    }));
    expect(calls[1]).toEqual(expect.objectContaining({
      username: 'se.new+admin@pingidentity.com',
      role: 'admin',
    }));

    // Mobile set on both (SMS target)
    expect(pingOneUserService.updatePingOneUser).toHaveBeenCalledTimes(2);

    // Passwords set twice, random per user, NOT the shared demo password
    expect(pingOneUserService.setUserPassword).toHaveBeenCalledTimes(2);
    const pw1 = pingOneUserService.setUserPassword.mock.calls[0][1];
    const pw2 = pingOneUserService.setUserPassword.mock.calls[1][1];
    expect(pw1).not.toBe('Baseball123!');
    expect(pw1).not.toBe(pw2);
    expect(pw1).toMatch(/[a-z]/);
    expect(pw1).toMatch(/[A-Z]/);
    expect(pw1).toMatch(/[0-9]/);

    // mayAct on both (token-exchanger client id resolved from config)
    expect(pingOneUserService.setMayActAttribute).toHaveBeenCalledTimes(2);

    // MFA: email + SMS on both
    expect(mfaService.enrollEmailDevice).toHaveBeenCalledTimes(2);
    expect(mfaService.enrollSmsDevice).toHaveBeenCalledTimes(2);

    // Banking data seeded for the customer user
    expect(dataStore.seedAccountsForUser).toHaveBeenCalledWith('cust-user-1');

    // PingOne role assignments for the admin user
    expect(pingOneUserService.ensureAdminRoleAssignments).toHaveBeenCalledWith('admin-user-1');

    // admin_username allowlist appended with the new admin username
    expect(configStore.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ admin_username: expect.stringContaining('se.new+admin@pingidentity.com') })
    );

    // Temp password returned once so the wizard can display it
    expect(res.body.credentials).toEqual(expect.objectContaining({
      customerUsername: 'se.new@pingidentity.com',
      adminUsername: 'se.new+admin@pingidentity.com',
      password: expect.any(String),
    }));
  });

  test('is idempotent — existing users are reused, not duplicated', async () => {
    pingOneUserService.searchUsers
      .mockResolvedValueOnce({ _embedded: { users: [{ id: 'existing-cust', username: 'se.new@pingidentity.com' }] } })
      .mockResolvedValueOnce({ _embedded: { users: [{ id: 'existing-admin', username: 'se.new+admin@pingidentity.com' }] } });

    const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
      .post('/api/demo/provision-wizard')
      .send(basePayload);

    expect(res.status).toBe(201);
    expect(pingOneUserService.createPingOneUser).not.toHaveBeenCalled();
    expect(pingOneUserService.setUserPassword).toHaveBeenCalledTimes(2);
    expect(mfaService.enrollEmailDevice).toHaveBeenCalledWith('existing-cust', 'se.new@pingidentity.com');
    expect(mfaService.enrollSmsDevice).toHaveBeenCalledWith('existing-admin', '+12065550123');
  });

  test('appends to a non-empty admin_username allowlist without dropping entries', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'admin_username' || key === 'ADMIN_USERNAME') return 'demoAdmin, other.admin@pingidentity.com';
      if (key === 'pingone_mcp_token_exchanger_client_id') return 'mcp-exchanger-client';
      return null;
    });

    await request(makeApp({ id: 'admin-1', role: 'admin' }))
      .post('/api/demo/provision-wizard')
      .send(basePayload);

    const written = configStore.setConfig.mock.calls.find(c => c[0].admin_username)[0].admin_username;
    expect(written).toContain('demoAdmin');
    expect(written).toContain('other.admin@pingidentity.com');
    expect(written).toContain('se.new+admin@pingidentity.com');
  });

  test('reports step errors without failing the whole request', async () => {
    mfaService.enrollSmsDevice.mockRejectedValue(new Error('SMS policy missing'));

    const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
      .post('/api/demo/provision-wizard')
      .send(basePayload);

    expect(res.status).toBe(207); // multi-status: partial success (repo convention, cf. adminDemoUsers)
    expect(res.body.errors.sms).toBeDefined();
    // Everything else still succeeded
    expect(res.body.steps.customer.created).toBe(true);
    expect(res.body.steps.customer.emailOtp).toBe(true);
    expect(res.body.steps.admin.emailOtp).toBe(true);
  });
});
