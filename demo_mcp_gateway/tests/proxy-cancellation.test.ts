'use strict';

/**
 * MCP spec: notifications/cancelled lets a client abort an in-flight call.
 * proxyJsonRpc previously had no way to be aborted mid-call — the only
 * "stop early" mechanism was the flat 30s CALL_TIMEOUT_MS, a unilateral
 * timeout, not a client-initiated cancel (confirmed absent in the MCP
 * spec-compliance audit). This adds an optional AbortSignal: aborting
 * terminates the backend WS connection and rejects with a distinguishable
 * 'cancelled' error, well before the timeout would otherwise fire.
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

describe('proxyJsonRpc — cancellation via AbortSignal', () => {
  it('terminates the backend connection and rejects with a cancelled error when the signal aborts mid-call', async () => {
    const controller = new AbortController();
    const p = proxyJsonRpc(
      'ws://localhost:8080',
      'token',
      { jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'create_withdrawal' } },
      undefined,
      undefined,
      undefined,
      controller.signal,
    );

    lastSocket.emit('open');
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'gw-init', result: {} })));

    // Call is now in flight (past handshake, waiting on the real response) — cancel it.
    controller.abort();

    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
    expect(lastSocket.terminate).toHaveBeenCalledTimes(1);
  });

  it('aborting after the call already resolved is a no-op — no late terminate() or rejection', async () => {
    const controller = new AbortController();
    const p = proxyJsonRpc(
      'ws://localhost:8080',
      'token',
      { jsonrpc: '2.0', id: 43, method: 'tools/list' },
      undefined,
      undefined,
      undefined,
      controller.signal,
    );
    lastSocket.emit('open');
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'gw-init', result: {} })));
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 43, result: { tools: [] } })));

    const result = await p;
    expect(result.id).toBe(43);

    const terminateCallsBefore = lastSocket.terminate.mock.calls.length;
    controller.abort();
    expect(lastSocket.terminate.mock.calls.length).toBe(terminateCallsBefore);
  });
});
