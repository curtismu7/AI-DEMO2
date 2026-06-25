/**
 * pingOneClientService.resolveWorkerCredentials
 *
 * The management-API identity is the worker app (client_credentials-enabled, holds the
 * management role). resolveWorkerCredentials must:
 *   - prefer the worker family over the legacy PINGONE_MGMT / PINGONE_MANAGEMENT keys, so
 *     a drifted PINGONE_MGMT_CLIENT_ID (e.g. a non-CC app) can't shadow the working worker;
 *   - return id + secret as a MATCHED pair (never a worker id with a management secret);
 *   - fall back to the management keys only when no worker family is configured.
 */
'use strict';

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));
const configStore = require('../../services/configStore');
const { resolveWorkerCredentials } = require('../../services/pingOneClientService');

function fromMap(map) {
  configStore.getEffective.mockImplementation((k) => (k in map ? map[k] : null));
}

beforeEach(() => jest.clearAllMocks());

test('prefers the worker family even when a (drifted) PINGONE_MGMT client is also set', () => {
  fromMap({
    PINGONE_WORKER_CLIENT_ID: 'worker-id',
    PINGONE_WORKER_CLIENT_SECRET: 'worker-secret',
    PINGONE_MGMT_CLIENT_ID: 'mgmt-no-cc-id',
    PINGONE_MGMT_CLIENT_SECRET: 'mgmt-secret',
  });
  expect(resolveWorkerCredentials(true)).toEqual({ clientId: 'worker-id', clientSecret: 'worker-secret' });
});

test('returns id + secret as a matched pair (no cross-family mixing)', () => {
  // Worker id present but NO worker secret → skip it and use the next complete family,
  // never pair worker-id with mgmt-secret.
  fromMap({
    PINGONE_WORKER_CLIENT_ID: 'worker-id',
    PINGONE_MGMT_CLIENT_ID: 'mgmt-id',
    PINGONE_MGMT_CLIENT_SECRET: 'mgmt-secret',
  });
  expect(resolveWorkerCredentials(true)).toEqual({ clientId: 'mgmt-id', clientSecret: 'mgmt-secret' });
});

test('falls back to PINGONE_MGMT_* when no worker family is configured', () => {
  fromMap({ PINGONE_MGMT_CLIENT_ID: 'mgmt-id', PINGONE_MGMT_CLIENT_SECRET: 'mgmt-secret' });
  expect(resolveWorkerCredentials(true)).toEqual({ clientId: 'mgmt-id', clientSecret: 'mgmt-secret' });
});

test('honors PINGONE_WORKER_TOKEN_* family', () => {
  fromMap({
    PINGONE_WORKER_TOKEN_CLIENT_ID: 'wt-id',
    PINGONE_WORKER_TOKEN_CLIENT_SECRET: 'wt-secret',
  });
  expect(resolveWorkerCredentials(true)).toEqual({ clientId: 'wt-id', clientSecret: 'wt-secret' });
});

test('when no secret is required (authMethod none/private_key_jwt), a secret-less id is accepted', () => {
  fromMap({ PINGONE_WORKER_CLIENT_ID: 'worker-id' });
  expect(resolveWorkerCredentials(false)).toEqual({ clientId: 'worker-id', clientSecret: null });
});

test('returns nulls when nothing is configured', () => {
  fromMap({});
  expect(resolveWorkerCredentials(true)).toEqual({ clientId: null, clientSecret: null });
});
