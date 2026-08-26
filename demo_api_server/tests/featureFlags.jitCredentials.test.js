'use strict';

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(),
  setRaw: jest.fn(),
}));
jest.mock('../config/runtimeSettings', () => ({
  get: jest.fn(() => undefined),
  update: jest.fn(),
}));

const { FLAG_REGISTRY } = require('../routes/featureFlags');

describe('ff_jit_credentials', () => {
  it('is registered as a boolean flag that is OFF by default', () => {
    const flag = FLAG_REGISTRY.find((f) => f.id === 'ff_jit_credentials');
    expect(flag).toBeDefined();
    expect(flag.type).toBe('boolean');
    // Must ship OFF: ON changes what every apikey tool call receives.
    expect(flag.defaultValue).toBe(false);
  });
});

describe('ff_jit_credentials configStore registration', () => {
  it('has a FIELD_DEFS entry defaulting to the string "false"', () => {
    // Without this the flag is unreadable through getEffective and silently
    // inert — the three-point wiring in the topology bundle (K2/K13).
    // requireActual: this file mocks configStore, but the registration we are
    // asserting lives in the real module.
    const { FIELD_DEFS } = jest.requireActual('../services/configStore');
    expect(FIELD_DEFS.ff_jit_credentials).toBeDefined();
    expect(FIELD_DEFS.ff_jit_credentials.default).toBe('false');
  });
});
