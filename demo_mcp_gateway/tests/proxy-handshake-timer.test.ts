'use strict';

/**
 * proxy-handshake-timer.test.ts — WR-04 regression.
 *
 * Asserts the inner handshake setTimeout in proxyJsonRpc is cleared on the
 * successful path: after the call resolves, advancing virtual time past
 * HANDSHAKE_TIMEOUT_MS must NOT fire a late ws.terminate() (the leaked timer
 * + closure the fix removes).
 */

import { EventEmitter } from 'events';

// Fake WebSocket: an EventEmitter with send/close/terminate spies. The test
// drives 'open' then 'message' to simulate the MCP handshake.
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

describe('proxyJsonRpc handshake timer (WR-04)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not fire a late terminate() after a successful handshake + response', async () => {
    const p = proxyJsonRpc('ws://localhost:8080', 'token', {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/list',
    });

    // Drive the handshake: open → server replies to gw-init → server replies to id 42
    lastSocket.emit('open');
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'gw-init', result: {} })));
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 42, result: { tools: [] } })));

    const result = await p;
    expect(result.id).toBe(42);

    const terminateCallsBefore = lastSocket.terminate.mock.calls.length;

    // Advance well past the 10s handshake timeout. If the timer leaked it
    // would fire here and (in the !initialized window) call terminate().
    jest.advanceTimersByTime(60_000);

    expect(lastSocket.terminate.mock.calls.length).toBe(terminateCallsBefore);
  });
});
