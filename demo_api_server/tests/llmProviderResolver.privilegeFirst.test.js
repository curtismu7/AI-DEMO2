'use strict';

// ff_privilege_llm_first: every cloud LLM call enters the PingOne Privilege AI
// Gateway first. The resolver is the single place providers are chosen
// (ARCHITECTURE-TRUTHS T-3), so the alias lives here and nowhere else.
//
// setup.js resets the module registry after every test, so the mocked
// configStore and the resolver are required together inside each test —
// a module-scope handle goes stale from test 2 onward.

jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));

function load(flagValue) {
  const configStore = require('../services/configStore');
  configStore.getEffective.mockReturnValue(flagValue);
  return require('../services/llmProviderResolver');
}

describe('ff_privilege_llm_first', () => {
  const saved = process.env.PRIVILEGE_LLM_GATEWAY_URL;
  beforeEach(() => { process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://mcpgw.example'; });
  afterEach(() => {
    if (saved === undefined) delete process.env.PRIVILEGE_LLM_GATEWAY_URL;
    else process.env.PRIVILEGE_LLM_GATEWAY_URL = saved;
  });

  it('OFF: cloud providers pass through unchanged', () => {
    const { resolveLlmProvider } = load('false');
    expect(resolveLlmProvider({ provider: 'google' }).provider).toBe('google');
    expect(resolveLlmProvider({ provider: 'anthropic' }).provider).toBe('anthropic');
    expect(resolveLlmProvider({ provider: 'openai' }).provider).toBe('openai');
  });

  it('ON: google -> privilege_llm, anthropic -> privilege_claude, model preserved', () => {
    const { resolveLlmProvider } = load('true');
    expect(resolveLlmProvider({ provider: 'google', model: 'gemini-2.0-flash' }))
      .toEqual({ provider: 'privilege_llm', model: 'gemini-2.0-flash' });
    expect(resolveLlmProvider({ provider: 'anthropic' }).provider).toBe('privilege_claude');
  });

  it('ON: openai is refused loudly rather than silently going vendor-direct', () => {
    const { resolveLlmProvider } = load('true');
    expect(() => resolveLlmProvider({ provider: 'openai' }))
      .toThrow(expect.objectContaining({ code: 'llm_privilege_first_unsupported' }));
  });

  it('ON but gateway URL unset: falls back to vendor-direct', () => {
    const { resolveLlmProvider } = load('true');
    delete process.env.PRIVILEGE_LLM_GATEWAY_URL;
    expect(resolveLlmProvider({ provider: 'google' }).provider).toBe('google');
  });

  it('ON: local and Helix providers are untouched', () => {
    const { resolveLlmProvider } = load('true');
    expect(resolveLlmProvider({ provider: 'llamacpp' }).provider).toBe('llamacpp');
    expect(resolveLlmProvider({ provider: 'helix' }).provider).toBe('helix');
    expect(resolveLlmProvider({}).provider).toBe('helix');
  });
});
