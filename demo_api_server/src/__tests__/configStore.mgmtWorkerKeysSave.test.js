/**
 * @file configStore.mgmtWorkerKeysSave.test.js
 * @description Same class as finding #32 (see configStore.mgmtPrivateKeySave.test.js):
 * pingone_mgmt_client_id / _client_secret / _token_auth_method were referenced in
 * SECRET_KEYS and the env-alias table but were missing from FIELD_DEFS, so
 * setConfig's unknown-key guard (`if (!(key in FIELD_DEFS)) continue;`) would
 * silently drop any of them -- a write that reports ok:true and persists nothing.
 * No setConfig call site writes them today; this pins the registration so one can.
 */
'use strict';

const ENV_KEYS = [
  'PINGONE_MGMT_CLIENT_ID', 'PINGONE_MANAGEMENT_CLIENT_ID', 'PINGONE_ADMIN_CLIENT_ID',
  'PINGONE_WORKER_TOKEN_CLIENT_ID', 'PINGONE_WORKER_CLIENT_ID',
  'PINGONE_MGMT_CLIENT_SECRET', 'PINGONE_MANAGEMENT_CLIENT_SECRET', 'PINGONE_ADMIN_CLIENT_SECRET',
  'PINGONE_WORKER_TOKEN_CLIENT_SECRET', 'PINGONE_WORKER_CLIENT_SECRET',
  'PINGONE_MGMT_TOKEN_AUTH_METHOD', 'PINGONE_WORKER_TOKEN_AUTH_METHOD',
];

describe('configStore management-worker key registration', () => {
  let orig;

  beforeEach(() => {
    // getEffective reads the env-alias table AHEAD of FIELD_DEFS, so any of
    // these left set would mask what this spec is actually asserting.
    orig = {};
    for (const k of ENV_KEYS) { orig[k] = process.env[k]; delete process.env[k]; }
    jest.resetModules();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (orig[k] === undefined) delete process.env[k];
      else process.env[k] = orig[k];
    }
    jest.resetModules();
  });

  it.each([
    ['pingone_mgmt_client_id', 'worker-client-id-123'],
    ['pingone_mgmt_client_secret', 'worker-secret-abc'],
    ['pingone_mgmt_token_auth_method', 'private_key_jwt'],
  ])('setConfig persists %s instead of silently dropping it', async (key, value) => {
    const configStore = require('../../services/configStore');
    await configStore.setConfig({ [key]: value });
    expect(configStore.getEffective(key)).toBe(value);
  });

  it('all three are registered in FIELD_DEFS', () => {
    const configStore = require('../../services/configStore');
    for (const key of ['pingone_mgmt_client_id', 'pingone_mgmt_client_secret', 'pingone_mgmt_token_auth_method']) {
      expect(configStore.FIELD_DEFS).toHaveProperty(key);
    }
  });

  // The default must not become a new opinion about worker auth: every consumer
  // (pingOneClientService, pingOneUserService, pingoneTestRoutes) already reads
  // `getEffective(...) || 'basic'`, so anything other than 'basic'/'' here would
  // silently flip the Management API worker's client authentication method.
  it('token_auth_method defaults to basic, matching every consumer fallback', () => {
    const configStore = require('../../services/configStore');
    expect(configStore.getEffective('pingone_mgmt_token_auth_method')).toBe('basic');
  });
});
