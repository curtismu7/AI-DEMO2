/**
 * @file mcpWebSocketClient.closeHandling.test.js
 * @description Regression test: a server-side policy rejection (clean WS close,
 * e.g. DemoMCPServer.handleConnection's authorizeLastHop check calling
 * ws.close(1008, 'Agent token rejected')) must reject the pending RPC promise
 * immediately with the close reason, not silently wait out the 15s timeout
 * and report a generic "MCP call timed out".
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

const MockedWebSocket = require('ws');
const { mcpListTools } = require('../../services/mcpWebSocketClient');

describe('mcpWebSocketClient — WS close handling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects immediately with the close code/reason on a clean server-side close (does not wait out the 15s timeout)', async () => {
    const callPromise = mcpListTools('agent-token', 'user-1', 'corr-1', { serverUrl: 'ws://mcp.example:8080' });
    // Let the connect() Promise executor run and register its ws.on(...) handlers.
    await Promise.resolve();
    await Promise.resolve();

    MockedWebSocket.lastInstance.emit('open');
    MockedWebSocket.lastInstance.emit('close', 1008, Buffer.from('Agent token rejected'));

    await expect(callPromise).rejects.toThrow(
      'MCP connection closed before response (code 1008: Agent token rejected)',
    );
    // The bug: without a 'close' handler this only rejected after the 15000ms
    // setTimeout fired. Asserting no pending timers proves we didn't wait for it.
    expect(jest.getTimerCount()).toBe(0);
  });
});
