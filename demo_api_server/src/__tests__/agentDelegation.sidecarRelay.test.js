'use strict';

/**
 * POST /api/agent/delegate with an exchanger the identity sidecar manages
 * (ff_agent_identity_sidecar): no local secret is needed; unmanaged is unchanged.
 */

jest.mock('../../services/oauthService');
jest.mock('../../services/configStore');
const mockRelay = { manages: jest.fn() };
jest.mock('../../services/sidecarClientRelay', () => mockRelay);

const express = require('express');
const request = require('supertest');
const oauthService = require('../../services/oauthService');
const configStore = require('../../services/configStore');
const router = require('../../routes/agentDelegation');

function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const app = express();
app.use('/api/agent', router);

const call = () => request(app)
  .post('/api/agent/delegate')
  .set('Authorization', `Bearer ${fakeJwt({ sub: 'user-123', scope: 'read' })}`)
  .send({});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AGENT_OAUTH_CLIENT_SECRET;
  configStore.getEffective = jest.fn((key) => ({
    pingone_mcp_token_exchanger_client_id: 'exchanger-id',
    pingone_resource_mcp_server_uri: 'https://mcp.example.com',
  })[key] || null);
  oauthService.getClientCredentialsTokenAs = jest.fn().mockResolvedValue('actor-token');
  oauthService.performTokenExchangeWithActor = jest.fn().mockResolvedValue(fakeJwt({
    sub: 'user-123', aud: 'https://mcp.example.com', scope: 'read',
    exp: Math.floor(Date.now() / 1000) + 3600, act: { sub: 'exchanger-id' },
  }));
});

test('a managed exchanger with no local secret delegates, passing no secret', async () => {
  mockRelay.manages.mockResolvedValue(true);

  const res = await call();

  expect(res.status).toBe(200);
  expect(oauthService.getClientCredentialsTokenAs.mock.calls[0][0]).toBe('exchanger-id');
  expect(oauthService.getClientCredentialsTokenAs.mock.calls[0][1]).toBeFalsy();
});

test('an unmanaged exchanger with no secret is still 503 agent_not_configured', async () => {
  mockRelay.manages.mockResolvedValue(false);

  const res = await call();

  expect(res.status).toBe(503);
  expect(res.body.error).toBe('agent_not_configured');
  expect(oauthService.getClientCredentialsTokenAs).not.toHaveBeenCalled();
});
