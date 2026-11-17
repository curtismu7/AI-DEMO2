'use strict';

/**
 * A dropped WebSocket cancels the calls in flight on it (MCP 2026-07-28), except tools that must
 * not be cut off half-way. src/index.ts boots a server on import, so this drives the real handler
 * over a real socket with the collaborators that need a live tenant mocked (same set as
 * wsRequestState.test.ts); the upstream proxy parks each call until it is aborted or released.
 */

import net from 'node:net';
import WebSocket from 'ws';

jest.mock('../src/vault', () => ({ loadVaultIntoEnv: async () => ({ loaded: false, entries: 0 }) }));
jest.mock('../src/tokenValidator', () => ({
  ...jest.requireActual('../src/tokenValidator'),
  validateInboundToken: jest.fn(async (token: string) => ({ sub: token.replace(/^tok-/, ''), scope: 'read write transfer' })),
}));
jest.mock('../src/auth/authorizeMcpRequestCore', () => ({
  runMcpAuthorizationPipeline: jest.fn(async () => ({ kind: 'authorized' })),
}));
jest.mock('../src/pingAuthorizeGuard', () => ({
  ...jest.requireActual('../src/pingAuthorizeGuard'),
  guardToolCall: jest.fn(async () => ({ permitted: true })),
  guardToolsList: jest.fn(async () => ({ permitted: true })),
  warmupAuthz: jest.fn(async () => undefined),
}));
jest.mock('../src/enterpriseMcpAuthSync', () => ({ syncEnterpriseMcpAuthFromBff: jest.fn(async () => undefined) }));
jest.mock('../src/auth/McpTokenExchangeClient', () => ({
  ...jest.requireActual('../src/auth/McpTokenExchangeClient'),
  McpTokenExchangeClient: jest.fn().mockImplementation(() => ({
    exchange: jest.fn(async () => ({ token: 'backend-token', cached: false, targetAud: 'mcpserver.ping.demo' })),
  })),
}));
jest.mock('../src/proxy', () => ({
  ...jest.requireActual('../src/proxy'),
  proxyJsonRpc: jest.fn(),
}));

import { proxyJsonRpc } from '../src/proxy';

const upstream = proxyJsonRpc as jest.Mock;

/** The abort signal each parked call was given, by tool name. */
const signals = new Map<string, AbortSignal>();
const releases = new Map<string, () => void>();

let port = 0;
let reqId = 0;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });
}

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers: { authorization: 'Bearer tok-u1' } });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** The gateway finishes booting asynchronously after import; retry until it listens. */
async function connectWhenUp(): Promise<WebSocket> {
  let lastErr: unknown;
  for (let i = 0; i < 100; i++) {
    try {
      return await connect();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw lastErr;
}

async function waitFor(cond: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Sends a tools/call and does not wait for the answer. */
function send(ws: WebSocket, name: string, args: Record<string, unknown>): number {
  const id = ++reqId;
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }));
  return id;
}

beforeAll(async () => {
  port = await freePort();
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  Object.assign(process.env, {
    MCP_GW_CLIENT_ID: 'test-client-id',
    MCP_GW_CLIENT_SECRET: 'test-client-secret',
    MCP_GW_RESOURCE_URI: 'test-gateway-resource',
    PINGONE_TOKEN_ENDPOINT: 'https://auth.test/as/token',
  });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  upstream.mockImplementation((_url: string, _token: string, msg: { id: unknown; params: { name: string } }, _x: unknown, _tls: unknown, _progress: unknown, signal: AbortSignal) =>
    new Promise((resolve, reject) => {
      signals.set(msg.params.name, signal);
      signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { code: 'cancelled' })));
      releases.set(msg.params.name, () => resolve({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'done' }] } }));
    }));
  await import('../src/index');
});

afterAll(() => {
  for (const k of ['MCP_GW_CLIENT_ID', 'MCP_GW_CLIENT_SECRET', 'MCP_GW_RESOURCE_URI', 'PINGONE_TOKEN_ENDPOINT', 'PORT', 'HOST']) delete process.env[k];
});

beforeEach(() => {
  signals.clear();
  releases.clear();
});

describe('WebSocket disconnect cancels in-flight calls', () => {
  it('aborts a read-only call but leaves a money-moving call running', async () => {
    const ws = await connectWhenUp();
    send(ws, 'get_my_accounts', {});
    send(ws, 'create_withdrawal', { from_account_id: 'acct-1', amount: 100 });
    await waitFor(() => signals.has('get_my_accounts') && signals.has('create_withdrawal'), 'both calls to reach the upstream');

    ws.close();
    // Both calls are registered on this one connection and the close handler visits them in the
    // same synchronous loop, so once the read is aborted the withdrawal has been looked at too.
    await waitFor(() => signals.get('get_my_accounts')!.aborted, 'the read-only call to be aborted');
    expect(signals.get('create_withdrawal')!.aborted).toBe(false);

    releases.get('create_withdrawal')!();
  });

  it('does not abort anything while the connection stays open', async () => {
    const ws = await connectWhenUp();
    send(ws, 'get_my_accounts', {});
    await waitFor(() => signals.has('get_my_accounts'), 'the call to reach the upstream');
    await new Promise((r) => setTimeout(r, 100));
    expect(signals.get('get_my_accounts')!.aborted).toBe(false);

    releases.get('get_my_accounts')!();
    ws.close();
  });
});
