import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyCall, connectDoor, findDoorUrl, holdInfo, runTool } from '../privilegeAiPoliciesDemoService';

const ok = (body) => ({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
const fail = (status, body) => ({ ok: false, status, text: () => Promise.resolve(JSON.stringify(body)) });
afterEach(() => vi.unstubAllGlobals());

const HOLD = { result: { content: [{ type: 'text', text: 'status: pending_approval; approval ins_0123456789abcdef opened' }] } };

describe('classifyCall: what the gateway answered', () => {
  it('a 200 that announces pending_approval and an ins_ id is a HOLD, with the id', () => {
    expect(classifyCall({ data: HOLD })).toMatchObject({ outcome: 'hold', instructionId: 'ins_0123456789abcdef' });
  });

  it('a denial that merely quotes a hold is never a hold', () => {
    const quoted = { result: { isError: true, content: [{ type: 'text', text: 'refused: pending_approval ins_0123456789abcdef' }] } };
    expect(holdInfo(quoted)).toBeNull();
    expect(classifyCall({ data: quoted }).outcome).toBe('tool-error');
    expect(classifyCall({ data: { error: { message: 'forbidden ins_0123456789abcdef pending_approval' } } }).outcome).toBe('deny');
  });

  it('401 means sign in, 403 means a Privilege policy refused, anything else is an error', () => {
    const e = (status, message) => Object.assign(new Error(message), { status });
    expect(classifyCall({ error: e(401, 'Not authenticated') })).toMatchObject({ outcome: 'signin' });
    expect(classifyCall({ error: e(403, 'Forbidden') })).toMatchObject({ outcome: 'deny', detail: 'Forbidden' });
    expect(classifyCall({ error: e(502, 'bad gateway') }).outcome).toBe('error');
  });

  it('a normal result is allowed, and a result flagged isError is reported as unclear, not as a Cedar denial', () => {
    expect(classifyCall({ data: { result: { content: [{ type: 'text', text: 'index-a index-b' }] } } })).toMatchObject({ outcome: 'allow', detail: 'index-a index-b' });
    expect(classifyCall({ data: { result: { isError: true, content: [{ type: 'text', text: 'index not found' }] } } })).toMatchObject({ outcome: 'tool-error', detail: 'index not found' });
  });

  it('truncates a very long result so the page stays readable', () => {
    const long = { result: { content: [{ type: 'text', text: 'x'.repeat(900) }] } };
    expect(classifyCall({ data: long }).detail.length).toBeLessThan(310);
  });
});

describe('findDoorUrl', () => {
  const state = { presets: [
    { mode: 'direct', url: 'https://x/opensearch-hitl/mcp' },
    { mode: 'privilege', url: 'https://gw/aggregate/mcp' },
    { mode: 'privilege', url: 'https://gw/opensearch-hitl/mcp' },
    { mode: 'facade', url: 'https://f/opensearch-hitl/mcp' },
  ] };
  it('picks the privilege-mode preset for the named door, not a direct or façade one', () => {
    expect(findDoorUrl(state, 'opensearch-hitl')).toBe('https://gw/opensearch-hitl/mcp');
    expect(findDoorUrl(state, 'nope')).toBeNull();
    expect(findDoorUrl({}, 'opensearch-hitl')).toBeNull();
  });
});

describe('connectDoor and runTool against the BFF', () => {
  it('reads state, switches the door, and reports whether that door is signed in', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
      calls.push([url, opts.method, opts.body]);
      if (url.endsWith('/state')) return Promise.resolve(ok({ presets: [{ mode: 'privilege', url: 'https://gw/opensearch-hitl/mcp' }] }));
      return Promise.resolve(ok({ oauth: { authenticated: false, destinationAuthenticated: true } }));
    }));
    const r = await connectDoor('opensearch-hitl');
    expect(r).toEqual({ ok: true, url: 'https://gw/opensearch-hitl/mcp', authenticated: true });
    expect(calls[1]).toEqual(['/api/privilege-mcp/config', 'POST', JSON.stringify({ gatewayMode: 'privilege', mcpUrl: 'https://gw/opensearch-hitl/mcp' })]);
  });

  it('reports a missing door instead of guessing a URL', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({ presets: [] }))));
    expect(await connectDoor('opensearch-hitl')).toMatchObject({ ok: false, reason: 'no-door' });
  });

  it('runTool sends the real call and classifies a hold, a 403 and a 401 from the server', async () => {
    const send = (res) => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res)));
    send(ok(HOLD));
    expect(await runTool('SearchIndexTool', { index: '*' })).toMatchObject({ outcome: 'hold', instructionId: 'ins_0123456789abcdef' });
    send(fail(403, { error: 'Forbidden' }));
    expect(await runTool('GenericOpenSearchApiTool', {})).toMatchObject({ outcome: 'deny', raw: { status: 403 } });
    send(fail(401, { error: 'Not authenticated.' }));
    expect(await runTool('ListIndexTool')).toMatchObject({ outcome: 'signin' });
  });

  it('posts the tool name and arguments exactly as the BFF expects', async () => {
    const f = vi.fn(() => Promise.resolve(ok({ result: { content: [] } })));
    vi.stubGlobal('fetch', f);
    await runTool('ListIndexTool', { index: 'a' });
    expect(f).toHaveBeenCalledWith('/api/privilege-mcp/tools/call', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ name: 'ListIndexTool', arguments: { index: 'a' } }) }));
  });
});
