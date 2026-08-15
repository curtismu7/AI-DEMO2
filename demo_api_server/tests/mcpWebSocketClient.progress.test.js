'use strict';

/**
 * @file mcpWebSocketClient.progress.test.js
 * @description MCP spec: notifications/progress on the WS transport. No tool
 * in this demo emits one today (confirmed in the spec-compliance audit — only
 * the gateway's HTTP-transport relay/consume machinery exists, see
 * demo_mcp_gateway/tests/gateway-http-progress-cancellation.test.js), so this
 * covers the two pieces the MCP Inspector's "Attach progress token" toggle
 * depends on:
 *   1. mcpCallToolWithFrames can attach params._meta.progressToken to the
 *      outgoing tools/call request when the caller opts in.
 *   2. An interim notifications/progress message (a notification — method,
 *      no id) arriving before the final response must NOT be treated as an
 *      out-of-order response and reject the whole call; mcpRpc previously had
 *      no branch for a method+no-id message here at all, and the final
 *      "Check for tool/call or tools/list response" block would have
 *      rejected it. It should be captured onto the frame sink and the call
 *      should keep waiting for the real response.
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

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => ''),
}));

jest.mock('../services/mcpTrafficLogger', () => ({
  writeMcpTrafficEntry: jest.fn(),
}));

const MockedWebSocket = require('ws');
const { mcpCallToolWithFrames } = require('../services/mcpWebSocketClient');

async function completeHandshake() {
  await Promise.resolve(); await Promise.resolve();
  MockedWebSocket.lastInstance.emit('open');
  MockedWebSocket.lastInstance.emit('message', JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }));
  await Promise.resolve(); await Promise.resolve();
}

function sentFollowFrame() {
  return MockedWebSocket.lastInstance.send.mock.calls
    .map((c) => JSON.parse(c[0]))
    .find((m) => m.id === 2);
}

describe('mcpWebSocketClient — notifications/progress (WS transport)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('attaches params._meta.progressToken to the outgoing request when opts.meta is given', async () => {
    const callPromise = mcpCallToolWithFrames('get_my_accounts', {}, 'agent-token', 'user-1', 'corr-1', {
      meta: { progressToken: 'progress-123' },
    });
    await completeHandshake();

    const follow = sentFollowFrame();
    expect(follow.params._meta).toEqual({ progressToken: 'progress-123' });

    MockedWebSocket.lastInstance.emit('message', JSON.stringify({
      jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] },
    }));
    await callPromise;
  });

  it('does not send _meta when no opts.meta is given (backward compatible)', async () => {
    const callPromise = mcpCallToolWithFrames('get_my_accounts', {}, 'agent-token', 'user-1', 'corr-1');
    await completeHandshake();

    const follow = sentFollowFrame();
    expect(follow.params._meta).toBeUndefined();

    MockedWebSocket.lastInstance.emit('message', JSON.stringify({
      jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] },
    }));
    await callPromise;
  });

  it('captures an interim notifications/progress frame instead of rejecting the call', async () => {
    const callPromise = mcpCallToolWithFrames('get_my_accounts', {}, 'agent-token', 'user-1', 'corr-1', {
      meta: { progressToken: 'progress-456' },
    });
    await completeHandshake();

    // Interim notification — has a method, but NO id (per JSON-RPC 2.0 notification shape).
    MockedWebSocket.lastInstance.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 'progress-456', progress: 1, total: 2 },
    }));
    await Promise.resolve(); await Promise.resolve();

    // The call must still be pending, not rejected, after the interim notification.
    MockedWebSocket.lastInstance.emit('message', JSON.stringify({
      jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{"ok":true}' }] },
    }));

    const { result, frames } = await callPromise;
    expect(result).toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] });
    expect(frames.notifications).toEqual([
      expect.objectContaining({ method: 'notifications/progress', params: { progressToken: 'progress-456', progress: 1, total: 2 } }),
    ]);
  });

  it('frames.notifications is absent when no interim notification arrived (honest empty result)', async () => {
    const callPromise = mcpCallToolWithFrames('get_my_accounts', {}, 'agent-token', 'user-1', 'corr-1');
    await completeHandshake();
    MockedWebSocket.lastInstance.emit('message', JSON.stringify({
      jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] },
    }));
    const { frames } = await callPromise;
    expect(frames.notifications).toBeUndefined();
  });
});
