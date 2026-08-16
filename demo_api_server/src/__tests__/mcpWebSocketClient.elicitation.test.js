/**
 * @file mcpWebSocketClient.elicitation.test.js
 * @description Regression guard for BUGS.md #44 — the elicitation/create
 * branch of ws.on('message') called a bare `emit(...)` that was never
 * declared, imported, or destructured anywhere in mcpWebSocketClient.js.
 * Any real server-initiated `elicitation/create` frame threw
 * `ReferenceError: emit is not defined` synchronously inside the WS message
 * handler, which server.js's unconditional `process.on('uncaughtException',
 * ...) → process.exit(1)` turned into a full demo_api_server crash for
 * every user's session, not just the triggering request.
 *
 * Fix: the elicitation event is now published through the SAME mechanism
 * mcpToolPipeline.js already uses for every other `phase:` event —
 * deps.emit (→ mcpFlowSseHub.publish under the hood in server.js) — passed
 * down to mcpCallTool as `opts.emit` and guarded so callers that don't pass
 * one (e.g. the agent-tool path, flowTraceId: null) get a safe no-op instead
 * of a crash.
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
const { mcpCallTool, resolveElicitation } = require('../../services/mcpWebSocketClient');

async function openAndHandshake(callPromise) {
  await Promise.resolve(); await Promise.resolve();
  MockedWebSocket.lastInstance.emit('open');
  MockedWebSocket.lastInstance.emit('message', JSON.stringify({
    jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' },
  }));
  await Promise.resolve(); await Promise.resolve();
}

function sendElicitationCreate(overrides = {}) {
  MockedWebSocket.lastInstance.emit('message', JSON.stringify({
    jsonrpc: '2.0',
    id: 'elic-1',
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: 'Confirm the transfer amount',
      requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } },
      url: null,
      ...overrides,
    },
  }));
}

function finishFollowResponse() {
  MockedWebSocket.lastInstance.emit('message', JSON.stringify({
    jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '{}' }] },
  }));
}

describe('mcpWebSocketClient — elicitation/create (server-initiated request)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not throw and does not call an undeclared emit() when opts.emit is omitted (crash regression guard)', async () => {
    const callPromise = mcpCallTool('get_my_accounts', {}, 'agent-token', 'user-1', 'corr-1');
    await openAndHandshake(callPromise);

    // Before the fix this line threw `ReferenceError: emit is not defined`
    // synchronously out of EventEmitter.emit(), which is exactly the crash
    // path server.js's uncaughtException handler turns into process.exit(1).
    expect(() => sendElicitationCreate()).not.toThrow();
    await Promise.resolve(); await Promise.resolve();

    resolveElicitation('elic-1', { action: 'accept', content: { confirm: true } });
    await Promise.resolve(); await Promise.resolve();

    finishFollowResponse();
    await callPromise;
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });

  it('publishes the elicitation_requested phase via opts.emit with the elicitationId/mode/message/requestedSchema/url/payload shape', async () => {
    const emit = jest.fn();
    const callPromise = mcpCallTool('get_my_accounts', {}, 'agent-token', 'user-1', 'corr-1', { emit });
    await openAndHandshake(callPromise);

    sendElicitationCreate();
    await Promise.resolve(); await Promise.resolve();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      phase: 'elicitation_requested',
      elicitationId: 'elic-1',
      mode: 'form',
      message: 'Confirm the transfer amount',
      requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } },
      url: null,
      payload: {
        mode: 'form',
        message: 'Confirm the transfer amount',
        requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } },
        url: null,
      },
    });

    resolveElicitation('elic-1', { action: 'accept', content: { confirm: true } });
    await Promise.resolve(); await Promise.resolve();

    // The browser's response is still sent back over the WS as before the fix.
    const responseFrame = MockedWebSocket.lastInstance.send.mock.calls
      .map((c) => JSON.parse(c[0]))
      .find((m) => m.id === 'elic-1');
    expect(responseFrame.result).toEqual({ action: 'accept', content: { confirm: true } });

    finishFollowResponse();
    await callPromise;
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
});
