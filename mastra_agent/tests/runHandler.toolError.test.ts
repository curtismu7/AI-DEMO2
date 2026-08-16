import type { Request, Response } from 'express';
import { handleRun } from '../src/runHandler';

// Mock Agent so no real LLM calls are made. This mock simulates the `ai` SDK
// emitting a 'tool-error' chunk (v6.x, distinct from 'tool-result') after a
// tool's execute() throws — e.g. bffToolAdapter's BffToolError on a BFF
// timeout. No 'tool-result' or 'error' chunk follows it.
jest.mock('@mastra/core/agent', () => {
  return {
    Agent: jest.fn().mockImplementation(() => ({
      stream: jest.fn().mockResolvedValue({
        fullStream: (async function* () {
          yield { type: 'tool-call', toolCallId: 'tc1', toolName: 'transfer_funds', args: {} };
          yield {
            type: 'tool-error',
            toolCallId: 'tc1',
            toolName: 'transfer_funds',
            error: new Error('BFF tool call timed out after 30000ms'),
          };
        })(),
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

const RUN_PAYLOAD = {
  threadId: 't1',
  runId: 'r1',
  messages: [{ role: 'user', content: 'Transfer $100 to savings' }],
  tools: [
    {
      name: 'transfer_funds',
      description: 'Transfer funds between accounts',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  context: {
    bffToolUrl: 'http://127.0.0.1:3001/internal/agent-tool',
    bffInternalSecret: 'secret',
    sessionId: 'sess_abc',
    model: '',
  },
};

// A minimal in-memory req/res pair instead of a real HTTP round-trip via
// supertest. handleRun only touches req.body/req.on('close') and a handful
// of res methods, so this exercises the exact same code path deterministically
// without depending on Node's real IncomingMessage 'close' event timing
// (which fires once the request body is fully consumed, unrelated to whether
// the client is still connected — a separate, pre-existing issue in this
// environment that isn't part of this bug fix).
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

describe('POST /run — a failed tool call (tool-error chunk)', () => {
  it('resolves the pending TOOL_CALL_START with a TOOL_CALL_END (UI entry does not hang)', async () => {
    const { req, res, events } = makeReqRes(RUN_PAYLOAD);
    await handleRun(req, res);
    expect(events.some((e) => e.type === 'TOOL_CALL_START' && e.toolCallId === 'tc1')).toBe(true);
    expect(events.some((e) => e.type === 'TOOL_CALL_END' && e.toolCallId === 'tc1')).toBe(true);
  });

  it('does NOT report the run as a successful RUN_FINISHED', async () => {
    const { req, res, events } = makeReqRes(RUN_PAYLOAD);
    await handleRun(req, res);
    expect(events.some((e) => e.type === 'RUN_FINISHED')).toBe(false);
    const errorEvent = events.find((e) => e.type === 'RUN_ERROR');
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.message).toContain('BFF tool call timed out');
  });
});
