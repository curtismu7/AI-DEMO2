const axios = require('axios');
jest.mock('axios');
jest.mock('../services/configStore', () => ({ getEffective: jest.fn(() => 'test-secret') }));

const { runReasonLoop } = require('../services/agentReasoningClient');

test('runReasonLoop passes inputTokens and outputTokens from final response', async () => {
  axios.post.mockResolvedValueOnce({
    data: { type: 'final', answer: 'Hello', inputTokens: 42, outputTokens: 7 },
  });

  const result = await runReasonLoop({
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    anthropicApiKey: 'sk-test',
    maxIterations: 3,
    executeTool: jest.fn(),
  });

  expect(result.ok).toBe(true);
  expect(result.inputTokens).toBe(42);
  expect(result.outputTokens).toBe(7);
});
