/**
 * MCP 2026-07-28 stateless requests over POST /mcp.
 *
 * A Modern request declares its version in params._meta, sends no initialize,
 * and receives no Mcp-Session-Id. Legacy (2025-11-25) behavior must be
 * unchanged — the last block pins that. Auth gates are shared code, so the
 * bearer requirement is re-asserted for the Modern path rather than assumed.
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-http-modern-'));
process.env.AIRLINES_DB_PATH = path.join(tmpDir, 'airlines.db');
process.env.AIRLINES_SEED_PATH = path.join(__dirname, '..', 'seed', 'airlines.seed.json');
process.env.MCP_RESOURCE_SERVER_RESOURCE_URI = 'mcp-resource-server.ping.demo';
process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
process.env.PORT = '0';

let server: http.Server;
let base: string;

beforeAll(async () => {
  const mod = await import('../src/index');
  server = (mod as unknown as { httpServer: http.Server }).httpServer;
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(scope: string): string {
  return [
    b64({ alg: 'RS256', typ: 'JWT' }),
    b64({ sub: 'probe', aud: 'mcp-resource-server.ping.demo', scope, exp: Math.floor(Date.now() / 1000) + 600 }),
    'unsigned',
  ].join('.');
}

const V = 'io.modelcontextprotocol/protocolVersion';
const CAPS = 'io.modelcontextprotocol/clientCapabilities';
const LOG = 'io.modelcontextprotocol/logLevel';
const SESSION = 'mcp-session-id';
const modernMeta = (extra: Record<string, unknown> = {}) => ({ [V]: '2026-07-28', [CAPS]: {}, ...extra });

async function post(body: unknown, headers: Record<string, string> = {}, bearer?: string) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, session: res.headers.get(SESSION), json: text ? JSON.parse(text) : null };
}

const listReq = (params: Record<string, unknown> = { _meta: modernMeta() }) =>
  ({ jsonrpc: '2.0', id: 1, method: 'tools/list', params });

describe('Modern request: stateless tools/list', () => {
  it('serves tools/list with no initialize, no session id, resultType and cache hints', async () => {
    const r = await post(listReq(), { 'Mcp-Method': 'tools/list', 'MCP-Protocol-Version': '2026-07-28' });
    expect(r.status).toBe(200);
    expect(r.session).toBeNull();
    expect(r.json.result.resultType).toBe('complete');
    expect(r.json.result.ttlMs).toBeGreaterThanOrEqual(0);
    expect(r.json.result.cacheScope).toBe('private');
    expect(r.json.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('banking-mcp-resource-server');
    expect(r.json.result.tools.length).toBeGreaterThan(0);
  });

  it('serves prompts/list as publicly cacheable', async () => {
    const r = await post(
      { jsonrpc: '2.0', id: 2, method: 'prompts/list', params: { _meta: modernMeta() } },
      { 'Mcp-Method': 'prompts/list' },
      token('airlines:read'),
    );
    expect(r.status).toBe(200);
    expect(r.json.result.cacheScope).toBe('public');
    expect(r.json.result.resultType).toBe('complete');
  });
});

describe('Modern request: header and _meta validation (HTTP 400)', () => {
  it('rejects a missing Mcp-Method with -32020', async () => {
    const r = await post(listReq());
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe(-32020);
  });

  it('rejects an Mcp-Method that disagrees with the body', async () => {
    const r = await post(listReq(), { 'Mcp-Method': 'tools/call' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe(-32020);
  });

  it('requires Mcp-Name on tools/call and rejects a mismatch', async () => {
    const call = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_airline_bookings', arguments: {}, _meta: modernMeta() } };
    const missing = await post(call, { 'Mcp-Method': 'tools/call' }, token('airlines:read'));
    expect(missing.status).toBe(400);
    expect(missing.json.error.code).toBe(-32020);
    const wrong = await post(call, { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'something_else' }, token('airlines:read'));
    expect(wrong.status).toBe(400);
    expect(wrong.json.error.code).toBe(-32020);
  });

  it('rejects an MCP-Protocol-Version header that disagrees with _meta', async () => {
    const r = await post(listReq(), { 'Mcp-Method': 'tools/list', 'MCP-Protocol-Version': '2025-11-25' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe(-32020);
  });

  it('rejects missing clientCapabilities with -32602', async () => {
    const r = await post(listReq({ _meta: { [V]: '2026-07-28' } }), { 'Mcp-Method': 'tools/list' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe(-32602);
  });

  it('rejects an unsupported version with -32022 on HTTP 400', async () => {
    const r = await post(listReq({ _meta: { [V]: '2099-01-01', [CAPS]: {} } }), { 'Mcp-Method': 'tools/list' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe(-32022);
  });
});

describe('Modern request: auth gates still apply', () => {
  it('401s a tokenless tools/call', async () => {
    const call = { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_airline_bookings', arguments: {}, _meta: modernMeta() } };
    const r = await post(call, { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'get_airline_bookings' });
    expect(r.status).toBe(401);
  });

  it('completes a tools/call with a valid token and resultType complete', async () => {
    const call = { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_airline_bookings', arguments: {}, _meta: modernMeta() } };
    const r = await post(call, { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'get_airline_bookings' }, token('airlines:read'));
    expect(r.status).toBe(200);
    expect(r.json.result.resultType).toBe('complete');
    expect(r.json.result.ttlMs).toBeUndefined();
  });
});

describe('Modern request: removed methods and logging', () => {
  it('treats ping and logging/setLevel as not found', async () => {
    for (const method of ['ping', 'logging/setLevel']) {
      const r = await post(
        { jsonrpc: '2.0', id: 6, method, params: { level: 'info', _meta: modernMeta() } },
        { 'Mcp-Method': method },
        token('airlines:read'),
      );
      expect(r.json.error.code).toBe(-32601);
    }
  });

  it('accepts a per-request logLevel without emitting a notification frame ahead of the reply', async () => {
    const r = await post(listReq({ _meta: modernMeta({ [LOG]: 'debug' }) }), { 'Mcp-Method': 'tools/list' });
    expect(r.status).toBe(200);
    expect(r.json.result.resultType).toBe('complete');
  });

  it('rejects an invalid logLevel with -32602', async () => {
    const r = await post(listReq({ _meta: modernMeta({ [LOG]: 'loud' }) }), { 'Mcp-Method': 'tools/list' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe(-32602);
  });
});

describe('server/discover', () => {
  it('lists 2026-07-28 with cache hints and needs no Modern headers', async () => {
    const r = await post({ jsonrpc: '2.0', id: 7, method: 'server/discover', params: {} }, {}, token('airlines:read'));
    expect(r.status).toBe(200);
    expect(r.json.result.supportedVersions).toEqual(['2025-11-25', '2026-07-28']);
    expect(r.json.result.resultType).toBe('complete');
    expect(r.json.result.cacheScope).toBe('public');
    expect(r.json.result.ttlMs).toBeGreaterThan(0);
  });
});

describe('Legacy 2025-11-25 behavior is unchanged', () => {
  it('still answers initialize with a session id and the 2025-11-25 version', async () => {
    const r = await post({
      jsonrpc: '2.0', id: 8, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    });
    expect(r.status).toBe(200);
    expect(r.session).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.json.result.protocolVersion).toBe('2025-11-25');
    expect(r.json.result.resultType).toBeUndefined();
  });

  it('serves a Legacy tools/list with no headers, resultType or cache hints', async () => {
    const r = await post({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} });
    expect(r.status).toBe(200);
    expect(r.json.result.resultType).toBeUndefined();
    expect(r.json.result.ttlMs).toBeUndefined();
  });

  it('still accepts logging/setLevel', async () => {
    const r = await post(
      { jsonrpc: '2.0', id: 10, method: 'logging/setLevel', params: { level: 'info' } },
      {},
      token('airlines:read'),
    );
    expect(r.json.result).toEqual({});
  });
});
