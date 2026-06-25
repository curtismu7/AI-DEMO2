// Mutable configStore so we can disable heuristic
const _cfg = {};
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => (key in _cfg ? _cfg[key] : null)),
}));

// Disable heuristic matching for this test
jest.mock('../services/nlIntentParser', () => {
  const real = jest.requireActual('../services/nlIntentParser');
  return {
    ...real,
    parseHeuristic: jest.fn(() => ({ kind: 'none' })),
  };
});

// LLM reason loop — return tokens
jest.mock('../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn().mockResolvedValue({
    ok: true,
    answer: 'Your balance is $4,200.',
    inputTokens: 38,
    outputTokens: 12,
  }),
}));

jest.mock('../services/llmProviderResolver', () => ({
  resolveLlmProvider: jest.fn(() => ({ provider: 'ollama', model: 'test' })),
}));

jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../data/store', () => ({ getUserById: jest.fn(() => null) }));

const { processAgentMessage } = require('../services/demoAgentLangGraphService');

describe('bankingAgentLangGraphService tokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear config for fresh state
    for (const k of Object.keys(_cfg)) delete _cfg[k];
  });

  test('processAgentMessage returns inputTokens and outputTokens from loop result', async () => {
    const result = await processAgentMessage({
      message: 'what is my balance',
      userId: 'user1',
      userToken: 'tok',
      req: { session: {} },
      langchainConfig: { provider: 'anthropic' },
      sessionId: 'sess1',
    });

    expect(result.inputTokens).toBe(38);
    expect(result.outputTokens).toBe(12);
  });
});
