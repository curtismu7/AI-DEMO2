'use strict';

// Consent and revoke for a delegated-commerce agent under a PingFederate
// sign-in. The session subject is a PingFederate username; mayAct lives on the
// PingOne account with the same username, and the agent can only act if it was
// registered with a PingFederate client.

const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireScopes: () => (_req, _res, next) => next(),
  requireNotAdmin: (_req, _res, next) => next(),
}));
jest.mock('../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingfederate'),
  getEffective: jest.fn(() => null),
}));
jest.mock('../services/delegatedCommerceService', () => ({
  updateConsent: jest.fn((id, scopes) => ({ id, scopes, status: 'active' })),
  revoke: jest.fn((id) => ({ id, status: 'revoked' })),
  safeRegistration: jest.fn((record) => record),
}));
jest.mock('../services/lmdb/delegatedCommerceStore.lmdb', () => ({ get: jest.fn(), put: jest.fn() }));
jest.mock('../services/lmdb/delegationStore.lmdb', () => ({
  findActiveByActorAndGrantor: jest.fn(),
  grantDelegation: jest.fn(() => ({ id: 'delegation-1' })),
  getDelegations: jest.fn(() => []),
}));
jest.mock('../services/delegationService', () => ({ revokeDelegation: jest.fn() }));
jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  getMayActAttribute: jest.fn(async () => ({ sub: 'built-in-agent' })),
  setMayActAttribute: jest.fn(async () => {}),
  clearMayActIfMatches: jest.fn(async () => true),
}));
jest.mock('../services/lmdb/mcpAuditStore.lmdb', () => ({ append: jest.fn() }));
jest.mock('../services/agentTokenCache', () => ({ clear: jest.fn() }));
jest.mock('../services/pingOneUserLookupService', () => ({ fetchPingOneUserByUsername: jest.fn() }));

const delegatedCommerceService = require('../services/delegatedCommerceService');
const delegatedCommerceStore = require('../services/lmdb/delegatedCommerceStore.lmdb');
const pingOneUserService = require('../services/pingOneUserService');
const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');
const delegatedCommerceRouter = require('../routes/delegatedCommerce');

const registration = {
  id: 'reg-1', applicationId: 'agent-123', claimedByUserId: 'demouser', status: 'claimed',
  expiresAt: Date.now() + 60_000, pfClient: true,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'demouser', email: 'demouser@example.com', role: 'customer' };
    req.session = {
      oauthProvider: 'pingfederate',
      user: { username: 'demouser', oauthId: 'demouser' },
      delegatedCommerceRegistrationId: 'reg-1',
      oauthTokens: { accessToken: 'pf-user-token' },
      save: (cb) => cb(),
    };
    next();
  });
  app.use('/api/delegated-commerce', delegatedCommerceRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  delegatedCommerceStore.get.mockReturnValue(registration);
  fetchPingOneUserByUsername.mockResolvedValue({ user: { id: 'p1-uuid' }, error: null });
});

test('consent writes the agent onto the PingOne account and remembers which account', async () => {
  await request(makeApp()).post('/api/delegated-commerce/consent').send({ scopes: ['read'] }).expect(200);

  expect(pingOneUserService.getMayActAttribute).toHaveBeenCalledWith('p1-uuid');
  expect(pingOneUserService.setMayActAttribute).toHaveBeenCalledWith('p1-uuid', { sub: 'agent-123' });
  expect(delegatedCommerceService.updateConsent).toHaveBeenCalledWith('reg-1', ['read'], 'p1-uuid');
});

test('consent is refused for an agent registered without a PingFederate client', async () => {
  delegatedCommerceStore.get.mockReturnValue({ ...registration, pfClient: false });

  const res = await request(makeApp()).post('/api/delegated-commerce/consent').send({ scopes: ['read'] }).expect(409);

  // Writing mayAct here would replace the user's working grant with an agent
  // PingFederate can never issue a token for.
  expect(res.body.error).toBe('delegated_agent_pf_client_missing');
  expect(pingOneUserService.setMayActAttribute).not.toHaveBeenCalled();
});

test('consent is refused, with nothing written, when PingOne has no account for the user', async () => {
  fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'not_found' });

  const res = await request(makeApp()).post('/api/delegated-commerce/consent').send({ scopes: ['read'] }).expect(409);

  expect(res.body.error).toBe('pingone_user_not_linked');
  expect(pingOneUserService.setMayActAttribute).not.toHaveBeenCalled();
});

test('revoke clears mayAct on the account consent recorded', async () => {
  delegatedCommerceStore.get.mockReturnValue({ ...registration, status: 'active', claimedByPingOneUserId: 'p1-uuid' });

  await request(makeApp()).post('/api/delegated-commerce/revoke').send({}).expect(200);

  expect(pingOneUserService.clearMayActIfMatches).toHaveBeenCalledWith('p1-uuid', 'agent-123');
});
