import type { Request, Response } from 'express';

// Capture the argument agent.stream() is invoked with so a test can assert the
// message array the handler actually forwards (Bug B). Reassigned per-test via
// setFullStream() below.
let lastStreamArgs: unknown;
let fullStreamFactory: () => AsyncIterable<Record<string, unknown>>;

function setFullStream(factory: () => AsyncIterable<Record<string, unknown>>): void {
  fullStreamFactory = factory;
}

// Mock Agent so no real LLM calls are made. stream() records its first argument
// and returns whatever the current fullStreamFactory yields.
jest.mock('@mastra/core/agent', () => {
  return {
    Agent: jest.fn().mockImplementation(() => ({
      stream: jest.fn().mockImplementation((msgs: unknown) => {
        lastStreamArgs = msgs;
        return Promise.resolve({ fullStream: fullStreamFactory() });
      }),
    })),
  };
});

// createOpenAI must be mocked too because agentFactory pulls it in transitively.
jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => (modelId: string) => ({ __mockModel: modelId })),
}));

jest.mock('../src/config', () => ({
  getConfig: () => ({
    bffToolUrl: 'http://127.0.0.1:3001/internal/agent-tool',
    bffInternalSecret: 'secret',
    llmApiKey: 'lm-studio',
    llmBaseUrl: 'http://localhost:1234/v1',
    model: 'google/gemma-4-e2b',
    port: 8892,
    host: '127.0.0.1',
  }),
}));

// Imported after the mocks are registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { handleRun } from '../src/runHandler';

function makeReqRes(body: Record<string, unknown>) {
  const events: Record<string, unknown>[] = [];
  let ended = false;
  const req = {
    body,
    on: () => {
      /* no-op: never signals client disconnect */
    },
  } as unknown as Request;
  const res = {
    setHeader: () => {},
    flushHeaders: () => {},
    write: (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
      }
      return true;
    },
    end: () => {
      ended = true;
    },
    get writableEnded() {
      return ended;
    },
  } as unknown as Response;
  return { req, res, events };
}

const BASE_PAYLOAD = {
  threadId: 't1',
  runId: 'r1',
  tools: [
    { name: 'get_accounts', description: 'List accounts', inputSchema: { type: 'object', properties: {} } },
  ],
  context: {
    bffToolUrl: 'http://127.0.0.1:3001/internal/agent-tool',
    bffInternalSecret: 'secret',
    sessionId: 'sess_abc',
    model: '',
  },
};

describe('POST /run — Bug #59: text bubble closed at tool-call boundary', () => {
  it('emits TEXT_MESSAGE_END before TOOL_CALL_START, and post-tool text starts a fresh message', async () => {
    // Model streams lead-in text, then calls a tool, then narrates the result.
    setFullStream(() => (async function* () {
      yield { type: 'text-delta', textDelta: 'Let me check your balance' };
      yield { type: 'tool-call', toolCallId: 'tc1', toolName: 'get_accounts', args: {} };
      yield { type: 'tool-result', toolCallId: 'tc1', toolName: 'get_accounts', result: { accounts: [] } };
      yield { type: 'text-delta', textDelta: 'Your balance is $0.' };
    })());

    const { req, res, events } = makeReqRes({
      ...BASE_PAYLOAD,
      messages: [{ role: 'user', content: 'What is my balance?' }],
    });
    await handleRun(req, res);

    const types = events.map((e) => e.type);
    const firstStart = types.indexOf('TEXT_MESSAGE_START');
    const firstEnd = types.indexOf('TEXT_MESSAGE_END');
    const toolStart = types.indexOf('TOOL_CALL_START');
    const toolEnd = types.indexOf('TOOL_CALL_END');

    // Lead-in bubble is opened and CLOSED before the tool card renders.
    expect(firstStart).toBeGreaterThanOrEqual(0);
    expect(firstEnd).toBeGreaterThan(firstStart);
    expect(toolStart).toBeGreaterThan(firstEnd);

    // Post-tool narration opens a FRESH message after the tool card ends.
    const secondStart = types.indexOf('TEXT_MESSAGE_START', firstEnd + 1);
    expect(secondStart).toBeGreaterThan(toolEnd);

    // Every opened bubble is matched by a close: two starts, two ends.
    expect(types.filter((t) => t === 'TEXT_MESSAGE_START')).toHaveLength(2);
    expect(types.filter((t) => t === 'TEXT_MESSAGE_END')).toHaveLength(2);

    // Run still succeeds.
    expect(types).toContain('RUN_FINISHED');
  });

  it('does not close a message when no text was streaming before the tool call', async () => {
    // Tool call with no preceding text-delta: no spurious TEXT_MESSAGE_* pair.
    setFullStream(() => (async function* () {
      yield { type: 'tool-call', toolCallId: 'tc1', toolName: 'get_accounts', args: {} };
      yield { type: 'tool-result', toolCallId: 'tc1', toolName: 'get_accounts', result: { accounts: [] } };
    })());

    const { req, res, events } = makeReqRes({
      ...BASE_PAYLOAD,
      messages: [{ role: 'user', content: 'List accounts' }],
    });
    await handleRun(req, res);

    const types = events.map((e) => e.type);
    expect(types).not.toContain('TEXT_MESSAGE_START');
    expect(types).not.toContain('TEXT_MESSAGE_END');
    expect(types).toContain('TOOL_CALL_START');
  });
});

describe('POST /run — Bug #60: empty/all-filtered messages fallback', () => {
  it('forwards a placeholder user message instead of agent.stream([])', async () => {
    setFullStream(() => (async function* () {
      yield { type: 'text-delta', textDelta: 'Hi' };
    })());

    const { req, res } = makeReqRes({ ...BASE_PAYLOAD, messages: [] });
    await handleRun(req, res);

    expect(Array.isArray(lastStreamArgs)).toBe(true);
    const msgs = lastStreamArgs as Array<{ role: string; content: string }>;
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[msgs.length - 1]).toMatchObject({ role: 'user' });
  });

  it('falls back when every message is filtered out (non-string content)', async () => {
    setFullStream(() => (async function* () {
      yield { type: 'text-delta', textDelta: 'Hi' };
    })());

    const { req, res, events } = makeReqRes({
      ...BASE_PAYLOAD,
      // content is not a string -> filtered out, leaving coreMessages empty.
      messages: [{ role: 'user', content: { nested: true } }] as unknown as Array<{ role: string; content: string }>,
    });
    await handleRun(req, res);

    expect(Array.isArray(lastStreamArgs)).toBe(true);
    expect((lastStreamArgs as unknown[]).length).toBeGreaterThan(0);
    // And it doesn't throw — the run reaches a terminal event.
    const types = events.map((e) => e.type);
    expect(types.some((t) => t === 'RUN_FINISHED' || t === 'RUN_ERROR')).toBe(true);
  });
});
