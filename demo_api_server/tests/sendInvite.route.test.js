'use strict';

// POST /api/demo/send-invite — admin-triggered invite. Idempotent user
// create-or-reuse via the shipped provisioning helpers; the PingOne-native
// "set your password" email is behind the Task 1 spike gate.

jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  searchUsers: jest.fn().mockResolvedValue({ _embedded: { users: [] } }),
  createPingOneUser: jest.fn().mockImplementation(async (u) => ({ id: 'user-1', email: u.email, username: u.username })),
  setUserPassword: jest.fn().mockResolvedValue(undefined),
  updatePingOneUser: jest.fn().mockResolvedValue({}),
  setMayActAttribute: jest.fn().mockResolvedValue(undefined),
  sendPasswordSetupEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/mfaService', () => ({
  enrollEmailDevice: jest.fn().mockResolvedValue({ id: 'd-e' }),
  enrollSmsDevice: jest.fn().mockResolvedValue({ id: 'd-s' }),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((k) => {
    if (k === 'pingone_mcp_token_exchanger_client_id') return 'mcp-exchanger-client';
    if (k === 'public_app_url' || k === 'PUBLIC_APP_URL') return 'https://ai-demo.ping-devops.com';
    return null;
  }),
  setConfig: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../data/store', () => ({ seedAccountsForUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), logErrorHandling: jest.fn(), logAuthorizationAttempt: jest.fn() };
  return { logger, LOG_CATEGORIES: { USER_MANAGEMENT: 'user_management' } };
});

const express = require('express');
const request = require('supertest');
const pingOneUserService = require('../services/pingOneUserService');
const mfaService = require('../services/mfaService');
const dataStore = require('../data/store');
const sendInviteRouter = require('../routes/demoProvisioning');

function makeApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (user) req.user = user; next(); });
  app.use('/api/demo', sendInviteRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  pingOneUserService.searchUsers.mockResolvedValue({ _embedded: { users: [] } });
  pingOneUserService.createPingOneUser.mockImplementation(async (u) => ({ id: 'user-1', email: u.email, username: u.username }));
  pingOneUserService.setUserPassword.mockResolvedValue(undefined);
  pingOneUserService.updatePingOneUser.mockResolvedValue({});
  pingOneUserService.setMayActAttribute.mockResolvedValue(undefined);
  pingOneUserService.sendPasswordSetupEmail.mockResolvedValue(undefined);
  mfaService.enrollEmailDevice.mockResolvedValue({ id: 'd-e' });
  mfaService.enrollSmsDevice.mockResolvedValue({ id: 'd-s' });
  dataStore.seedAccountsForUser.mockResolvedValue(undefined);
});

describe('POST /api/demo/send-invite', () => {
  test('403 without an admin session', async () => {
    const res = await request(makeApp({ id: 'cust-1', role: 'customer' }))
      .post('/api/demo/send-invite').send({ email: 'a@pingidentity.com' });
    expect(res.status).toBe(403);
    expect(pingOneUserService.createPingOneUser).not.toHaveBeenCalled();
  });

  test('400 on invalid email', async () => {
    const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
      .post('/api/demo/send-invite').send({ email: 'nope' });
    expect(res.status).toBe(400);
  });

  test('201 with registrationUrl pointing at /welcome?welcome=1', async () => {
    const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
      .post('/api/demo/send-invite').send({ email: 'new@pingidentity.com' });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe('user-1');
    expect(res.body.invite).toBe('sent');
    expect(res.body.nativeEmail).toBe('sent');
    expect(res.body.registrationUrl).toContain('/welcome?welcome=1');
    // Provisioned like a wizard customer: password with forceChange, MFA, banking seed
    expect(pingOneUserService.setUserPassword).toHaveBeenCalledWith('user-1', expect.any(String), { forceChange: true });
    expect(mfaService.enrollEmailDevice).toHaveBeenCalled();
    expect(dataStore.seedAccountsForUser).toHaveBeenCalledWith('user-1');
  });

  test('idempotent re-invite reuses the existing user (no 409)', async () => {
    pingOneUserService.searchUsers
      .mockResolvedValueOnce({ _embedded: { users: [] } })
      .mockResolvedValueOnce({ _embedded: { users: [{ id: 'existing-1', username: 'dup@pingidentity.com' }] } });
    const app = makeApp({ id: 'admin-1', role: 'admin' });
    await request(app).post('/api/demo/send-invite').send({ email: 'dup@pingidentity.com' });
    const res = await request(app).post('/api/demo/send-invite').send({ email: 'dup@pingidentity.com' });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe('existing-1');
    expect(pingOneUserService.createPingOneUser).toHaveBeenCalledTimes(1);
  });

  test('native email skipped when provisioning steps have errors', async () => {
    mfaService.enrollSmsDevice.mockRejectedValue(new Error('SMS policy missing'));
    const res = await request(makeApp({ id: 'admin-1', role: 'admin' }))
      .post('/api/demo/send-invite').send({ email: 'partial@pingidentity.com' });
    expect(res.status).toBe(201); // provisioning is partial, invite still works
    expect(res.body.nativeEmail).toBe('skipped');
    expect(pingOneUserService.sendPasswordSetupEmail).not.toHaveBeenCalled();
  });
});
