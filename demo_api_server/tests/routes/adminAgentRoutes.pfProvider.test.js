'use strict';

// The PingOne Admin gate must be told which provider signed the admin in. The
// admin sign-in records that on the SESSION; the user record always says
// 'pingone_sso'. Reading the user record first sent every PingFederate admin
// down the PingOne path, where the group lookup 400s.

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/agentSessionMiddleware', () => ({
  agentSessionMiddleware: (req, res, next) => {
    req.agentContext = { userId: 'demoadmin', accessToken: 'tok' };
    next();
  },
}));
jest.mock('../../services/requestEventEmitter', () => ({
  requestEventEmitterMiddleware: (req, res, next) => next(),
}));
jest.mock('../../services/pingOneAdminAccessService', () => ({
  checkAccess: jest.fn(),
}));
jest.mock('../../services/adminAgentService', () => ({
  processAdminMessage: jest.fn(async () => ({ reply: 'ok', success: true, toolsCalled: [], tokenEvents: [] })),
}));
jest.mock('../../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../../services/lmdb/conversationStore.lmdb', () => ({ saveMessage: jest.fn() }));
jest.mock('../../services/lmdb/reportStore.lmdb', () => ({ saveRun: jest.fn() }));

const adminAgentRoutes = require('../../routes/adminAgentRoutes');
const { checkAccess } = require('../../services/pingOneAdminAccessService');

function buildApp(session) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = session; next(); });
  app.use('/api/admin-agent', adminAgentRoutes);
  return app;
}

test('passes the session provider to the gate, not the user record\'s', async () => {
  checkAccess.mockResolvedValue({ allowed: true });
  const app = buildApp({ id: 's', oauthProvider: 'pingfederate', user: { username: 'demoadmin', oauthProvider: 'pingone_sso' } });

  await request(app).post('/api/admin-agent/message').send({ message: 'list users' }).expect(200);

  expect(checkAccess).toHaveBeenCalledWith(expect.objectContaining({ username: 'demoadmin', oauthProvider: 'pingfederate' }));
});

test('an unlinked PingFederate user gets a 403 that names the cause', async () => {
  checkAccess.mockResolvedValue({
    allowed: false, error: 'pingone_admin_user_not_linked', status: 403, requiredGroup: 'pingone-admin', username: 'demoadmin',
  });
  const app = buildApp({ id: 's', oauthProvider: 'pingfederate', user: { username: 'demoadmin' } });

  const res = await request(app).post('/api/admin-agent/message').send({ message: 'list users' }).expect(403);

  expect(res.body).toMatchObject({ error: 'pingone_admin_user_not_linked', success: false });
  expect(res.body.reply).toContain("PingOne has no account with that username");
});
