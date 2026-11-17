/**
 * @file mcpWebSocketClient.modernRequest.test.js
 * @description Stateless (MCP 2026-07-28) requests on the BFF WebSocket client: a caller that
 * opts in (allowModern) sends the follow-up request alone with the version in params._meta; a
 * gateway that rejects it, or answers input_required, gets the same call once more with the
 * initialize handshake. Everyone else keeps the handshake.
 */
jest.mock('ws', () => {
  const { EventEmitter } = require('events');
  class FakeWebSocket extends EventEmitter {
    constructor() {
      super();
      this.terminate = jest.fn();
      this.close = jest.fn();
      this.send = jest.fn();
    }
  }
  const ctor = jest.fn().mockImplementation(() => {
    const ws = new FakeWebSocket();
    ctor.instances.push(ws);
    return ws;
  });
  ctor.instances = [];
  return ctor;
});

const mockFlags = { mcp_modern_requests: 'true' };
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((k) => (k in mockFlags ? mockFlags[k] : '')),
}));
jest.mock('../services/mcpTrafficLogger', () => ({ writeMcpTrafficEntry: jest.fn() }));

const MockedWebSocket = require('ws');
const { mcpListTools, mcpListToolsWithFrames } = require('../services/mcpWebSocketClient');
const { _resetModernNegotiationForTest } = require('../services/mcpModernRequest');

const GW = 'ws://mcp-gateway:3005';
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const flush = () => new Promise((r) => setImmediate(r));

const sent = (ws) => ws.send.mock.calls.map((c) => JSON.parse(c[0]));
const reply = (ws, msg) => ws.emit('message', Buffer.from(JSON.stringify(msg)));

/** Waits for the next socket, opens it and returns it. */
async function nextSocket(index) {
  await flush();
  const ws = MockedWebSocket.instances[index];
  expect(ws).toBeDefined();
  ws.emit('open');
  return ws;
}

/** Finishes a legacy handshake on `ws`, then answers the follow-up request. */
function completeHandshake(ws, result) {
  reply(ws, { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } });
  reply(ws, { jsonrpc: '2.0', id: 2, result });
}

describe('mcpWebSocketClient: stateless requests', () => {
  beforeEach(() => {
    MockedWebSocket.instances.length = 0;
    MockedWebSocket.mockClear();
    mockFlags.mcp_modern_requests = 'true';
    _resetModernNegotiationForTest();
  });

  it('sends the request alone, with the version in _meta and no initialize', async () => {
    const call = mcpListToolsWithFrames('tok', 'u1', 'c1', { serverUrl: GW, allowModern: true });
    const ws = await nextSocket(0);

    const frames = sent(ws);
    expect(frames).toHaveLength(1);
    expect(frames[0].method).toBe('tools/list');
    expect(frames[0].params._meta[META_VERSION]).toBe('2026-07-28');

    reply(ws, { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'get_my_accounts' }] } });
    const { result, frames: sink } = await call;
    expect(result.tools).toHaveLength(1);
    expect(MockedWebSocket.instances).toHaveLength(1);
    expect(sink.initializeRequest).toBeUndefined();
    expect(sink.mcpProtocol).toEqual({ version: '2026-07-28', stateless: true, reason: 'stateless' });
  });

  it('keeps the handshake for a caller that did not opt in', async () => {
    const call = mcpListToolsWithFrames('tok', 'u1', 'c1', { serverUrl: GW });
    const ws = await nextSocket(0);

    expect(sent(ws).map((f) => f.method)).toEqual(['initialize']);
    completeHandshake(ws, { tools: [] });
    const { frames } = await call;
    expect(frames.mcpProtocol).toEqual({ version: '2025-11-25', stateless: false, reason: 'not-requested' });
  });

  it('keeps the handshake when the flag is off', async () => {
    mockFlags.mcp_modern_requests = 'false';
    const call = mcpListToolsWithFrames('tok', 'u1', 'c1', { serverUrl: GW, allowModern: true });
    const ws = await nextSocket(0);

    expect(sent(ws).map((f) => f.method)).toEqual(['initialize']);
    completeHandshake(ws, { tools: [] });
    const { frames } = await call;
    expect(frames.mcpProtocol.reason).toBe('flag-off');
  });

  it('resends with the handshake when the gateway rejects the version, and remembers it', async () => {
    const first = mcpListToolsWithFrames('tok', 'u1', 'c1', { serverUrl: GW, allowModern: true });
    const ws1 = await nextSocket(0);
    reply(ws1, { jsonrpc: '2.0', id: 2, error: { code: -32022, message: 'Unsupported protocol version' } });

    const ws2 = await nextSocket(1);
    expect(sent(ws2).map((f) => f.method)).toEqual(['initialize']);
    completeHandshake(ws2, { tools: [{ name: 'a' }] });
    const { result, frames } = await first;
    expect(result.tools).toHaveLength(1);
    expect(frames.mcpProtocol).toEqual({ version: '2025-11-25', stateless: false, reason: 'resent-rejected' });
    expect(frames.initializeRequest).toBeDefined();

    // Remembered: the next call goes straight to the handshake, one socket only.
    const second = mcpListToolsWithFrames('tok', 'u1', 'c1', { serverUrl: GW, allowModern: true });
    const ws3 = await nextSocket(2);
    expect(sent(ws3).map((f) => f.method)).toEqual(['initialize']);
    completeHandshake(ws3, { tools: [] });
    expect((await second).frames.mcpProtocol.reason).toBe('gateway-rejected-recently');
  });

  it('treats a -32602 about _meta as a rejection', async () => {
    const call = mcpListTools('tok', 'u1', 'c1', { serverUrl: GW, allowModern: true });
    const ws1 = await nextSocket(0);
    reply(ws1, { jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'Invalid params: _meta is not supported' } });
    const ws2 = await nextSocket(1);
    completeHandshake(ws2, { tools: [] });
    await expect(call).resolves.toEqual({ tools: [] });
  });

  it('resends with the handshake on input_required, without remembering a rejection', async () => {
    const first = mcpListToolsWithFrames('tok', 'u1', 'c1', { serverUrl: GW, allowModern: true });
    const ws1 = await nextSocket(0);
    reply(ws1, { jsonrpc: '2.0', id: 2, result: { resultType: 'input_required', inputRequests: {}, requestState: 'gw1.x.y' } });

    const ws2 = await nextSocket(1);
    expect(sent(ws2).map((f) => f.method)).toEqual(['initialize']);
    completeHandshake(ws2, { tools: [] });
    expect((await first).frames.mcpProtocol.reason).toBe('resent-input-required');

    // input_required is a Modern answer, so the next call tries stateless again.
    const second = mcpListToolsWithFrames('tok', 'u1', 'c1', { serverUrl: GW, allowModern: true });
    const ws3 = await nextSocket(2);
    expect(sent(ws3)).toHaveLength(1);
    reply(ws3, { jsonrpc: '2.0', id: 2, result: { tools: [] } });
    expect((await second).frames.mcpProtocol.stateless).toBe(true);
  });

  it('does not retry an ordinary error such as a scope denial', async () => {
    const call = mcpListTools('tok', 'u1', 'c1', { serverUrl: GW, allowModern: true });
    const ws = await nextSocket(0);
    reply(ws, { jsonrpc: '2.0', id: 2, error: { code: -32001, message: 'Bearer token invalid' } });
    await expect(call).rejects.toThrow('Bearer token invalid');
    expect(MockedWebSocket.instances).toHaveLength(1);
  });
});
