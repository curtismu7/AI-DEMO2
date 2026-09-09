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

describe('ff_privilege_llm_first', () => {
  it('is registered as a boolean flag that is OFF by default', () => {
    const flag = FLAG_REGISTRY.find((f) => f.id === 'ff_privilege_llm_first');
    expect(flag).toBeDefined();
    expect(flag.type).toBe('boolean');
    // Must ship OFF: ON reroutes every cloud LLM call through the Privilege gateway.
    expect(flag.defaultValue).toBe(false);
  });

  it('has a FIELD_DEFS entry defaulting to the string "false"', () => {
    // Without this the flag is unreadable through getEffective and silently inert.
    const { FIELD_DEFS } = jest.requireActual('../services/configStore');
    expect(FIELD_DEFS.ff_privilege_llm_first).toBeDefined();
    expect(FIELD_DEFS.ff_privilege_llm_first.default).toBe('false');
  });
});
