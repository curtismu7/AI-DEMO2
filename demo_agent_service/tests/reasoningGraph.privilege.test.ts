// demo_agent_service/tests/reasoningGraph.privilege.test.ts
//
// ff_privilege_llm_first: the BFF resolver sends privilege_claude / privilege_llm / privilege_groq.
// Before this mapping reasonOnce logged "unknown provider" for both and the chat
// agent silently fell to the heuristic floor. Each lane must construct its
// client against the Privilege gateway with the virtual key, never a vendor key.
import type { ReasonRequest } from '../src/reasonContract';
import { reasonOnce } from '../src/reasoningGraph';

jest.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    static lastOpts: unknown;
    messages = {
      create: jest.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'via privilege' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
    constructor(opts: unknown) { MockAnthropic.lastOpts = opts; }
    static default = MockAnthropic;
  }
  return MockAnthropic;
});

const invoke = jest.fn();
const chatOpenAIOpts: unknown[] = [];
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation((opts: unknown) => {
    chatOpenAIOpts.push(opts);
    return { bindTools: jest.fn(() => ({ invoke })), invoke };
  }),
}));

const base = (provider: ReasonRequest['provider']): ReasonRequest => ({
  provider,
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
});

const ENV = ['PRIVILEGE_LLM_GATEWAY_URL', 'PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC', 'PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE', 'PRIVILEGE_LLM_VIRTUAL_KEY_GROQ', 'PRIVILEGE_LLM_MODEL_GROQ', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://mcpgw.example/';
  process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC = 'vk-anthropic';
  process.env.PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE = 'vk-google';
  process.env.PRIVILEGE_LLM_VIRTUAL_KEY_GROQ = 'vk-groq';
  process.env.ANTHROPIC_API_KEY = 'sk-real-vendor-key';
  process.env.GROQ_API_KEY = 'gsk-real-vendor-key';
  chatOpenAIOpts.length = 0;
  invoke.mockReset();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

describe('reasonOnce — Privilege virtual-key lanes', () => {
  test('privilege_claude constructs the Anthropic client against the gateway with the virtual key', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const MockAnthropic = require('@anthropic-ai/sdk');
    const out = await reasonOnce(base('privilege_claude'));
    expect(out.type).toBe('final');
    if (out.type === 'final') expect(out.answer).toBe('via privilege');
    expect(MockAnthropic.lastOpts).toEqual({ apiKey: 'vk-anthropic', baseURL: 'https://mcpgw.example/llm/anthropic' });
  });

  test('privilege_llm constructs ChatOpenAI against the Gemini lane with the virtual key', async () => {
    invoke.mockResolvedValueOnce({ content: 'gemini via privilege', tool_calls: [], usage_metadata: {} });
    const out = await reasonOnce(base('privilege_llm'));
    expect(out.type).toBe('final');
    if (out.type === 'final') expect(out.answer).toBe('gemini via privilege');
    expect(chatOpenAIOpts[0]).toMatchObject({
      apiKey: 'vk-google',
      configuration: { baseURL: 'https://mcpgw.example/llm/google/v1' },
    });
  });

  test('privilege_groq constructs ChatOpenAI against the custom lane with the virtual key and default model', async () => {
    invoke.mockResolvedValueOnce({ content: 'groq via privilege', tool_calls: [], usage_metadata: {} });
    const out = await reasonOnce(base('privilege_groq'));
    expect(out.type).toBe('final');
    if (out.type === 'final') expect(out.answer).toBe('groq via privilege');
    expect(chatOpenAIOpts[0]).toMatchObject({
      model: 'openai/gpt-oss-20b',
      apiKey: 'vk-groq',
      configuration: { baseURL: 'https://mcpgw.example/llm/custom/v1' },
    });
  });

  test('privilege_groq honours PRIVILEGE_LLM_MODEL_GROQ', async () => {
    process.env.PRIVILEGE_LLM_MODEL_GROQ = 'openai/gpt-oss-120b';
    invoke.mockResolvedValueOnce({ content: 'ok', tool_calls: [], usage_metadata: {} });
    await reasonOnce(base('privilege_groq'));
    expect(chatOpenAIOpts[0]).toMatchObject({ model: 'openai/gpt-oss-120b' });
  });

  test('privilege_groq virtual key unset → reasoningUnavailable, never the vendor Groq key', async () => {
    delete process.env.PRIVILEGE_LLM_VIRTUAL_KEY_GROQ;
    const out = await reasonOnce(base('privilege_groq'));
    expect(out.type === 'final' && out.reasoningUnavailable).toBe(true);
    expect(chatOpenAIOpts).toHaveLength(0);
  });

  test('gateway URL unset → reasoningUnavailable, and the vendor key is never used', async () => {
    delete process.env.PRIVILEGE_LLM_GATEWAY_URL;
    const claude = await reasonOnce(base('privilege_claude'));
    expect(claude.type === 'final' && claude.reasoningUnavailable).toBe(true);
    const gemini = await reasonOnce(base('privilege_llm'));
    expect(gemini.type === 'final' && gemini.reasoningUnavailable).toBe(true);
    const groq = await reasonOnce(base('privilege_groq'));
    expect(groq.type === 'final' && groq.reasoningUnavailable).toBe(true);
    expect(chatOpenAIOpts).toHaveLength(0);
  });
});
