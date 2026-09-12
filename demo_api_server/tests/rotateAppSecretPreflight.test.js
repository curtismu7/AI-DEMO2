'use strict';

jest.mock('../../demo_api_server/services/pingOneSecretRotation', () => ({
  regenerateClientSecret: jest.fn(),
  verifySecret: jest.fn(),
  fingerprint: jest.fn(() => 'deadbeef'),
  isWorkerApp: jest.fn(() => false),
}));

const rotation = require('../../demo_api_server/services/pingOneSecretRotation');
const { preflight } = require('../../scripts/rotate-app-secret');

const APP = { id: 'a1', clientId: 'c1', name: 'Demo App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST' };

describe('rotate-app-secret preflight', () => {
  // jest.clearAllMocks() clears call history but NOT a mockReturnValue set by
  // a previous test (that's mockReset, not mockClear) — without this explicit
  // reset, the worker-app test's mockReturnValue(true) leaks into every test
  // that runs after it. Verified empirically before adding this line.
  beforeEach(() => {
    jest.clearAllMocks();
    rotation.isWorkerApp.mockReturnValue(false);
  });

  test('refuses the worker app', async () => {
    rotation.isWorkerApp.mockReturnValue(true);
    await expect(preflight({ app: APP, vaultPath: '/tmp/x', vaultPassword: 'p' }))
      .rejects.toThrow(/worker/i);
    expect(rotation.regenerateClientSecret).not.toHaveBeenCalled();
  });

  test('refuses an app with no rotatable secret', async () => {
    await expect(preflight({
      app: { ...APP, tokenEndpointAuthMethod: 'NONE' }, vaultPath: '/tmp/x', vaultPassword: 'p',
    })).rejects.toThrow(/no client secret/i);
    expect(rotation.regenerateClientSecret).not.toHaveBeenCalled();
  });

  test('refuses when the vault password is absent, before rotating', async () => {
    await expect(preflight({ app: APP, vaultPath: '/tmp/x', vaultPassword: '' }))
      .rejects.toThrow(/vault password/i);
    expect(rotation.regenerateClientSecret).not.toHaveBeenCalled();
  });
});
