'use strict';

/**
 * WR-06 — mcpWsSlotRelease.integration.test.js
 *
 * Integration counterpart to mcpWsSlotRelease.regression.test.js. The WS
 * transport itself is necessarily faked (no live MCP server in CI), but the
 * REAL configStore singleton is used to resolve the MCP server URL, and the
 * pool default (MCP_WS_MAX_CONCURRENT unset → 8) is exercised rather than
 * being forced to 1.
 *
 * Per CLAUDE.md "Test patterns: Regression vs. Integration": this confirms
 * that with the real configStore and the production default pool size, two
 * concurrent calls each receive their own correct result with no slot
 * cross-talk after the WR-06 .finally() release-timing fix.
 */

// configStore is NOT mocked — real singleton resolves mcp_server_url
// (defaults to ws://localhost:8080 when unset).

jest.mock('../../services/mcpTrafficLogger', () => ({
  writeMcpTrafficEntry: jest.fn(),
}));

const mockWsState = { instances: [] };
global.__mockWsStateIntegration = mockWsState;

jest.mock('ws', () => {
  const state = global.__mockWsStateIntegration;
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
    state.instances.push(self);
    setImmediate(() => self._emit('open'));
    return self;
  };
});

const { mcpCallTool } = require('../../services/mcpWebSocketClient');
const flush = () => new Promise((r) => setImmediate(r));

describe('WR-06 — slot release via real configStore + default pool (integration)', () => {
  beforeEach(() => { mockWsState.instances = []; });

  test('two concurrent calls each receive their own result with no cross-talk', async () => {
    const callA = mcpCallTool('toolA', { a: 1 }, 'tokA');
    const callB = mcpCallTool('toolB', { b: 2 }, 'tokB');

    // Default pool (8) allows both sockets concurrently.
    await flush();
    expect(mockWsState.instances.length).toBe(2);

    // Resolve out of order to stress for cross-talk.
    mockWsState.instances[1].driveSuccess({ ok: true, who: 'B' });
    mockWsState.instances[0].driveSuccess({ ok: true, who: 'A' });

    const [resA, resB] = await Promise.all([callA, callB]);
    expect(resA).toEqual({ ok: true, who: 'A' });
    expect(resB).toEqual({ ok: true, who: 'B' });
  });
});
