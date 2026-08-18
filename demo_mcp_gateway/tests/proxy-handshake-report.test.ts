'use strict';

/**
 * proxy-handshake-report.test.ts — the gateway is the MCP client, so it is the
 * only thing that can report the lifecycle.
 *
 * Traced live 2026-08-18: on the gateway path the BFF never speaks MCP. This
 * proxy opens a WebSocket per call and runs initialize ->
 * notifications/initialized -> the real request -> close. Driving the tool-call
 * leg alone produced initialize / notifications/initialized / tools/list on the
 * MCP server and NO tools/call, so the session belongs to discovery.
 *
 * #1977 reported this on the HTTP proxy response header and has never fired,
 * because discovery arrives over a WebSocket and a header cannot reach a
 * WebSocket caller. These tests pin the replacement: the handshake rides the
 * resolved response, without changing what goes on the wire.
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

/** Drive a full handshake and return the resolved response. */
async function runCall(initResult: Record<string, unknown> | undefined) {
  const p = proxyJsonRpc('ws://localhost:8080', 'token', {
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/list',
  });
  lastSocket.emit('open');
  lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'gw-init', result: initResult })));
  lastSocket.emit('message', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { tools: [] } })));
  return p;
}

describe('proxyJsonRpc reports the MCP handshake it performs', () => {
  it('attaches the negotiated protocol version and server info', async () => {
    const res = await runCall({
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'DemoMCPServer', version: '1.0.0' },
    });

    const hs = (res as unknown as { _gwHandshake?: any })._gwHandshake;
    expect(hs).toBeDefined();
    expect(hs.initialize.protocolVersion).toBe('2025-11-25');
    expect(hs.initialize.serverInfo).toEqual({ name: 'DemoMCPServer', version: '1.0.0' });
  });

  it('reports initialized, because this proxy really does send the notification', async () => {
    const res = await runCall({ protocolVersion: '2025-11-25' });
    expect((res as unknown as { _gwHandshake?: any })._gwHandshake.initialized).toBe(true);
    // Not an assumption — the notification is on the wire.
    const sent = lastSocket.send.mock.calls.map((c) => String(c[0]));
    expect(sent.some((m) => m.includes('notifications/initialized'))).toBe(true);
  });

  it('survives an initialize result the server did not fill in', async () => {
    const res = await runCall(undefined);
    const hs = (res as unknown as { _gwHandshake?: any })._gwHandshake;
    expect(hs.initialize.protocolVersion).toBeNull();
    expect(hs.initialize.serverInfo).toBeNull();
  });

  it('does NOT change what the response serializes to', async () => {
    // The report is non-enumerable on purpose: this object is forwarded and
    // stringified by existing callers, and a new visible key would alter the
    // JSON-RPC payload they put on the wire.
    const res = await runCall({ protocolVersion: '2025-11-25' });
    expect(JSON.parse(JSON.stringify(res))).toEqual({ jsonrpc: '2.0', id: 7, result: { tools: [] } });
    expect(Object.keys(res)).not.toContain('_gwHandshake');
  });
});
