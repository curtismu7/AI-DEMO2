'use strict';

jest.mock('../services/bedrockPathGate', () => ({
  isBedrockLlmEffective: jest.fn(),
}));

const { isBedrockLlmEffective } = require('../services/bedrockPathGate');
const { resolveLlmProvider } = require('../services/llmProviderResolver');

describe('resolveLlmProvider — bedrock', () => {
  const origModel = process.env.BEDROCK_MODEL_ID;

  afterEach(() => {
    process.env.BEDROCK_MODEL_ID = origModel;
    jest.clearAllMocks();
  });

  it('returns unchanged provider when bedrock flag is off', () => {
    isBedrockLlmEffective.mockReturnValue(false);
    expect(resolveLlmProvider({ provider: 'llamacpp' })).toEqual({
      provider: 'llamacpp',
      model: undefined,
    });
  });

  it('returns bedrock when flag effective and no explicit provider', () => {
    isBedrockLlmEffective.mockReturnValue(true);
    process.env.BEDROCK_MODEL_ID = 'anthropic.claude-3-5-haiku-20241022-v1:0';
    expect(resolveLlmProvider({})).toEqual({
      provider: 'bedrock',
      model: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    });
  });

  it('honors explicit bedrock pass-through when flag effective', () => {
    isBedrockLlmEffective.mockReturnValue(true);
    expect(resolveLlmProvider({ provider: 'bedrock', model: 'custom-model' })).toEqual({
      provider: 'bedrock',
      model: 'custom-model',
    });
  });
});
