'use strict';

jest.mock('../../demo_api_server/services/pingOneSecretRotation', () => ({
  regenerateClientSecret: jest.fn(),
  verifySecret: jest.fn(),
  fingerprint: jest.fn(() => 'deadbeef'),
  isWorkerApp: jest.fn(() => false),
}));

jest.mock('../../demo_api_server/lib/vault', () => ({
  openVault: jest.fn(),
}));

const rotation = require('../../demo_api_server/services/pingOneSecretRotation');
const vaultLib = require('../../demo_api_server/lib/vault');
const { preflight } = require('../../scripts/rotate-app-secret');

const APP = { id: 'a1', clientId: 'c1', name: 'Demo App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' };
// Any file guaranteed to exist, for tests that need to get past the
// fs.existsSync gate and into the (mocked) openVault call.
const REAL_PATH = __filename;

describe('rotate-app-secret preflight', () => {
  // jest.clearAllMocks() clears call history but NOT a mockReturnValue set by
  // a previous test (that's mockReset, not mockClear) — without this explicit
  // reset, the worker-app test's mockReturnValue(true) leaks into every test
  // that runs after it. Verified empirically before adding this line.
  beforeEach(() => {
    jest.clearAllMocks();
    rotation.isWorkerApp.mockReturnValue(false);
  });

  test('refuses the worker app, before ever touching the vault', async () => {
    rotation.isWorkerApp.mockReturnValue(true);
    await expect(preflight({ app: APP, vaultPath: '/tmp/x', vaultPassword: 'p' }))
      .rejects.toThrow(/worker/i);
    expect(vaultLib.openVault).not.toHaveBeenCalled();
  });

  test('refuses an app with no rotatable secret, before ever touching the vault', async () => {
    await expect(preflight({
      app: { ...APP, tokenEndpointAuthMethod: 'NONE' }, vaultPath: '/tmp/x', vaultPassword: 'p',
    })).rejects.toThrow(/no client secret/i);
    expect(vaultLib.openVault).not.toHaveBeenCalled();
  });

  test('refuses when the vault password is absent, before ever touching the vault', async () => {
    await expect(preflight({ app: APP, vaultPath: '/tmp/x', vaultPassword: '' }))
      .rejects.toThrow(/vault password/i);
    expect(vaultLib.openVault).not.toHaveBeenCalled();
  });

  test('refuses when the vault file does not exist, before ever touching the vault', async () => {
    await expect(preflight({
      app: APP, vaultPath: '/tmp/definitely-does-not-exist-xyz123', vaultPassword: 'p',
    })).rejects.toThrow(/vault not found/i);
    expect(vaultLib.openVault).not.toHaveBeenCalled();
  });

  test('refuses a wrong vault password — proves the vault must open, not just exist', async () => {
    vaultLib.openVault.mockRejectedValue(new Error('vault: incorrect password or corrupted file'));
    await expect(preflight({ app: APP, vaultPath: REAL_PATH, vaultPassword: 'wrong' }))
      .rejects.toThrow(/could not be opened/i);
    expect(vaultLib.openVault).toHaveBeenCalledWith(REAL_PATH, 'wrong');
  });

  test('resolves when app, vault path and password are all valid', async () => {
    const close = jest.fn();
    vaultLib.openVault.mockResolvedValue({ close });
    await expect(preflight({ app: APP, vaultPath: REAL_PATH, vaultPassword: 'correct' }))
      .resolves.toBeUndefined();
    expect(vaultLib.openVault).toHaveBeenCalledWith(REAL_PATH, 'correct');
    expect(close).toHaveBeenCalled();
  });
});
