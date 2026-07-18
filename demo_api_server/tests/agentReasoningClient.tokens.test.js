const axios = require('axios');
jest.mock('axios');
jest.mock('../services/configStore', () => ({ getEffective: jest.fn(() => 'test-secret') }));

const { runReasonLoop } = require('../services/agentReasoningClient');
const { REASON_LOOP_TIMEOUT_MS } = require('../../llm-timeouts.json');

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

// Contract: the BFF's axios call must use the shared llm-timeouts.json value,
// not a re-inlined literal — the UI's client-side abort timeout is derived
// from this same file (see demoAgentService.test.js) and must stay >= it.
// See project-agent-client-timeout-mismatch memory for why this drifted before.
test('runReasonLoop uses the shared REASON_LOOP_TIMEOUT_MS from llm-timeouts.json', async () => {
  axios.post.mockResolvedValueOnce({ data: { type: 'final', answer: 'Hello' } });

  await runReasonLoop({
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    anthropicApiKey: 'sk-test',
    maxIterations: 3,
    executeTool: jest.fn(),
  });

  const [, , options] = axios.post.mock.calls[0];
  expect(options.timeout).toBe(REASON_LOOP_TIMEOUT_MS);
});
