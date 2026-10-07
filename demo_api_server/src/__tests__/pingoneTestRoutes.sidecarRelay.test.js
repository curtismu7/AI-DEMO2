'use strict';

/**
 * POST /token-exchange (dual mode) with an exchanger the identity sidecar manages
 * (ff_agent_identity_sidecar): it exchanges as that client with no local secret;
 * unmanaged with no secret keeps the original actor-only exchange.
 */

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() }));

const mockConfig = { secret: '' };
jest.mock('../../services/configStore', () => ({
  ensureInitialized: jest.fn().mockResolvedValue(undefined),
  getEffective: jest.fn((key) => ({
    pingone_mcp_token_exchanger_client_id: 'exchanger-id',
    pingone_mcp_token_exchanger_client_secret: mockConfig.secret,
    pingone_resource_mcp_server_uri: 'mcpserver.ping.demo',
  })[key] || null),
}));
jest.mock('../../services/pingoneManagementService', () => ({ managementService: { initialize: jest.fn() } }));
jest.mock('../../services/oauthService', () => ({
  performTokenExchange: jest.fn(),
  performTokenExchangeAs: jest.fn(),
  performTokenExchangeWithActor: jest.fn(),
}));
jest.mock('../../services/apiCallTrackerService', () => ({ trackApiCall: jest.fn() }));
const mockRelay = { manages: jest.fn() };
jest.mock('../../services/sidecarClientRelay', () => mockRelay);

const request = require('supertest');
const express = require('express');
const oauthService = require('../../services/oauthService');

const jwt = `x.${Buffer.from(JSON.stringify({ sub: 'u' })).toString('base64url')}.y`;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.session = { oauthTokens: { accessToken: 'stub-token' } };
  next();
});
app.use('/', require('../../routes/pingoneTestRoutes'));

const call = () => request(app).post('/token-exchange').send({ mode: 'dual', subjectToken: 's', actorToken: 'a' });

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.secret = '';
  oauthService.performTokenExchangeAs.mockResolvedValue(jwt);
  oauthService.performTokenExchangeWithActor.mockResolvedValue(jwt);
});

test('a managed exchanger with no local secret exchanges as that client, passing no secret', async () => {
  mockRelay.manages.mockResolvedValue(true);

  const res = await call();

  expect(res.status).toBe(200);
  expect(oauthService.performTokenExchangeAs).toHaveBeenCalledTimes(1);
  const args = oauthService.performTokenExchangeAs.mock.calls[0];
  expect(args[2]).toBe('exchanger-id');
  expect(args[3]).toBeFalsy();
  expect(oauthService.performTokenExchangeWithActor).not.toHaveBeenCalled();
});

test('an unmanaged exchanger with no secret still takes the actor-only exchange', async () => {
  mockRelay.manages.mockResolvedValue(false);

  const res = await call();

  expect(res.status).toBe(200);
  expect(oauthService.performTokenExchangeWithActor).toHaveBeenCalledTimes(1);
  expect(oauthService.performTokenExchangeAs).not.toHaveBeenCalled();
});

test('an exchanger with a local secret never asks the sidecar', async () => {
  mockConfig.secret = 'local-secret';

  await call();

  expect(oauthService.performTokenExchangeAs).toHaveBeenCalledTimes(1);
  expect(mockRelay.manages).not.toHaveBeenCalled();
});
