'use strict';

/**
 * HTTP MCP transport.
 *
 * PingGateway has no WebSocket listener, so without this endpoint an IG-fronted
 * deployment cannot reach these tools at all — its /mcp/invest route proxied to
 * an endpoint that 404'd.
 *
 * These assertions exist to stop the HTTP path drifting from the WebSocket one:
 * both run the same handleMessage, so a missing audience check or a missing
 * per-tool scope gate on the new transport would be a silent auth bypass.
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-http-'));
process.env.AIRLINES_DB_PATH = path.join(tmpDir, 'airlines.db');
process.env.AIRLINES_SEED_PATH = path.join(__dirname, '..', 'seed', 'airlines.seed.json');
process.env.MCP_SERVER_RESOURCE_URI = 'mcp-resource-server.ping.demo';
process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
process.env.PORT = '0';

let server: http.Server;
let base: string;

beforeAll(async () => {
  // index.ts starts listening on import; PORT=0 gives an ephemeral port.
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
function token(scope: string, aud = 'mcp-resource-server.ping.demo'): string {
  return [
    b64({ alg: 'RS256', typ: 'JWT' }),
    b64({ sub: 'probe', aud, scope, exp: Math.floor(Date.now() / 1000) + 600 }),
    'unsigned',
  ].join('.');
}

async function post(body: unknown, bearer?: string) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, wwwAuth: res.headers.get('www-authenticate'), json: text ? JSON.parse(text) : null };
}

const callTool = (name: string, args: Record<string, unknown> = {}) =>
  ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

describe('POST /mcp', () => {
  it('401s without a bearer with RFC 6750 §3.1 WWW-Authenticate', async () => {
    const r = await post(callTool('get_airline_bookings'));
    expect(r.status).toBe(401);
    expect(r.wwwAuth).toMatch(/realm="/);
    expect(r.wwwAuth).toMatch(/error="invalid_token"/);
    expect(r.wwwAuth).toContain('resource_metadata=');
  });

  it('rejects a token minted for another audience', async () => {
    const r = await post(callTool('get_airline_bookings'), token('airlines:read', 'someone-else.ping.demo'));
    expect(r.json.error.code).toBe(-32001);
    expect(r.json.error.message).toMatch(/Audience mismatch/);
  });

  // The gate that matters: the new transport must not become a way around the
  // per-tool scope check the WebSocket path enforces.
  // RFC 6750 §3.1: scope violations on HTTP MUST be 403, not 200.
  it('enforces the per-tool scope gate with HTTP 403', async () => {
    const r = await post(callTool('get_airline_bookings'), token('invest:read'));
    expect(r.status).toBe(403);
    expect(r.wwwAuth).toMatch(/error="insufficient_scope"/);
    expect(r.wwwAuth).toMatch(/scope="airlines:read"/);
    expect(r.wwwAuth).toContain('resource_metadata=');
    expect(r.json.error.code).toBe(-32005);
    expect(r.json.error.data.requiredScopes).toEqual(['airlines:read']);
  });

  it('returns airlines rows from SQLite for a properly scoped token', async () => {
    const r = await post(callTool('get_airline_bookings'), token('airlines:read'));
    expect(r.status).toBe(200);
    const payload = JSON.parse(r.json.result.content[0].text);
    expect(payload.source).toBe('sqlite');
    expect(payload.bookings[0].confirmationNumber).toBe('K7XR2M');
  });

  it('filters tools/list by scope, same as the WebSocket path', async () => {
    const r = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, token('airlines:read'));
    const names = r.json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(['get_airline_bookings', 'get_flight_status', 'check_seat_availability']);
  });

  it('handles initialize without a token check, matching the WS handshake', async () => {
    const r = await post({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} }, token('airlines:read'));
    expect(r.json.result.protocolVersion).toBe('2025-11-25');
  });

  it('202s a notification, which produces no JSON-RPC response', async () => {
    const r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, token('airlines:read'));
    expect(r.status).toBe(202);
  });

  it('returns a parse error for malformed JSON rather than crashing', async () => {
    const r = await post('{not json', token('airlines:read'));
    expect(r.json.error.code).toBe(-32700);
  });

  // MCP Streamable HTTP transport: the server MAY assign a session id on
  // initialize; the gateway's own HTTP transport already does this
  // (GatewayServer.ts). This server had no Mcp-Session-Id handling at all —
  // flagged as a gap in the MCP spec-compliance audit.
  it('assigns an Mcp-Session-Id header on the initialize response', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token('airlines:read')}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });

  it('does not assign a session id on an ordinary tools/call response', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token('airlines:read')}` },
      body: JSON.stringify(callTool('get_airline_bookings')),
    });
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });
});
