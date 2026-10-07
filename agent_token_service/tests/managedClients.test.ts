'use strict';

import { loadConfig } from '../src/config';

const ENV_KEYS = [
  'BROKER_API_KEY',
  'PINGONE_TOKEN_ENDPOINT',
  'PINGONE_AGENT_CLIENT_ID',
  'PINGONE_AGENT_CLIENT_SECRET',
  'MANAGED_CLIENTS_JSON',
  'EXCHANGER_SECRET',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.BROKER_API_KEY = 'k';
  process.env.PINGONE_TOKEN_ENDPOINT = 'https://auth.pingone.com/env/as/token';
  process.env.PINGONE_AGENT_CLIENT_ID = 'client';
  process.env.PINGONE_AGENT_CLIENT_SECRET = 'secret';
  delete process.env.MANAGED_CLIENTS_JSON;
  delete process.env.EXCHANGER_SECRET;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test('no MANAGED_CLIENTS_JSON means no extra clients', () => {
  expect(loadConfig().managedClients).toEqual([]);
});

test('a client takes its secret from the env var it names, not from the JSON', () => {
  process.env.EXCHANGER_SECRET = 'exchanger-secret';
  process.env.MANAGED_CLIENTS_JSON = JSON.stringify([{ id: 'ex', secretEnv: 'EXCHANGER_SECRET', authMethod: 'basic' }]);
  expect(loadConfig().managedClients).toEqual([{ id: 'ex', secret: 'exchanger-secret', authMethod: 'basic' }]);
});

test('authMethod defaults to post', () => {
  process.env.EXCHANGER_SECRET = 's';
  process.env.MANAGED_CLIENTS_JSON = JSON.stringify([{ id: 'ex', secretEnv: 'EXCHANGER_SECRET' }]);
  expect(loadConfig().managedClients?.[0].authMethod).toBe('post');
});

test('a named secret env var that is not set stops the sidecar at startup', () => {
  process.env.MANAGED_CLIENTS_JSON = JSON.stringify([{ id: 'ex', secretEnv: 'EXCHANGER_SECRET' }]);
  expect(() => loadConfig()).toThrow(/EXCHANGER_SECRET is not set/);
});

test.each([
  ['not json', /not valid JSON/],
  ['{"id":"x"}', /must be an array/],
  [JSON.stringify([{ secretEnv: 'EXCHANGER_SECRET' }]), /has no "id"/],
  [JSON.stringify([{ id: 'ex' }]), /has no "secretEnv"/],
])('a malformed registry (%s) fails at startup', (value, message) => {
  process.env.MANAGED_CLIENTS_JSON = value;
  expect(() => loadConfig()).toThrow(message);
});
