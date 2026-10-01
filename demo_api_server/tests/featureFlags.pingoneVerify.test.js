'use strict';

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => ''),
  setRaw: jest.fn(),
}));
jest.mock('../config/runtimeSettings', () => ({ get: jest.fn(), update: jest.fn() }));

const configStore = require('../services/configStore');
const { FLAG_REGISTRY, serializeFlag } = require('../routes/featureFlags');
const { FIELD_DEFS } = jest.requireActual('../services/configStore');

describe('PingOne Verify feature configuration', () => {
  test('has an off-by-default feature flag and an off-by-default environment override', () => {
    const flag = FLAG_REGISTRY.find((entry) => entry.id === 'pingone_verify_enabled');
    expect(flag).toMatchObject({ type: 'boolean', defaultValue: false });
    expect(FIELD_DEFS.pingone_verify_enabled.default).toBe('false');
  });

  test('registers the tenant-selected Verify policy identifier', () => {
    expect(FIELD_DEFS.pingone_verify_policy_id).toMatchObject({ public: true, default: '' });
  });

  test('retires the guessed Recognize MFA option and reports legacy saved values as OTP', () => {
    const mode = FLAG_REGISTRY.find((entry) => entry.id === 'hitl_consent_mfa_mode');
    expect(mode.options).not.toContain('recognize');
    configStore.getEffective.mockReturnValueOnce('recognize');
    expect(serializeFlag(mode).value).toBe('onetime');
  });
});
