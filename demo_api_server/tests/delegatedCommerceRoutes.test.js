'use strict';

const express = require('express');
const session = require('express-session');
const request = require('supertest');

jest.mock('../middleware/auth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requireScopes: () => (_req, _res, next) => next(),
  requireNotAdmin: (_req, _res, next) => next(),
}));
jest.mock('../services/delegatedCommerceService', () => ({
  register: jest.fn(),
  claim: jest.fn(),
  updateConsent: jest.fn(),
  revoke: jest.fn(),
  cleanup: jest.fn(),
  safeRegistration: jest.fn((record) => record),
}));
jest.mock('../services/lmdb/delegatedCommerceStore.lmdb', () => ({
  get: jest.fn(),
  put: jest.fn(),
}));
jest.mock('../services/lmdb/delegationStore.lmdb', () => ({
  findActiveByActorAndGrantor: jest.fn(),
  grantDelegation: jest.fn(),
  getDelegations: jest.fn(() => []),
}));
jest.mock('../services/delegationService', () => ({
  revokeDelegation: jest.fn(),
}));
jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  getMayActAttribute: jest.fn(),
  setMayActAttribute: jest.fn(),
  clearMayActIfMatches: jest.fn(),
}));
jest.mock('../services/lmdb/mcpAuditStore.lmdb', () => ({
  append: jest.fn(),
}));

const delegatedCommerceService = require('../services/delegatedCommerceService');
const delegatedCommerceStore = require('../services/lmdb/delegatedCommerceStore.lmdb');
const delegationStore = require('../services/lmdb/delegationStore.lmdb');
const pingOneUserService = require('../services/pingOneUserService');
const delegatedCommerceRouter = require('../routes/delegatedCommerce');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'delegated-commerce-test-secret',
      resave: false,
      saveUninitialized: true,
    }),
  );
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', email: 'user@example.com', role: 'customer' };
    req.session.delegatedCommerceRegistrationId = 'reg-1';
    req.session.oauthTokens = { accessToken: 'user-token' };
    next();
  });
  app.use('/api/delegated-commerce', delegatedCommerceRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  pingOneUserService.getMayActAttribute.mockResolvedValue(null);
  pingOneUserService.clearMayActIfMatches.mockResolvedValue(true);
});

it('returns safe registration data without a client secret', async () => {
  delegatedCommerceService.register.mockResolvedValue({
    registration: { id: 'reg-1', applicationId: 'agent-new', status: 'staged' },
    claimCode: 'AF-CODE',
    actorToken: { clientId: 'agent-new' },
  });
  const response = await request(makeApp())
    .post('/api/delegated-commerce/register')
    .send({ name: 'Shopping Agent' });
  expect(response.status).toBe(201);
  expect(response.body.registration.applicationId).toBe('agent-new');
  expect(response.body.clientSecret).toBeUndefined();
  expect(JSON.stringify(response.body)).not.toContain('secret-value');
});

it('rejects unknown consent scopes before writing mayAct', async () => {
  const response = await request(makeApp())
    .post('/api/delegated-commerce/consent')
    .send({ scopes: ['read', 'admin'] });
  expect(response.status).toBe(400);
  expect(response.body.error).toBe('invalid_consent_scopes');
  expect(pingOneUserService.setMayActAttribute).not.toHaveBeenCalled();
});

it('persists named scopes for the exact claimed agent', async () => {
  delegatedCommerceStore.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'claimed',
  });
  delegationStore.findActiveByActorAndGrantor.mockReturnValue(null);
  delegationStore.getDelegations.mockReturnValue([]);
  delegationStore.grantDelegation.mockReturnValue({ id: 'del-1' });
  delegatedCommerceService.updateConsent.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    status: 'active',
    scopes: ['read', 'write'],
  });

  const response = await request(makeApp())
    .post('/api/delegated-commerce/consent')
    .send({ scopes: ['read', 'write'] });
  expect(response.status).toBe(200);
  expect(pingOneUserService.setMayActAttribute).toHaveBeenCalledWith('user-1', {
    sub: 'agent-new',
  });
  expect(delegationStore.grantDelegation).toHaveBeenCalledWith(
    expect.objectContaining({
      delegator_user_id: 'user-1',
      delegate_email: 'agent-new',
      scopes: ['read', 'write'],
    }),
  );
});

it('compensates mayAct and local state when consent cannot be persisted', async () => {
  const registration = {
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'claimed',
    expiresAt: Date.now() + 60000,
  };
  const priorMayAct = { sub: 'agent-prior' };
  delegatedCommerceStore.get.mockReturnValue(registration);
  pingOneUserService.getMayActAttribute.mockResolvedValue(priorMayAct);
  delegationStore.grantDelegation.mockReturnValue({ id: 'del-1' });
  delegatedCommerceService.updateConsent.mockImplementation(() => {
    throw new Error('LMDB unavailable');
  });

  const response = await request(makeApp())
    .post('/api/delegated-commerce/consent')
    .send({ scopes: ['read'] });

  expect(response.status).toBe(502);
  // Restore the pre-request mayAct — do not wipe a still-valid prior agent.
  expect(pingOneUserService.setMayActAttribute).toHaveBeenLastCalledWith('user-1', priorMayAct);
  expect(delegatedCommerceStore.put).toHaveBeenCalledWith(registration);
});

it('does not authorize an expired registration', async () => {
  delegatedCommerceStore.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'active',
    scopes: ['read'],
    expiresAt: Date.now() - 1,
  });
  delegationStore.findActiveByActorAndGrantor.mockReturnValue({ id: 'del-1', scopes: ['read'] });

  const response = await request(makeApp()).get('/api/delegated-commerce/status');

  expect(response.body.authorized).toBe(false);
});

it('revokes mayAct and returns immutable audit evidence', async () => {
  delegatedCommerceStore.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    claimedByUserId: 'user-1',
    status: 'active',
    scopes: ['read'],
  });
  delegationStore.findActiveByActorAndGrantor.mockReturnValue(null);
  delegatedCommerceService.revoke.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    status: 'revoked',
  });

  const response = await request(makeApp())
    .post('/api/delegated-commerce/revoke')
    .send({ reason: 'Customer request' });
  expect(response.status).toBe(200);
  expect(pingOneUserService.clearMayActIfMatches).toHaveBeenCalledWith('user-1', 'agent-new');
  expect(pingOneUserService.setMayActAttribute).not.toHaveBeenCalledWith('user-1', null);
  expect(response.body.auditId).toMatch(/^delegated-revoke-/);
});
