'use strict';

/**
 * MCP spec: a request carrying params._meta.progressToken lets the backend
 * emit interim notifications/progress frames while the call is in flight.
 * proxyJsonRpc previously had no way to surface these — notifications/progress
 * has no `id`, so `msg.id === request.id` was always false for one and the
 * frame was silently dropped (confirmed absent in the MCP spec-compliance
 * audit). This adds an onProgress callback, called once per interim frame,
 * without disturbing the final response resolution.
 */

import { EventEmitter } from 'events';

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  send = jest.fn();
  close = jest.fn();
  terminate = jest.fn();
}

let lastSocket: FakeWebSocket;

jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => {
    lastSocket = new FakeWebSocket();
    return lastSocket;
  });
});

import { proxyJsonRpc } from '../src/proxy';

describe('proxyJsonRpc — notifications/progress forwarding', () => {
  it('calls onProgress for an interim notifications/progress frame, then still resolves the final response', async () => {
    const onProgress = jest.fn();
    const p = proxyJsonRpc(
      'ws://localhost:8080',
      'token',
      { jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'create_withdrawal', _meta: { progressToken: 'tok-1' } } },
      undefined,
      undefined,
      onProgress,
    );

    lastSocket.emit('open');
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'gw-init', result: {} })));
    lastSocket.emit('message', Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 'tok-1', progress: 1, total: 2 },
    })));
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 42, result: { content: [] } })));

    const result = await p;

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({ progressToken: 'tok-1', progress: 1, total: 2 });
    expect(result.id).toBe(42);
  });

  it('does not call onProgress for the final response itself', async () => {
    const onProgress = jest.fn();
    const p = proxyJsonRpc(
      'ws://localhost:8080',
      'token',
      { jsonrpc: '2.0', id: 7, method: 'tools/list' },
      undefined,
      undefined,
      onProgress,
    );
    lastSocket.emit('open');
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'gw-init', result: {} })));
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { tools: [] } })));
    await p;
    expect(onProgress).not.toHaveBeenCalled();
  });
});
