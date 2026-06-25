// demo_api_server/tests/llmProviderResolver.lmstudio.regression.test.js
/**
 * Regression: anthropic-lmstudio provider pass-through in resolveLlmProvider.
 * LM Studio requires no API key and no URL config check — always passes through.
 */
const { resolveLlmProvider } = require('../services/llmProviderResolver');

describe('resolveLlmProvider — anthropic-lmstudio', () => {
  test('passes through anthropic-lmstudio with model', () => {
    expect(resolveLlmProvider({ provider: 'anthropic-lmstudio', model: 'google/gemma-4-e2b' }))
      .toEqual({ provider: 'anthropic-lmstudio', model: 'google/gemma-4-e2b' });
  });

  test('passes through anthropic-lmstudio without model', () => {
    expect(resolveLlmProvider({ provider: 'anthropic-lmstudio' }))
      .toEqual({ provider: 'anthropic-lmstudio', model: undefined });
  });

  test('does NOT fall back to helix when anthropic-lmstudio selected (no URL config required)', () => {
    // LM Studio is always local — no base URL config needed
    const result = resolveLlmProvider({ provider: 'anthropic-lmstudio' });
    expect(result.provider).toBe('anthropic-lmstudio');
    expect(result.provider).not.toBe('helix');
  });
});
