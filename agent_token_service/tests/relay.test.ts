'use strict';

import axios from 'axios';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../src';
import type { BrokerConfig } from '../src/config';

jest.mock('axios');
const mockedPost = axios.post as jest.Mock;

const SECRET = 'primary-secret-value';
const OTHER_SECRET = 'exchanger-secret-value';

const config: BrokerConfig = {
  port: 3010,
  host: '127.0.0.1',
  apiKey: 'test-key',
  tokenEndpoint: 'https://auth.pingone.com/env-1/as/token',
  clientId: 'agent-client',
  clientSecret: SECRET,
  tokenAuthMethod: 'post',
  scope: 'agent:invoke',
  audience: '',
  resource: '',
  usePkiCreds: false,
  agentCertPath: '',
  targets: {},
  managedClients: [{ id: 'exchanger-client', secret: OTHER_SECRET, authMethod: 'basic' }],
};

const app = createApp(config, pino({ level: 'silent' }));
const relay = (kind: string, form: Record<string, string | string[]>) =>
  request(app).post(`/as/${kind}`).set('x-api-key', 'test-key').type('form').send(form);

const upstream = (status: number, body: string, contentType = 'application/json') =>
  mockedPost.mockResolvedValue({ status, headers: { 'content-type': contentType }, data: body });

beforeEach(() => {
  mockedPost.mockReset();
});

test('requires the api key', async () => {
  const res = await request(app).post('/as/token').type('form').send({ client_id: 'agent-client' });
  expect(res.status).toBe(401);
  expect(mockedPost).not.toHaveBeenCalled();
});

test('injects the client secret (post) and forwards the caller\'s other fields to the matching PingOne endpoint', async () => {
  upstream(200, '{"access_token":"tok"}');
  const res = await relay('token', { client_id: 'agent-client', grant_type: 'client_credentials', scope: 'agent:invoke' });

  expect(res.status).toBe(200);
  const [url, body] = mockedPost.mock.calls[0];
  expect(url).toBe('https://auth.pingone.com/env-1/as/token');
  const form = new URLSearchParams(body as string);
  expect(form.get('client_id')).toBe('agent-client');
  expect(form.get('client_secret')).toBe(SECRET);
  expect(form.get('grant_type')).toBe('client_credentials');
  expect(form.get('scope')).toBe('agent:invoke');
});

test('par and introspect go to their own PingOne paths', async () => {
  upstream(200, '{}');
  await relay('par', { client_id: 'agent-client' });
  await relay('introspect', { client_id: 'agent-client', token: 't' });
  expect(mockedPost.mock.calls[0][0]).toBe('https://auth.pingone.com/env-1/as/par');
  expect(mockedPost.mock.calls[1][0]).toBe('https://auth.pingone.com/env-1/as/introspect');
});

test('PingOne status and body are returned unchanged, errors included', async () => {
  upstream(401, '{"error":"invalid_client","error_description":"Request denied"}');
  const res = await relay('token', { client_id: 'agent-client', grant_type: 'client_credentials' });
  expect(res.status).toBe(401);
  expect(res.text).toBe('{"error":"invalid_client","error_description":"Request denied"}');
  expect(res.headers['content-type']).toMatch(/application\/json/);
});

test('a client that is not managed is refused and nothing is sent upstream', async () => {
  const res = await relay('token', { client_id: 'someone-else', grant_type: 'client_credentials' });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_client');
  expect(mockedPost).not.toHaveBeenCalled();
});

test('a request with no client_id is refused', async () => {
  const res = await relay('token', { grant_type: 'client_credentials' });
  expect(res.status).toBe(400);
  expect(mockedPost).not.toHaveBeenCalled();
});

test.each([
  ['client_secret', 'guessed'],
  ['client_assertion', 'a.b.c'],
  ['client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'],
])('a caller-supplied %s is refused: the sidecar never authenticates with a credential the caller chose', async (field, value) => {
  const res = await relay('token', { client_id: 'agent-client', [field]: value });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('invalid_request');
  expect(mockedPost).not.toHaveBeenCalled();
});

test('a basic-auth client gets an Authorization header and no secret or client_id in the body', async () => {
  upstream(200, '{}');
  await relay('introspect', { client_id: 'exchanger-client', token: 't' });
  const [, body, opts] = mockedPost.mock.calls[0];
  expect(opts.headers.Authorization).toBe(
    `Basic ${Buffer.from(`exchanger-client:${OTHER_SECRET}`).toString('base64')}`,
  );
  const form = new URLSearchParams(body as string);
  expect(form.has('client_id')).toBe(false);
  expect(form.has('client_secret')).toBe(false);
  expect(form.get('token')).toBe('t');
});

test('repeated form fields (RFC 8707 resource) are preserved', async () => {
  upstream(200, '{}');
  await relay('token', { client_id: 'agent-client', resource: ['https://a', 'https://b'] });
  expect(new URLSearchParams(mockedPost.mock.calls[0][1] as string).getAll('resource')).toEqual([
    'https://a',
    'https://b',
  ]);
});

test('endpoints outside token, par and introspect are not served', async () => {
  const res = await relay('revoke', { client_id: 'agent-client' });
  expect(res.status).toBe(404);
  expect(mockedPost).not.toHaveBeenCalled();
});

test('an unreachable PingOne is a 502 that does not carry the secret', async () => {
  mockedPost.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { config: { data: `client_secret=${SECRET}` } }));
  const res = await relay('token', { client_id: 'agent-client', grant_type: 'client_credentials' });
  expect(res.status).toBe(502);
  expect(JSON.stringify(res.body)).not.toContain(SECRET);
});

test('GET /v1/clients lists the managed client ids and never a secret', async () => {
  const res = await request(app).get('/v1/clients').set('x-api-key', 'test-key');
  expect(res.status).toBe(200);
  expect(res.body.clients.sort()).toEqual(['agent-client', 'exchanger-client']);
  expect(JSON.stringify(res.body)).not.toContain(SECRET);
  expect(JSON.stringify(res.body)).not.toContain(OTHER_SECRET);
  expect((await request(app).get('/v1/clients')).status).toBe(401);
});

test('a primary identity that uses private_key_jwt has no secret to inject, so it is not relayed', async () => {
  const pki = createApp({ ...config, usePkiCreds: true, clientSecret: '', managedClients: [] }, pino({ level: 'silent' }));
  const res = await request(pki).post('/as/token').set('x-api-key', 'test-key').type('form').send({ client_id: 'agent-client' });
  expect(res.status).toBe(400);
  expect(mockedPost).not.toHaveBeenCalled();
});
