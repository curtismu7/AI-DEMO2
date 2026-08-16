/**
 * @file mcpWebSocketClient.samplingRoots.test.js
 * @description MCP Sampling + Roots capabilities — this file is the BFF's
 * MCP *client* role handler (it already handles one server-initiated
 * request type, elicitation/create). sampling/createMessage and roots/list
 * previously fell into the unhandled branch (bare `return;`, no reply at
 * all) — confirmed absent in the MCP spec-compliance audit. Sampling is
 * wired to a real LLM call (llamacppLlmService, already used elsewhere in
 * this file's process for NL intent classification), not a stub.
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
    ctor.lastInstance = new FakeWebSocket();
    return ctor.lastInstance;
  });
  return ctor;
});

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => ''),
}));

jest.mock('../../services/mcpTrafficLogger', () => ({
  writeMcpTrafficEntry: jest.fn(),
}));

jest.mock('../../services/llamacppLlmService', () => ({
  callLlamaCpp: jest.fn(),
}));

const MockedWebSocket = require('ws');
const { callLlamaCpp } = require('../../services/llamacppLlmService');
const { mcpCallTool } = require('../../services/mcpWebSocketClient');

function finishFollowResponse() {
  MockedWebSocket.lastInstance.emit('message', JSON.stringify({
    jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] },
  }));
}

describe('mcpWebSocketClient — Sampling and Roots (server-initiated requests)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sampling/createMessage: calls callLlamaCpp with the request messages and replies with role/content/model', async () => {
    callLlamaCpp.mockResolvedValue('The account balance is $500.');
    const callPromise = mcpCallTool('get_my_accounts', {}, 'agent-token', 'user-1', 'corr-1');
    await Promise.resolve(); await Promise.resolve();
    MockedWebSocket.lastInstance.emit('open');
    MockedWebSocket.lastInstance.emit('message', JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }));
    await Promise.resolve(); await Promise.resolve();

    MockedWebSocket.lastInstance.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: 'sample-1',
      method: 'sampling/createMessage',
      params: {
        messages: [{ role: 'user', content: { type: 'text', text: 'What is the balance?' } }],
        systemPrompt: 'You are a helpful banking assistant.',
      },
    }));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(callLlamaCpp).toHaveBeenCalledTimes(1);
    const [messages] = callLlamaCpp.mock.calls[0];
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'system', content: 'You are a helpful banking assistant.' }),
      expect.objectContaining({ role: 'user', content: 'What is the balance?' }),
    ]));

    const sampleReply = MockedWebSocket.lastInstance.send.mock.calls
      .map((c) => JSON.parse(c[0]))
      .find((m) => m.id === 'sample-1');
    expect(sampleReply.result).toMatchObject({
      role: 'assistant',
      content: { type: 'text', text: 'The account balance is $500.' },
    });
    expect(typeof sampleReply.result.model).toBe('string');

    finishFollowResponse();
    await callPromise;
    // The WS pool releases its slot in a .finally() on a promise NOT
    // returned to the caller (WR-06) — a couple more ticks so the next
    // test's mcpCallTool() constructs a genuinely fresh WebSocket instead
    // of racing this one's still-in-flight cleanup.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });

  it('sampling/createMessage: an LLM failure replies with a JSON-RPC error, not a hang', async () => {
    callLlamaCpp.mockRejectedValue(new Error('llama.cpp unreachable'));
    const callPromise = mcpCallTool('get_my_accounts', {}, 'agent-token', 'user-1', 'corr-1');
    await Promise.resolve(); await Promise.resolve();
    MockedWebSocket.lastInstance.emit('open');
    MockedWebSocket.lastInstance.emit('message', JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }));
    await Promise.resolve(); await Promise.resolve();

    MockedWebSocket.lastInstance.emit('message', JSON.stringify({
      jsonrpc: '2.0', id: 'sample-2', method: 'sampling/createMessage',
      params: { messages: [{ role: 'user', content: { type: 'text', text: 'x' } }] },
    }));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const errReply = MockedWebSocket.lastInstance.send.mock.calls
      .map((c) => JSON.parse(c[0]))
      .find((m) => m.id === 'sample-2');
    expect(errReply.error.message).toMatch(/llama\.cpp unreachable/);

    finishFollowResponse();
    await callPromise;
    // The WS pool releases its slot in a .finally() on a promise NOT
    // returned to the caller (WR-06) — a couple more ticks so the next
    // test's mcpCallTool() constructs a genuinely fresh WebSocket instead
    // of racing this one's still-in-flight cleanup.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });

  it('roots/list: replies with an empty roots array — this system has no filesystem exposure to grant', async () => {
    const callPromise = mcpCallTool('get_my_accounts', {}, 'agent-token', 'user-1', 'corr-1');
    await Promise.resolve(); await Promise.resolve();
    MockedWebSocket.lastInstance.emit('open');
    MockedWebSocket.lastInstance.emit('message', JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }));
    await Promise.resolve(); await Promise.resolve();

    MockedWebSocket.lastInstance.emit('message', JSON.stringify({
      jsonrpc: '2.0', id: 'roots-1', method: 'roots/list', params: {},
    }));
    await Promise.resolve(); await Promise.resolve();

    const rootsReply = MockedWebSocket.lastInstance.send.mock.calls
      .map((c) => JSON.parse(c[0]))
      .find((m) => m.id === 'roots-1');
    expect(rootsReply.result).toEqual({ roots: [] });

    finishFollowResponse();
    await callPromise;
    // The WS pool releases its slot in a .finally() on a promise NOT
    // returned to the caller (WR-06) — a couple more ticks so the next
    // test's mcpCallTool() constructs a genuinely fresh WebSocket instead
    // of racing this one's still-in-flight cleanup.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });

  it('declares sampling, roots, and elicitation capabilities on the initialize handshake', async () => {
    mcpCallTool('get_my_accounts', {}, 'agent-token', 'user-1', 'corr-1').catch(() => {});
    await Promise.resolve(); await Promise.resolve();
    MockedWebSocket.lastInstance.emit('open');
    const initFrame = JSON.parse(MockedWebSocket.lastInstance.send.mock.calls[0][0]);
    expect(initFrame.params.capabilities).toMatchObject({
      sampling: {},
      roots: { listChanged: false },
      elicitation: {},
    });
  });
});
