// banking_agent_service/tests/googleProvider.test.ts
// Unit tests for the Gemini (google) provider branch in reasonOnce.
// The @langchain/google-genai client is mocked so the test is deterministic
// and requires no network / API key.

const mockInvoke = jest.fn();
const mockBindTools = jest.fn(() => ({ invoke: mockInvoke }));

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    bindTools: mockBindTools,
    invoke: mockInvoke,
  })),
}));

import { reasonOnce } from '../src/reasoningGraph';
import type { ReasonRequest } from '../src/reasonContract';

const TOOLS = [
  { name: 'get_my_accounts', description: 'List the customer bank accounts', inputSchema: { type: 'object', properties: {} } },
];

function baseReq(overrides: Partial<ReasonRequest> = {}): ReasonRequest {
  return {
    messages: [{ role: 'user', content: 'show my accounts' }],
    tools: TOOLS,
    provider: 'google',
    googleApiKey: 'AIza-test-key',
    ...overrides,
  };
}

describe('reasonOnce — google (Gemini) provider', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockBindTools.mockClear();
  });

  test('returns tool_calls when Gemini emits a tool call', async () => {
    mockInvoke.mockResolvedValueOnce({
      content: '',
      tool_calls: [{ id: 'g1', name: 'get_my_accounts', args: {} }],
      usage_metadata: { input_tokens: 12, output_tokens: 3 },
    });
    const out = await reasonOnce(baseReq());
    expect(out.type).toBe('tool_calls');
    if (out.type === 'tool_calls') {
      expect(out.calls[0].name).toBe('get_my_accounts');
    }
  });

  test('returns final prose when Gemini emits no tool call', async () => {
    mockInvoke.mockResolvedValueOnce({
      content: 'Here are your accounts.',
      tool_calls: [],
      usage_metadata: { input_tokens: 10, output_tokens: 5 },
    });
    const out = await reasonOnce(baseReq());
    expect(out.type).toBe('final');
    if (out.type === 'final') {
      expect(out.answer).toBe('Here are your accounts.');
    }
  });

  test('missing API key → reasoningUnavailable, never fabricates', async () => {
    const out = await reasonOnce(baseReq({ googleApiKey: '' }));
    expect(out.type).toBe('final');
    if (out.type === 'final') {
      expect(out.reasoningUnavailable).toBe(true);
      expect(out.answer).toBe('');
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
