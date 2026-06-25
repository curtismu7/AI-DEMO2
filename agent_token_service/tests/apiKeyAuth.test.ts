'use strict';

import request from 'supertest';
import pino from 'pino';
import { createApp } from '../src/index';
import type { BrokerConfig } from '../src/config';

// Stub the PingOne call so the route never touches the network.
jest.mock('../src/pingoneAgentToken', () => ({
  acquireAgentToken: jest.fn(async () => ({
    accessToken: 'tok-abc',
    tokenType: 'Bearer',
    expiresIn: 300,
    scope: 'read write',
  })),
}));

const config: BrokerConfig = {
  port: 3010,
  host: '127.0.0.1',
  apiKey: 'right-key',
  tokenEndpoint: 'https://auth.pingone.com/env/as/token',
  clientId: 'copilot-agent-client',
  clientSecret: 'secret',
  tokenAuthMethod: 'post',
  scope: 'agent:invoke',
  audience: '',
  usePkiCreds: false,
  agentCertPath: '',
};

const app = createApp(config, pino({ level: 'silent' }));

test('GET /healthz is unauthenticated and returns ok', async () => {
  const res = await request(app).get('/healthz');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});

test('POST /token without x-api-key → 401', async () => {
  const res = await request(app).post('/token');
  expect(res.status).toBe(401);
  expect(res.body.error).toBe('invalid_api_key');
});

test('POST /token with wrong x-api-key → 401', async () => {
  const res = await request(app).post('/token').set('x-api-key', 'wrong-key');
  expect(res.status).toBe(401);
});

test('POST /token with correct x-api-key → 200 + token JSON', async () => {
  const res = await request(app).post('/token').set('x-api-key', 'right-key');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    access_token: 'tok-abc',
    token_type: 'Bearer',
    expires_in: 300,
    scope: 'read write',
  });
});
