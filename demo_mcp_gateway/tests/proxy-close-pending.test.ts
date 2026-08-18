'use strict';

/**
 * proxy-close-pending.test.ts — WS-close-hang regression.
 *
 * If a backend completes the MCP handshake then closes the socket cleanly
 * WITHOUT answering the proxied request (crash mid-call, policy-close,
 * restart), proxyJsonRpc must REJECT the pending call with a transport-closed
 * error rather than hang forever. Before the fix the `close` handler only
 * cleared the timers (including the safety timeout), so the promise never
 * settled and index.ts's inFlightCalls entry (awaited, cleaned in `finally`)
 * leaked. Tested at the proxyJsonRpc level per the guidance — index.ts's WS
 * wiring has top-level side effects; the awaiting caller's `finally` is what
 * removes the inFlightCalls entry once this promise settles.
 */

import { EventEmitter } from 'events';

// Fake WebSocket: an EventEmitter with send/close/terminate spies (same shape
// as proxy-handshake-timer.test.ts).
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

describe('proxyJsonRpc — backend closes before responding', () => {
  it('rejects the pending call with a transport-closed error instead of hanging', async () => {
    const p = proxyJsonRpc('ws://localhost:8080', 'token', {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/list',
    });

    // Handshake completes, but the backend closes WITHOUT answering id 42.
    lastSocket.emit('open');
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'gw-init', result: {} })));
    lastSocket.emit('close');

    await expect(p).rejects.toThrow(/closed connection before responding/i);
  });

  it('does not double-settle: a normally-answered call is unaffected by its close event', async () => {
    const p = proxyJsonRpc('ws://localhost:8080', 'token', {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/list',
    });

    lastSocket.emit('open');
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'gw-init', result: {} })));
    lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { tools: [] } })));

    // Step 2 calls ws.close(); its resulting close event must NOT reject the
    // already-resolved promise (guarded by `settled`).
    const result = await p;
    expect(result.id).toBe(7);

    // Emitting a late close event again is a no-op — the resolved value stands
    // and there is no unhandled rejection.
    expect(() => lastSocket.emit('close')).not.toThrow();
    await expect(p).resolves.toMatchObject({ id: 7 });
  });
});
