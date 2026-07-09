// demo_agent_service/tests/reasoningGraph.google.test.ts
import { reasonOnce } from '../src/reasoningGraph';
import type { ReasonRequest } from '../src/reasonContract';

const invoke = jest.fn();
const bindTools = jest.fn(() => ({ invoke }));

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    bindTools,
    invoke,
  })),
}));

const baseReq: ReasonRequest = {
  messages: [{ role: 'user', content: 'show my balance' }],
  tools: [{ name: 'get_account_balance', description: 'balance', inputSchema: { type: 'object', properties: {} } }],
  provider: 'google',
  googleApiKey: 'test-key',
  model: 'gemini-2.0-flash',
};

describe('reasonOnce — google provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bindTools.mockReturnValue({ invoke });
  });

  test('missing API key → reasoningUnavailable', async () => {
    const out = await reasonOnce({ ...baseReq, googleApiKey: '' });
    expect(out.type).toBe('final');
    if (out.type === 'final') {
      expect(out.reasoningUnavailable).toBe(true);
      expect(out.answer).toBe('');
    }
  });

  test('tool_calls from Gemini → ReasonResponse tool_calls', async () => {
    invoke.mockResolvedValueOnce({
      content: '',
      tool_calls: [{ id: 'g1', name: 'get_account_balance', args: {} }],
      usage_metadata: { input_tokens: 10, output_tokens: 5 },
    });
    const out = await reasonOnce(baseReq);
    expect(out.type).toBe('tool_calls');
    if (out.type === 'tool_calls') {
      expect(out.calls[0].name).toBe('get_account_balance');
    }
    expect(bindTools).toHaveBeenCalled();
  });

  test('final text from Gemini → ReasonResponse final', async () => {
    invoke.mockResolvedValueOnce({
      content: 'Your balance is $100',
      tool_calls: [],
      usage_metadata: { input_tokens: 8, output_tokens: 4 },
    });
    const out = await reasonOnce(baseReq);
    expect(out.type).toBe('final');
    if (out.type === 'final') {
      expect(out.answer).toBe('Your balance is $100');
      expect(out.reasoningUnavailable).toBeFalsy();
    }
  });

  test('Gemini transport error → reasoningUnavailable', async () => {
    invoke.mockRejectedValueOnce(new Error('Gemini API 429: quota'));
    const out = await reasonOnce(baseReq);
    expect(out.type).toBe('final');
    if (out.type === 'final') {
      expect(out.reasoningUnavailable).toBe(true);
      expect(out.answer).toBe('');
    }
  });
});
