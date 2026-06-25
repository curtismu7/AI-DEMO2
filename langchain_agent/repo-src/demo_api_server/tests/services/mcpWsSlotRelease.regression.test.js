'use strict';

/**
 * WR-06 — mcpWsSlotRelease.regression.test.js
 *
 * Proves the pooled WS slot is held until the RPC promise FULLY settles.
 * Before WR-06, releaseMcpWsSlot() ran inside the message handler before
 * resolve()/reject() returned, so a queued concurrent caller could acquire
 * the slot and construct a new WebSocket while the first response was still
 * in flight (response cross-talk / slot exhaustion).
 *
 * Test pattern (CLAUDE.md regression): everything mocked. We force the pool
 * to size 1 (MCP_WS_MAX_CONCURRENT=1) so the second caller MUST queue, then
 * assert the second WebSocket is not constructed until the first promise has
 * settled and each caller gets its own correct result (no cross-talk).
 *
 * MCP_WS_MAX_CONCURRENT is read at module load, so it is set before require().
 * The fake WebSocket lives inside the jest.mock factory (Jest forbids the
 * factory referencing out-of-scope non-`mock`-prefixed vars) and exposes its
 * instances via the `mock`-prefixed global the factory closes over.
 */

process.env.MCP_WS_MAX_CONCURRENT = '1';

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => (key === 'mcp_server_url' ? 'ws://localhost:8080' : null)),
}));

jest.mock('../../services/mcpTrafficLogger', () => ({
  writeMcpTrafficEntry: jest.fn(),
}));

const mockWsState = { constructions: 0, instances: [] };
global.__mockWsState = mockWsState;

jest.mock('ws', () => {
  const state = global.__mockWsState;
  return function FakeWebSocket(url) {
    const self = {
      url,
      listeners: {},
      sent: [],
      on(evt, cb) { self.listeners[evt] = cb; },
      _emit(evt, arg) { if (self.listeners[evt]) self.listeners[evt](arg); },
      send(payload) { self.sent.push(JSON.parse(payload)); },
      close() {},
      terminate() {},
      driveSuccess(followResult) {
        self._emit('message', Buffer.from(JSON.stringify({
          jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' },
        })));
        setImmediate(() => {
          self._emit('message', Buffer.from(JSON.stringify({
            jsonrpc: '2.0', id: 2, result: followResult,
          })));
        });
      },
    };
    state.constructions += 1;
    state.instances.push(self);
    setImmediate(() => self._emit('open'));
    return self;
  };
});

const { mcpCallTool } = require('../../services/mcpWebSocketClient');

const flush = () => new Promise((r) => setImmediate(r));

describe('WR-06 — WS pool slot held until RPC promise settles (regression)', () => {
  beforeEach(() => {
    mockWsState.constructions = 0;
    mockWsState.instances = [];
  });

  test('second concurrent caller does not get a slot until the first settles, and each gets its own result', async () => {
    const settleOrder = [];

    const callA = mcpCallTool('toolA', { a: 1 }, 'tokA').then((r) => {
      settleOrder.push('A');
      return r;
    });
    const callB = mcpCallTool('toolB', { b: 2 }, 'tokB').then((r) => {
      settleOrder.push('B');
      return r;
    });

    await flush();

    // Only ONE WebSocket: caller B is queued behind the size-1 pool.
    expect(mockWsState.constructions).toBe(1);

    mockWsState.instances[0].driveSuccess({ ok: true, who: 'A' });
    const resultA = await callA;

    // A's promise has SETTLED -> slot released -> B may construct its socket.
    await flush();
    expect(mockWsState.constructions).toBe(2);
    expect(settleOrder).toEqual(['A']);

    mockWsState.instances[1].driveSuccess({ ok: true, who: 'B' });
    const resultB = await callB;

    // No cross-talk: each caller received its OWN response.
    expect(resultA).toEqual({ ok: true, who: 'A' });
    expect(resultB).toEqual({ ok: true, who: 'B' });
    expect(settleOrder).toEqual(['A', 'B']);
  });

  test('slot is released after a rejected RPC so the next caller can proceed', async () => {
    const callA = mcpCallTool('toolA', {}, 'tokA');
    const callB = mcpCallTool('toolB', {}, 'tokB');

    await flush();
    expect(mockWsState.constructions).toBe(1);

    mockWsState.instances[0]._emit('error', new Error('boom'));
    await expect(callA).rejects.toThrow('boom');

    // Slot released in .finally despite rejection — B proceeds.
    await flush();
    expect(mockWsState.constructions).toBe(2);

    mockWsState.instances[1].driveSuccess({ ok: true });
    await expect(callB).resolves.toEqual({ ok: true });
  });
});
