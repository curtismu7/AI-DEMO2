import express from 'express';
import request from 'supertest';
import { handleRun } from '../src/runHandler';

// Mock Agent so no real LLM calls are made
jest.mock('@mastra/core/agent', () => {
  return {
    Agent: jest.fn().mockImplementation(() => ({
      stream: jest.fn().mockResolvedValue({
        fullStream: (async function* () {
          yield { type: 'tool-call', payload: { toolCallId: 'tc1', toolName: 'get_accounts', args: {} } };
          yield { type: 'tool-result', payload: { toolCallId: 'tc1', toolName: 'get_accounts', result: { accounts: [] } } };
          yield { type: 'text-delta', payload: { id: 'm', text: 'Hello' } };
          yield { type: 'text-delta', payload: { id: 'm', text: ' world' } };
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

const app = express();
app.use(express.json());
app.post('/run', handleRun);

const RUN_PAYLOAD = {
  threadId: 't1',
  runId: 'r1',
  messages: [{ role: 'user', content: 'What are my accounts?' }],
  tools: [
    {
      name: 'get_accounts',
      description: 'List accounts',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  context: {
    bffToolUrl: 'http://127.0.0.1:3001/internal/agent-tool',
    bffInternalSecret: 'secret',
    sessionId: 'sess_abc',
    // Empty model so we exercise the cfg.model fallback path.
    model: '',
  },
};

function parseSse(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)));
}

describe('POST /run (Mastra run handler)', () => {
  it('returns 200 with text/event-stream content type', async () => {
    const res = await request(app).post('/run').send(RUN_PAYLOAD);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('emits RUN_STARTED as first event', async () => {
    const res = await request(app).post('/run').send(RUN_PAYLOAD).buffer(true);
    const events = parseSse(res.text);
    expect(events[0]).toMatchObject({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
  });

  it('emits RUN_FINISHED as last event', async () => {
    const res = await request(app).post('/run').send(RUN_PAYLOAD).buffer(true);
    const events = parseSse(res.text);
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'RUN_FINISHED' });
  });

  it('emits TEXT_MESSAGE_CONTENT events for streamed tokens', async () => {
    const res = await request(app).post('/run').send(RUN_PAYLOAD).buffer(true);
    const events = parseSse(res.text);
    const content = events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT');
    expect(content.length).toBeGreaterThan(0);
    const joined = content.map((e) => e.delta).join('');
    expect(joined).toBe('Hello world');
  });

  it('emits TOOL_CALL_START and TOOL_CALL_END for tool parts', async () => {
    const res = await request(app).post('/run').send(RUN_PAYLOAD).buffer(true);
    const events = parseSse(res.text);
    expect(
      events.some(
        (e) => e.type === 'TOOL_CALL_START' && e.toolCallId === 'tc1' && e.toolName === 'get_accounts',
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === 'TOOL_CALL_END' && e.toolCallId === 'tc1')).toBe(true);
  });

  it('handles missing messages gracefully', async () => {
    const payload = { ...RUN_PAYLOAD, messages: [] };
    const res = await request(app).post('/run').send(payload).buffer(true);
    expect(res.status).toBe(200);
    const events = parseSse(res.text);
    expect(events.some((e) => e.type === 'RUN_STARTED')).toBe(true);
  });
});
