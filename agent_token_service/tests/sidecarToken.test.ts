'use strict';

import axios from 'axios';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src';
import { clearTokenCache } from '../src/pingoneAgentToken';
import type { BrokerConfig } from '../src/config';

jest.mock('axios');
const mockedPost = axios.post as jest.Mock;

const config: BrokerConfig = {
  port: 3010,
  host: '127.0.0.1',
  apiKey: 'test-key',
  tokenEndpoint: 'https://auth.pingone.com/env/as/token',
  clientId: 'langchain-agent-client',
  clientSecret: 'super-secret-value',
  tokenAuthMethod: 'post',
  scope: 'agent:invoke',
  audience: '',
  resource: '',
  usePkiCreds: false,
  agentCertPath: '',
  targets: {
    'mcp-gateway': { scope: 'ai_agent', resource: 'https://mcpgateway.ping.demo' },
    'other': { scope: 'ai_agent', resource: 'https://other.ping.demo' },
  },
};

const app = createApp(config, pino({ level: 'silent' }));
const post = (body: object) => request(app).post('/v1/token').set('x-api-key', 'test-key').send(body);

beforeEach(() => {
  clearTokenCache();
  mockedPost.mockReset();
  mockedPost.mockResolvedValue({ data: { access_token: 'tok', expires_in: 300, scope: 'ai_agent' } });
});

test('rejects a call without the api key', async () => {
  const res = await request(app).post('/v1/token').send({ target: 'mcp-gateway' });
  expect(res.status).toBe(401);
  expect(mockedPost).not.toHaveBeenCalled();
});

test('target selects the scope and resource sent to PingOne', async () => {
  const res = await post({ target: 'mcp-gateway' });
  expect(res.status).toBe(200);
  expect(res.body.access_token).toBe('tok');
  const body = mockedPost.mock.calls[0][1] as string;
  expect(body).toContain('scope=ai_agent');
  expect(body).toContain('resource=https%3A%2F%2Fmcpgateway.ping.demo');
});

test('unknown target is a 400 and never reaches PingOne', async () => {
  for (const target of ['nope', 'constructor', '__proto__']) {
    const res = await post({ target });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_target');
  }
  expect(mockedPost).not.toHaveBeenCalled();
});

test('no target uses the default identity scope', async () => {
  await post({});
  expect(mockedPost.mock.calls[0][1] as string).toContain('scope=agent%3Ainvoke');
});

test('tokens are cached per target, not shared across targets', async () => {
  await post({ target: 'mcp-gateway' });
  await post({ target: 'mcp-gateway' });
  expect(mockedPost).toHaveBeenCalledTimes(1);
  await post({ target: 'other' });
  expect(mockedPost).toHaveBeenCalledTimes(2);
});

test('upstream failure is a 502 that does not leak the secret', async () => {
  mockedPost.mockRejectedValueOnce({ response: { status: 401, data: { error: 'invalid_client' } } });
  const res = await post({ target: 'mcp-gateway' });
  expect(res.status).toBe(502);
  expect(JSON.stringify(res.body)).not.toContain('super-secret-value');
});
