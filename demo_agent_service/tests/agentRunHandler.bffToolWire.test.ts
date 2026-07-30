// Canary: demo_agent_service → BFF /internal/agent-tool wire contract.
// #1108 sent JSON-RPC { jsonrpc, method:'tools/call', params:{ name, arguments, sessionId } }
// while agentTool.js still requires top-level { tool, args, sessionId }. That made every
// AG-UI tool call 400 tool_required. Lock the body shape and response unwrap here.
import { EventEmitter } from 'events';
import { makeAgentRunHandler } from '../src/agentRunHandler';
import { reasonOnce } from '../src/reasoningGraph';

jest.mock('../src/reasoningGraph', () => ({ reasonOnce: jest.fn() }));

const SECRET = 'test-secret';
const BFF_URL = 'http://127.0.0.1:3001/internal/agent-tool';

function makeReq(body: unknown): any {
  const req: any = new EventEmitter();
  req.headers = { 'x-internal-gateway-secret': SECRET };
  req.body = body;
  return req;
}

function makeRes(): any {
  const res: any = new EventEmitter();
  res.writes = [] as string[];
  res.writableFinished = false;
  res.setHeader = jest.fn();
  res.flushHeaders = jest.fn();
  res.write = jest.fn((s: string) => {
    res.writes.push(s);
    return true;
  });
  res.end = jest.fn(() => {
    res.writableFinished = true;
    res.emit('close');
  });
  res.status = jest.fn(() => res);
  res.json = jest.fn();
  return res;
}

describe('agent → /internal/agent-tool wire contract', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('POSTs { tool, args, sessionId } (not JSON-RPC) and unwraps { result, tokenEvents }', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { accounts: [{ id: 'chk-1', balance: 100 }] },
        tokenEvents: [{ type: 'token-exchanged' }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    (reasonOnce as jest.Mock)
      .mockResolvedValueOnce({
        type: 'tool_calls',
        calls: [{ name: 'get_my_accounts', args: { limit: 2 }, id: 'call-1' }],
        messages: [],
      })
      .mockResolvedValueOnce({
        type: 'final',
        answer: 'You have one account.',
        messages: [],
      });

    const handler = makeAgentRunHandler(SECRET, BFF_URL);
    const req = makeReq({
      threadId: 't1',
      runId: 'r1',
      messages: [{ role: 'user', content: 'show accounts' }],
      tools: [{ name: 'get_my_accounts', description: 'list accounts', parameters: {} }],
      context: { provider: 'anthropic', sessionId: 'sess-abc' },
    });
    const res = makeRes();
    await handler(req, res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BFF_URL);
    expect(init.headers['x-internal-gateway-secret']).toBe(SECRET);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      tool: 'get_my_accounts',
      args: { limit: 2 },
      sessionId: 'sess-abc',
    });
    expect(body.jsonrpc).toBeUndefined();
    expect(body.method).toBeUndefined();
    expect(body.params).toBeUndefined();

    const streamed = (res.writes as string[]).join('');
    expect(streamed).toContain('TOOL_CALL_RESULT');
    expect(streamed).toContain('chk-1');
    expect(streamed).toContain('You have one account.');
  });
});
