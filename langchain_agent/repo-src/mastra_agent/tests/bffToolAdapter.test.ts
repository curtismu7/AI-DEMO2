import { buildBffTools, BffToolError } from '../src/bffToolAdapter';

const SCHEMA = {
  name: 'get_accounts',
  description: 'List accounts',
  inputSchema: { type: 'object' as const, properties: { userId: { type: 'string' } } },
};

const RUN_CTX = {
  bffToolUrl: 'http://127.0.0.1:3001/internal/agent-tool',
  bffInternalSecret: 'secret',
  sessionId: 'sess_abc',
};

describe('buildBffTools', () => {
  it('returns one tool per schema', () => {
    const tools = buildBffTools([SCHEMA], RUN_CTX);
    expect(tools).toHaveLength(1);
  });

  it('tool has correct id and description', () => {
    const tools = buildBffTools([SCHEMA], RUN_CTX);
    expect(tools[0].id).toBe('get_accounts');
    expect(tools[0].description).toBe('List accounts');
  });

  it('tool execute calls BFF and returns result', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { accounts: [] } }),
    } as any);

    const tools = buildBffTools([SCHEMA], RUN_CTX);
    const exec = tools[0].execute!;
    const result = await exec({ userId: 'u1' }, {} as any);
    expect(result).toEqual({ accounts: [] });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/internal/agent-tool',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('tool execute throws BffToolError on non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    } as any);

    const tools = buildBffTools([SCHEMA], RUN_CTX);
    const exec = tools[0].execute!;
    await expect(exec({ userId: 'u1' }, {} as any)).rejects.toThrow(BffToolError);
  });
});

describe('buildBffTools — token event forwarding', () => {
  it('emits one batched STATE_DELTA with one add op per tokenEvent', async () => {
    const tokenEvents = [{ type: 'exchanger-token' }, { type: 'mcp-token' }];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: {}, tokenEvents }),
    } as any);

    const emitted: Record<string, unknown>[] = [];
    const emitFn = jest.fn(async (event: Record<string, unknown>) => {
      emitted.push(event);
    });

    const tools = buildBffTools([SCHEMA], RUN_CTX, emitFn);
    await tools[0].execute!({ userId: 'u1' }, {} as any);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      type: 'STATE_DELTA',
      delta: [
        { op: 'add', path: '/tokenEvents/-', value: tokenEvents[0] },
        { op: 'add', path: '/tokenEvents/-', value: tokenEvents[1] },
      ],
    });
  });

  it('emits the error body tokenEvents before throwing on a non-ok response', async () => {
    const errEvents = [{ type: 'exchange-failed' }];
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: 'token_exchange_failed', tokenEvents: errEvents }),
    } as any);

    const emitted: Record<string, unknown>[] = [];
    const emitFn = jest.fn(async (event: Record<string, unknown>) => {
      emitted.push(event);
    });

    const tools = buildBffTools([SCHEMA], RUN_CTX, emitFn);
    await expect(tools[0].execute!({ userId: 'u1' }, {} as any)).rejects.toThrow(BffToolError);

    expect(emitted).toEqual([
      { type: 'STATE_DELTA', delta: [{ op: 'add', path: '/tokenEvents/-', value: errEvents[0] }] },
    ]);
  });

  it('does not throw when emitFn is undefined', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: {}, tokenEvents: [{ type: 'exchanger-token' }] }),
    } as any);

    const tools = buildBffTools([SCHEMA], RUN_CTX);
    await expect(tools[0].execute!({ userId: 'u1' }, {} as any)).resolves.not.toThrow();
  });
});
