import { buildAgent } from '../src/agentFactory';
import { Agent } from '@mastra/core/agent';

jest.mock('@mastra/core/agent', () => {
  return {
    Agent: jest.fn().mockImplementation(() => ({ stream: jest.fn() })),
  };
});

// createOpenAI returns a model-factory function; mock it to a simple identity
// so we can assert what was passed without invoking the real AI SDK provider.
jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => (modelId: string) => ({ __mockModel: modelId })),
}));

import { createOpenAI } from '@ai-sdk/openai';

const SCHEMAS = [
  { name: 'get_accounts', description: 'List accounts', inputSchema: { type: 'object' as const, properties: {} } },
];

const RUN_CTX = {
  bffToolUrl: 'http://127.0.0.1:3001/internal/agent-tool',
  bffInternalSecret: 'secret',
  sessionId: 'sess_abc',
};

const LLM = {
  baseUrl: 'http://localhost:1234/v1',
  apiKey: 'lm-studio',
  model: 'google/gemma-4-e2b',
};

describe('buildAgent', () => {
  beforeEach(() => {
    (Agent as jest.MockedClass<typeof Agent>).mockClear();
    (createOpenAI as jest.Mock).mockClear();
  });

  it('returns an Agent instance', () => {
    const agent = buildAgent(SCHEMAS, RUN_CTX, LLM);
    expect(agent).toBeDefined();
  });

  it('constructs Agent with banking-agent id', () => {
    buildAgent(SCHEMAS, RUN_CTX, LLM);
    expect(Agent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'banking-agent' }),
    );
  });

  it('passes custom instructions when provided', () => {
    buildAgent(SCHEMAS, RUN_CTX, LLM, 'Custom prompt');
    expect(Agent).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: 'Custom prompt' }),
    );
  });

  it('uses default instructions when none provided', () => {
    buildAgent(SCHEMAS, RUN_CTX, LLM);
    const call = (Agent as jest.MockedClass<typeof Agent>).mock.calls[0][0];
    expect(call.instructions).toContain('banking assistant');
  });

  it('includes tool map with schema names as keys', () => {
    buildAgent(SCHEMAS, RUN_CTX, LLM);
    const call = (Agent as jest.MockedClass<typeof Agent>).mock.calls[0][0];
    expect(call.tools).toHaveProperty('get_accounts');
  });

  it('constructs the OpenAI provider with the configured baseURL and apiKey', () => {
    // Regression: previous code passed a bare model string and the provider
    // fell back to the env-driven default, breaking LM Studio routing.
    buildAgent(SCHEMAS, RUN_CTX, LLM);
    expect(createOpenAI).toHaveBeenCalledWith({
      baseURL: 'http://localhost:1234/v1',
      apiKey: 'lm-studio',
    });
  });
});
