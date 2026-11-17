'use strict';

/**
 * MRTR elicitation over the WebSocket transport (MCP 2026-07-28).
 *
 * authorizeMcpRequest.mrtr.test.ts and authorizeMcpRequest.requestState.test.ts
 * cover the HTTP middleware. The WebSocket handler in src/index.ts has its own
 * copy of the Modern branch (mint on the elicitation obligation, redeem on the
 * retry) and nothing exercised it. src/index.ts boots a server on import and
 * does not export handleMessage, so this drives the real handler over a real
 * socket with the collaborators that need a live tenant mocked: token
 * validation, introspection, the policy decision, the RFC 8693 exchange and
 * the upstream proxy.
 */

import net from 'node:net';
import WebSocket from 'ws';

jest.mock('../src/vault', () => ({ loadVaultIntoEnv: async () => ({ loaded: false, entries: 0 }) }));
jest.mock('../src/tokenValidator', () => ({
  ...jest.requireActual('../src/tokenValidator'),
  validateInboundToken: jest.fn(async (token: string) => ({ sub: token.replace(/^tok-/, ''), scope: 'write transfer' })),
}));
jest.mock('../src/auth/authorizeMcpRequestCore', () => ({
  runMcpAuthorizationPipeline: jest.fn(async () => ({ kind: 'authorized' })),
}));
jest.mock('../src/pingAuthorizeGuard', () => ({
  ...jest.requireActual('../src/pingAuthorizeGuard'),
  guardToolCall: jest.fn(),
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
  proxyJsonRpc: jest.fn(async (_url: string, _token: string, msg: { id: unknown }) => ({
    jsonrpc: '2.0',
    id: msg.id,
    result: { content: [{ type: 'text', text: 'done' }] },
  })),
}));

import { guardToolCall } from '../src/pingAuthorizeGuard';
import { proxyJsonRpc } from '../src/proxy';

const guard = guardToolCall as jest.Mock;
const upstream = proxyJsonRpc as jest.Mock;

const MODERN_META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
const ARGS = { from_account_id: 'acct-1', amount: 100 };
const ELICITATION_DENY = {
  permitted: false,
  obligation: 'elicitation',
  reason: 'HITL_REQUIRED',
  advice: [{ id: 'elicitation-prompt', value: 'Confirm the withdrawal?' }],
};

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

function connect(token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers: { authorization: `Bearer ${token}` } });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** The gateway finishes booting asynchronously after import; retry until it listens. */
async function connectWhenUp(token: string): Promise<WebSocket> {
  let lastErr: unknown;
  for (let i = 0; i < 100; i++) {
    try {
      return await connect(token);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw lastErr;
}

function call(ws: WebSocket, params: Record<string, unknown>): Promise<any> {
  const id = ++reqId;
  return new Promise((resolve) => {
    const onMsg = (raw: WebSocket.RawData) => {
      const m = JSON.parse(raw.toString());
      if (m.id === id) {
        ws.off('message', onMsg);
        resolve(m);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params }));
  });
}

const modernCall = (ws: WebSocket, args = ARGS, extra: Record<string, unknown> = {}) =>
  call(ws, { name: 'create_withdrawal', arguments: args, _meta: MODERN_META, ...extra });

let ws: WebSocket;

beforeAll(async () => {
  port = await freePort();
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  process.env.GW_REQUEST_STATE_SECRET = 'ws-test-secret-0123456789';
  // loadConfig() throws without the gateway's OAuth identity (see gateway-passthrough.test.ts).
  Object.assign(process.env, {
    MCP_GW_CLIENT_ID: 'test-client-id',
    MCP_GW_CLIENT_SECRET: 'test-client-secret',
    MCP_GW_RESOURCE_URI: 'test-gateway-resource',
    PINGONE_TOKEN_ENDPOINT: 'https://auth.test/as/token',
  });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await import('../src/index');
  ws = await connectWhenUp('tok-u1');
});

afterAll(() => {
  ws?.close();
  for (const k of ['GW_REQUEST_STATE_SECRET', 'MCP_GW_CLIENT_ID', 'MCP_GW_CLIENT_SECRET', 'MCP_GW_RESOURCE_URI', 'PINGONE_TOKEN_ENDPOINT', 'PORT', 'HOST']) delete process.env[k];
});

beforeEach(() => {
  guard.mockReset();
  upstream.mockClear();
});

describe('WebSocket MRTR elicitation (2026-07-28)', () => {
  it('a Modern caller gets input_required with a signed requestState, not the Legacy error', async () => {
    guard.mockResolvedValue(ELICITATION_DENY);
    const res = await modernCall(ws);

    expect(res.error).toBeUndefined();
    expect(res.result.resultType).toBe('input_required');
    expect(res.result.inputRequests.elicitation.method).toBe('elicitation/create');
    expect(res.result.inputRequests.elicitation.params.message).toBe('Confirm the withdrawal?');
    expect(res.result.requestState).toMatch(/^gw1\./);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('a Legacy caller still gets elicitation_required with an elicitation_id and no requestState', async () => {
    guard.mockResolvedValue(ELICITATION_DENY);
    const res = await call(ws, { name: 'create_withdrawal', arguments: ARGS });

    expect(res.error.code).toBe(-32003);
    expect(res.error.message).toBe('elicitation_required');
    expect(res.error.data.elicitation_id).toBeDefined();
    expect(res.result).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain('requestState');
  });

  it('accepting with the issued requestState runs the call once, with ElicitationConfirmed reaching the policy', async () => {
    guard.mockResolvedValueOnce(ELICITATION_DENY);
    const first = await modernCall(ws);

    guard.mockResolvedValueOnce({ permitted: true });
    const retry = await modernCall(ws, ARGS, {
      inputResponses: { elicitation: { action: 'accept' } },
      requestState: first.result.requestState,
    });

    expect(retry.error).toBeUndefined();
    expect(retry.result.content[0].text).toBe('done');
    expect(upstream).toHaveBeenCalledTimes(1);
    // The retry-only fields are consumed here and never forwarded upstream.
    const forwarded = upstream.mock.calls[0][2];
    expect(forwarded.params.requestState).toBeUndefined();
    expect(forwarded.params.inputResponses).toBeUndefined();
    // The policy sees the confirmation marker, as on the HTTP path.
    expect(guard.mock.calls[1][3]).toMatchObject({ _elicitation_confirmed: true });
  });

  describe('a retry that must be refused and must not reach the backend', () => {
    async function issue(args = ARGS) {
      guard.mockResolvedValueOnce(ELICITATION_DENY);
      const first = await modernCall(ws, args);
      return first.result.requestState as string;
    }
    const accept = { elicitation: { action: 'accept' } };

    function expectRefused(res: any) {
      expect(res.error.code).toBe(-32003);
      expect(res.error.data.reason).toBe('invalid_or_expired');
      expect(upstream).not.toHaveBeenCalled();
    }

    it('replaying a requestState that was already redeemed', async () => {
      const requestState = await issue();
      guard.mockResolvedValueOnce({ permitted: true });
      const ok = await modernCall(ws, ARGS, { inputResponses: accept, requestState });
      expect(ok.error).toBeUndefined();
      upstream.mockClear();

      guard.mockResolvedValue({ permitted: true });
      expectRefused(await modernCall(ws, ARGS, { inputResponses: accept, requestState }));
    });

    it('different arguments from the ones that were confirmed', async () => {
      const requestState = await issue();
      guard.mockResolvedValue({ permitted: true });
      expectRefused(await modernCall(ws, { ...ARGS, amount: 100000 }, { inputResponses: accept, requestState }));
    });

    it('a different tool that takes the same arguments (approve deposit, redeem on withdraw)', async () => {
      const sameShape = { amount: 100, portfolioType: 'checking' };
      guard.mockResolvedValueOnce(ELICITATION_DENY);
      const first = await call(ws, { name: 'deposit', arguments: sameShape, _meta: MODERN_META });
      expect(first.result.resultType).toBe('input_required');
      guard.mockResolvedValue({ permitted: true });
      expectRefused(await call(ws, {
        name: 'withdraw',
        arguments: sameShape,
        _meta: MODERN_META,
        inputResponses: accept,
        requestState: first.result.requestState,
      }));
    });

    it('a different signed-in user', async () => {
      const requestState = await issue();
      const other = await connectWhenUp('tok-u2');
      try {
        guard.mockResolvedValue({ permitted: true });
        expectRefused(await call(other, {
          name: 'create_withdrawal',
          arguments: ARGS,
          _meta: MODERN_META,
          inputResponses: accept,
          requestState,
        }));
      } finally {
        other.close();
      }
    });

    it('a tampered token', async () => {
      const requestState = await issue();
      const tampered = requestState.slice(0, -2) + (requestState.endsWith('AA') ? 'BB' : 'AA');
      guard.mockResolvedValue({ permitted: true });
      expectRefused(await modernCall(ws, ARGS, { inputResponses: accept, requestState: tampered }));
    });

    it('a Legacy elicitation_id presented as a requestState', async () => {
      guard.mockResolvedValueOnce(ELICITATION_DENY);
      const legacy = await call(ws, { name: 'create_withdrawal', arguments: ARGS });
      guard.mockResolvedValue({ permitted: true });
      expectRefused(await modernCall(ws, ARGS, {
        inputResponses: accept,
        requestState: legacy.error.data.elicitation_id,
      }));
    });

    it('a decline is not a confirmation', async () => {
      const requestState = await issue();
      guard.mockResolvedValue(ELICITATION_DENY);
      const res = await modernCall(ws, ARGS, { inputResponses: { elicitation: { action: 'decline' } }, requestState });
      // Not treated as confirmed: the policy asks again instead of running the tool.
      expect(res.result.resultType).toBe('input_required');
      expect(upstream).not.toHaveBeenCalled();
    });
  });
});
