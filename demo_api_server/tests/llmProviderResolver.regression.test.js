// banking_api_server/tests/llmProviderResolver.regression.test.js
/**
 * Regression: one canonical provider resolver.
 * Rule (ARCHITECTURE-TRUTHS T-3): Heuristic runs upstream (not here).
 * When consulted: explicit choice honored; else Helix (the default catch-all).
 */
const { resolveLlmProvider } = require('../services/llmProviderResolver');

describe('resolveLlmProvider', () => {
  test('defaults to helix when no provider set', () => {
    expect(resolveLlmProvider({})).toEqual({ provider: 'helix', model: undefined });
  });

  test('honors explicit helix', () => {
    expect(resolveLlmProvider({ provider: 'helix', model: 'gpt-4o-mini' }))
      .toEqual({ provider: 'helix', model: 'gpt-4o-mini' });
  });

  test('unknown provider falls back to helix', () => {
    expect(resolveLlmProvider({ provider: 'gpt5' }))
      .toEqual({ provider: 'helix', model: undefined });
  });

  test('honors explicit openai (pass-through; :3006 enforces creds)', () => {
    expect(resolveLlmProvider({ provider: 'openai', model: 'gpt-4o' }))
      .toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  test('honors explicit anthropic (pass-through; :3006 enforces creds)', () => {
    expect(resolveLlmProvider({ provider: 'anthropic', model: 'claude-sonnet-4-6' }))
      .toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  test('honors explicit ollama (local LLM; no API key)', () => {
    expect(resolveLlmProvider({ provider: 'ollama', model: 'qwen3:8b' }))
      .toEqual({ provider: 'ollama', model: 'qwen3:8b' });
  });

  test('honors explicit ollama without model', () => {
    expect(resolveLlmProvider({ provider: 'ollama' }))
      .toEqual({ provider: 'ollama', model: undefined });
  });
});
