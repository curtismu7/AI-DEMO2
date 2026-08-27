/**
 * @file configStore.mgmtPrivateKeySave.test.js
 * @description Regression (finding #32): POST /api/admin/config/generate-keypair
 * saves the management-API private_key_jwt key via
 * setConfig({ pingone_mgmt_private_key }), but the key was never registered in
 * FIELD_DEFS, so setConfig's unknown-key guard silently dropped it -- the key
 * was never persisted even though the route reported ok:true.
 */
'use strict';

describe('configStore pingone_mgmt_private_key save', () => {
  const ENV_KEY = 'PINGONE_MGMT_PRIVATE_KEY';
  let orig;

  beforeEach(() => {
    orig = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    jest.resetModules();
  });

  afterEach(() => {
    if (orig === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = orig;
    jest.resetModules();
  });

  it('setConfig persists the generate-keypair route\'s exact patch, readable via getEffective', async () => {
    const configStore = require('../../services/configStore');
    const fakePem = '-----BEGIN PRIVATE KEY-----\nfake-key-material\n-----END PRIVATE KEY-----';
    await configStore.setConfig({ pingone_mgmt_private_key: fakePem });
    expect(configStore.getEffective('pingone_mgmt_private_key')).toBe(fakePem);
  });
});
