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

describe('Bedrock feature flags', () => {
  const ids = ['ff_bedrock_agentcore_gateway', 'ff_bedrock_llm'];

  for (const id of ids) {
    it(`${id} exists with safe defaults`, () => {
      const flag = FLAG_REGISTRY.find((f) => f.id === id);
      expect(flag).toBeDefined();
      expect(flag.defaultValue).toBe(false);
      expect(flag.warnIfEnabled).toBe(true);
      expect(flag.category).toBe('AWS / Bedrock');
      expect(flag.runtimeKey).toBeTruthy();
      expect(flag.type).toBe('boolean');
    });
  }
});
