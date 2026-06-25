import type { ReasonRequest } from '../src/reasonContract';
import { reasonOnce } from '../src/reasoningGraph';

// Mock Anthropic client to return a response with usage.
// The factory must be self-contained — jest.mock() is hoisted before imports,
// so variables defined outside (like a top-level mockCreate) are not in scope.
jest.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: jest.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hello!' }],
        usage: { input_tokens: 42, output_tokens: 7 },
      }),
    };
    static default = MockAnthropic;
  }
  return MockAnthropic;
});

const baseReq: ReasonRequest = {
  provider: 'anthropic',
  anthropicApiKey: 'sk-test',
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
};

test('final response includes inputTokens and outputTokens from Anthropic usage', async () => {
  const result = await reasonOnce(baseReq);

  expect(result.type).toBe('final');
  if (result.type === 'final') {
    expect(result.inputTokens).toBe(42);
    expect(result.outputTokens).toBe(7);
  }
});
