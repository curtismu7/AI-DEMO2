'use strict';

/**
 * MCP 2026-07-28 on the gateway's upstream hops (GW_UPSTREAM_MODERN).
 *
 * Pure helpers first (axios mocked), then the three real hops — WS proxy, HTTP
 * proxy and the HTTP /mcp ingress — against a stub backend that logs exactly
 * what it receives, so "no initialize on the wire" is observed, not assumed.
 */

import http from 'http';
import type { AddressInfo } from 'net';
import { WebSocketServer } from 'ws';
import supertest from 'supertest';
import {
  upstreamSupportsModern,
  markUpstreamLegacy,
  resetUpstreamModernCache,
  isModernRejection,
  isModernCaller,
  toModernRequest,
  modernRoutingHeaders,
  stripModernDecoration,
  stripModernDecorationFromBody,
  wsToHttpBase,
} from '../src/upstreamModern';
import { proxyJsonRpc, proxyJsonRpcHttp } from '../src/proxy';
import { GatewayServer } from '../src/server/GatewayServer';
import type { GatewayConfig } from '../src/config';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
delete process.env.PINGONE_JWKS_ENDPOINT;
delete process.env.PINGONE_JWKS_URI;
process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';

const V = 'io.modelcontextprotocol/protocolVersion';
const CAPS = 'io.modelcontextprotocol/clientCapabilities';
const INFO = 'io.modelcontextprotocol/clientInfo';
const SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

// ---------------------------------------------------------------------------
// Stub backend: one port serving Streamable HTTP and WebSocket, logging every frame.
// ---------------------------------------------------------------------------

type Mode = 'modern' | 'legacy' | 'liar';
interface Seen { transport: 'http' | 'ws'; method?: string; headers?: http.IncomingHttpHeaders; params?: any }

let mode: Mode = 'modern';
let seen: Seen[] = [];
let server: http.Server;
let wss: WebSocketServer;
let base: string;

/** What the backend answers, shared by both transports. Returns undefined for a notification. */
function answer(msg: any): { status: number; body?: unknown; sessionHeader?: boolean } | undefined {
  const modernCall = msg.params?._meta?.[V] === '2026-07-28';
  if (msg.id === undefined) return undefined;
  if (msg.method === 'server/discover') {
    if (mode === 'legacy') return { status: 200, body: { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } } };
    return {
      status: 200,
      body: { jsonrpc: '2.0', id: msg.id, result: { resultType: 'complete', supportedVersions: ['2025-11-25', '2026-07-28'], ttlMs: 3_600_000, cacheScope: 'public', capabilities: {} } },
    };
  }
  if (msg.method === 'initialize') {
    return { status: 200, sessionHeader: true, body: { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-11-25', serverInfo: { name: 'stub', version: '1' } } } };
  }
  if (modernCall) {
    if (mode === 'liar') return { status: 400, body: { jsonrpc: '2.0', id: msg.id, error: { code: -32022, message: 'Unsupported protocol version' } } };
    return {
      status: 200,
      body: { jsonrpc: '2.0', id: msg.id, result: { resultType: 'complete', ttlMs: 60_000, cacheScope: 'private', tools: [], content: [{ type: 'text', text: 'ok' }], _meta: { [SERVER_INFO]: { name: 'stub', version: '1' } } } },
    };
  }
  return { status: 200, body: { jsonrpc: '2.0', id: msg.id, result: { tools: [], content: [{ type: 'text', text: 'ok' }] } } };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const msg = JSON.parse(raw);
      seen.push({ transport: 'http', method: msg.method, headers: req.headers, params: msg.params });
      const a = answer(msg);
      if (!a) { res.writeHead(202); res.end(); return; }
      res.writeHead(a.status, { 'Content-Type': 'application/json', ...(a.sessionHeader ? { 'mcp-session-id': 'sess-1' } : {}) });
      res.end(JSON.stringify(a.body));
    });
  });
  wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      seen.push({ transport: 'ws', method: msg.method, headers: req.headers, params: msg.params });
      const a = answer(msg);
      if (a) ws.send(JSON.stringify(a.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  mode = 'modern';
  seen = [];
  resetUpstreamModernCache();
  process.env.GW_UPSTREAM_MODERN = '1';
});

afterEach(() => {
  delete process.env.GW_UPSTREAM_MODERN;
});

const methods = (t?: 'http' | 'ws') => seen.filter((s) => !t || s.transport === t).map((s) => s.method);
const listReq = (id: number | string, params?: unknown) => ({ jsonrpc: '2.0' as const, id, method: 'tools/list', params });

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('helpers', () => {
  it('wsToHttpBase maps ws(s) to http(s) and trims slashes', () => {
    expect(wsToHttpBase('ws://h:8081')).toBe('http://h:8081');
    expect(wsToHttpBase('wss://h:8081/')).toBe('https://h:8081');
  });

  it('toModernRequest fills version, capabilities and clientInfo but keeps what the caller sent', () => {
    const out = toModernRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x', _meta: { progressToken: 't', [CAPS]: { elicitation: {} } } } });
    expect((out.params as any)._meta).toMatchObject({
      progressToken: 't',
      [V]: '2026-07-28',
      [CAPS]: { elicitation: {} },
      [INFO]: { name: 'banking-mcp-gateway' },
    });
    expect((out.params as any).name).toBe('x');
    expect((toModernRequest({ params: undefined }).params as any)._meta[CAPS]).toEqual({});
  });

  it('modernRoutingHeaders adds Mcp-Name only for tools/call', () => {
    expect(modernRoutingHeaders('tools/call', { name: 't' })).toEqual({ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 't' });
    expect(modernRoutingHeaders('tools/list', {})).toEqual({ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' });
  });

  it('isModernRejection accepts only pre-dispatch version/meta refusals', () => {
    expect(isModernRejection({ code: -32022 })).toBe(true);
    expect(isModernRejection({ code: -32020 })).toBe(true);
    expect(isModernRejection({ code: -32602, message: 'Invalid params: _meta["x"] is required' })).toBe(true);
    expect(isModernRejection({ code: -32602, message: 'Unknown prompt: x' })).toBe(false);
    expect(isModernRejection({ code: -32001, message: 'token' })).toBe(false);
    expect(isModernRejection(undefined)).toBe(false);
  });

  it('isModernCaller looks at params._meta only', () => {
    expect(isModernCaller({ _meta: { [V]: '2026-07-28' } })).toBe(true);
    expect(isModernCaller({ _meta: { [V]: '2025-11-25' } })).toBe(false);
    expect(isModernCaller(undefined)).toBe(false);
  });

  it('stripModernDecoration removes only Modern-only result fields', () => {
    const out: any = stripModernDecoration({
      jsonrpc: '2.0', id: 1,
      result: { resultType: 'complete', ttlMs: 5, cacheScope: 'private', tools: [1], _meta: { [SERVER_INFO]: {}, keep: 1 } },
    });
    expect(out.result).toEqual({ tools: [1], _meta: { keep: 1 } });
    const bare: any = stripModernDecoration({ jsonrpc: '2.0', id: 1, result: { resultType: 'complete', _meta: { [SERVER_INFO]: {} } } });
    expect(bare.result).toEqual({});
    const err = { jsonrpc: '2.0', id: 1, error: { code: 1, message: 'x' } };
    expect(stripModernDecoration(err)).toBe(err);
  });

  it('stripModernDecorationFromBody leaves non-JSON bodies alone', () => {
    const sse = Buffer.from('data: {"result":{"resultType":"complete"}}\n\n');
    expect(stripModernDecorationFromBody(sse, 'text/event-stream')).toBe(sse);
    const json = stripModernDecorationFromBody(Buffer.from('{"result":{"resultType":"complete","a":1}}'), 'application/json');
    expect(JSON.parse(json.toString())).toEqual({ result: { a: 1 } });
  });
});

// ---------------------------------------------------------------------------
// Capability probe
// ---------------------------------------------------------------------------

describe('upstreamSupportsModern', () => {
  it('learns Modern from server/discover, caches it, and probes once', async () => {
    expect(await upstreamSupportsModern(base, 'tok')).toBe(true);
    expect(await upstreamSupportsModern(base, 'tok')).toBe(true);
    expect(methods('http')).toEqual(['server/discover']);
  });

  it('treats a backend without server/discover as Legacy and remembers that', async () => {
    mode = 'legacy';
    expect(await upstreamSupportsModern(base, 'tok')).toBe(false);
    expect(await upstreamSupportsModern(base, 'tok')).toBe(false);
    expect(methods('http')).toEqual(['server/discover']);
  });

  it('shares one probe between concurrent callers', async () => {
    await Promise.all([upstreamSupportsModern(base, 't'), upstreamSupportsModern(base, 't'), upstreamSupportsModern(base, 't')]);
    expect(methods('http')).toEqual(['server/discover']);
  });

  it('does not cache an unreachable backend, so it is noticed when it comes up', async () => {
    expect(await upstreamSupportsModern('http://127.0.0.1:1', 'tok')).toBe(false);
    expect(await upstreamSupportsModern(base, 'tok')).toBe(true);
  });

  it('markUpstreamLegacy overrides a positive answer', async () => {
    await upstreamSupportsModern(base, 'tok');
    markUpstreamLegacy(base);
    expect(await upstreamSupportsModern(base, 'tok')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTTP proxy hop (proxyJsonRpcHttp)
// ---------------------------------------------------------------------------

describe('proxyJsonRpcHttp', () => {
  it('flag off: handshake exactly as before and no probe', async () => {
    delete process.env.GW_UPSTREAM_MODERN;
    const r = await proxyJsonRpcHttp(base, 'tok', listReq(1));
    expect(methods()).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    expect(r.result).toEqual({ tools: [], content: [{ type: 'text', text: 'ok' }] });
  });

  it('Modern backend: no initialize on the wire, routing headers and _meta sent, Legacy-shaped reply', async () => {
    const r = await proxyJsonRpcHttp(base, 'tok', listReq(1));
    expect(methods()).toEqual(['server/discover', 'tools/list']);
    const call = seen[1];
    expect(call.headers!['mcp-method']).toBe('tools/list');
    expect(call.headers!['mcp-protocol-version']).toBe('2026-07-28');
    expect(call.headers!['mcp-session-id']).toBeUndefined();
    expect(call.params._meta).toMatchObject({ [V]: '2026-07-28', [CAPS]: {} });
    // A Legacy caller must not see Modern-only decoration.
    expect(r.result).toEqual({ tools: [], content: [{ type: 'text', text: 'ok' }] });
  });

  it('Modern caller keeps the Modern result decoration', async () => {
    const r = await proxyJsonRpcHttp(base, 'tok', listReq(1, { _meta: { [V]: '2026-07-28', [CAPS]: {} } }));
    expect((r.result as any).resultType).toBe('complete');
    expect((r.result as any).ttlMs).toBe(60_000);
  });

  it('Legacy backend: falls back to the handshake', async () => {
    mode = 'legacy';
    await proxyJsonRpcHttp(base, 'tok', listReq(1));
    expect(methods()).toEqual(['server/discover', 'initialize', 'notifications/initialized', 'tools/list']);
  });

  it('a backend that advertised Modern but refuses it is retried over the handshake and remembered as Legacy', async () => {
    mode = 'liar';
    // 'liar' answers discover as Modern, then refuses the Modern call with -32022 / 400.
    const r = await proxyJsonRpcHttp(base, 'tok', listReq(1));
    expect(methods()).toEqual(['server/discover', 'tools/list', 'initialize', 'notifications/initialized', 'tools/list']);
    expect(r.result).toEqual({ tools: [], content: [{ type: 'text', text: 'ok' }] });
    seen = [];
    await proxyJsonRpcHttp(base, 'tok', listReq(2));
    expect(methods()).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
  });

  it('a non-version error from a Modern backend is the answer, not a reason to retry', async () => {
    const errServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const m = JSON.parse(raw);
        seen.push({ transport: 'http', method: m.method });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(m.method === 'server/discover'
          ? { jsonrpc: '2.0', id: m.id, result: { supportedVersions: ['2026-07-28'], ttlMs: 1000 } }
          : { jsonrpc: '2.0', id: m.id, error: { code: -32005, message: 'Insufficient scope' } }));
      });
    });
    await new Promise<void>((r) => errServer.listen(0, '127.0.0.1', r));
    const u = `http://127.0.0.1:${(errServer.address() as AddressInfo).port}`;
    const r = await proxyJsonRpcHttp(u, 'tok', listReq(1));
    await new Promise<void>((res) => errServer.close(() => res()));
    expect(r.error?.code).toBe(-32005);
    expect(methods()).toEqual(['server/discover', 'tools/list']);
  });
});

// ---------------------------------------------------------------------------
// WebSocket proxy hop (proxyJsonRpc)
// ---------------------------------------------------------------------------

describe('proxyJsonRpc (WebSocket)', () => {
  const wsUrl = () => base.replace('http://', 'ws://');

  it('flag off: handshake over the socket, no probe', async () => {
    delete process.env.GW_UPSTREAM_MODERN;
    await proxyJsonRpc(wsUrl(), 'tok', listReq(7));
    expect(methods('ws')).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    expect(methods('http')).toEqual([]);
  });

  it('Modern backend: probes over HTTP, then sends only the request over the socket', async () => {
    const r = await proxyJsonRpc(wsUrl(), 'tok', listReq(7));
    expect(methods('http')).toEqual(['server/discover']);
    expect(methods('ws')).toEqual(['tools/list']);
    expect(seen.find((s) => s.transport === 'ws')!.params._meta).toMatchObject({ [V]: '2026-07-28' });
    expect(r.result).toEqual({ tools: [], content: [{ type: 'text', text: 'ok' }] });
  });

  it('backend that refuses the Modern frame is retried with the handshake', async () => {
    mode = 'liar';
    const r = await proxyJsonRpc(wsUrl(), 'tok', listReq(8));
    expect(methods('ws')).toEqual(['tools/list', 'initialize', 'notifications/initialized', 'tools/list']);
    expect(r.result).toEqual({ tools: [], content: [{ type: 'text', text: 'ok' }] });
  });
});

// ---------------------------------------------------------------------------
// HTTP /mcp ingress (GatewayServer.forwardToUpstream)
// ---------------------------------------------------------------------------

const AUD = 'https://mcp-gateway.example.com';
const stubConfig = {
  port: 0, host: '127.0.0.1', clientId: 'c', clientSecret: 's', tokenEndpointAuthMethod: 'basic',
  tokenEndpoint: 'https://auth.example.com/token', gatewayResourceUri: AUD,
  mcpOlbWsUrl: 'ws://localhost:8080', mcpResourceServerWsUrl: 'ws://localhost:8081',
  mcpResourceServerHttpUrl: 'http://localhost:8081', mcpResourceServerApiKey: '',
  mcpOlbResourceUri: 'https://mcp-olb.example.com', mcpResourceServerResourceUri: 'https://mcp-resource-server.example.com',
  pingAuthorizeEndpoint: '', pingAuthorizeWorkerId: '', p1azEnabled: false, hitlServiceUrl: '',
  introspectionEndpoint: '', introspectionClientId: '', introspectionClientSecret: '', devBypass: false,
  demoApiKeyServiceKey: 'k', apiResourceServerBaseUrl: 'http://localhost:8082', apiResourceServerApiKey: 'k',
  bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token', bffInternalSecret: 'dev-shared-secret-change-me',
  bankingResourceServerBaseUrl: 'http://localhost:3001', bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
  mcpServerPassthrough: false, mtlsEnabled: false, mtlsCertPath: '/tmp/gw-client.crt', authorizedActorClientId: '',
  mcpJwtVerifierHttpUrl: 'http://localhost:8083', mcpJwtVerifierResourceUri: 'mcp-jwt-verifier.ping.demo',
  mcpWeatherHttpUrl: 'http://localhost:8896', mcpBraveHttpUrl: 'http://localhost:8897', bffWeatherFlagUrl: '', bffBraveFlagUrl: '',
  allowLocalScopeFallback: false, introspectionEnabled: false, introspectionProvider: 'pinggateway',
  requireActForAgentTools: false, intentTokenRequired: false, requireRarIntent: false, rateLimitEnabled: false,
  wbaMode: 'monitor', rateLimitMaxRequests: 20, rateLimitWindowMs: 60000, introspectionSimDown: false, jwksSimDown: false,
} as unknown as GatewayConfig;

function token(): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: 'user-123', aud: AUD, exp: Math.floor(Date.now() / 1000) + 3600, iss: 'https://auth.example.com' })).toString('base64url');
  return `${h}.${p}.${Buffer.from('fakesig').toString('base64url')}`;
}

describe('HTTP /mcp ingress -> upstream', () => {
  const call = (body: unknown, extra: Record<string, string> = {}) => {
    const gw = new GatewayServer({ config: stubConfig, upstreamMcpUrl: base });
    let r = supertest(gw.httpServer).post('/mcp')
      .set('Authorization', `Bearer ${token()}`)
      .set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(extra)) r = r.set(k, v);
    return r.send(JSON.stringify(body));
  };
  const toolCall = (params: Record<string, unknown> = {}) =>
    ({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'get_my_accounts', arguments: {}, ...params } });

  it('flag off: initialize + initialized precede the call, no probe', async () => {
    delete process.env.GW_UPSTREAM_MODERN;
    const res = await call(toolCall());
    expect(res.status).toBe(200);
    expect(methods()).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
  });

  it('Modern backend: no handshake, routing headers + _meta, and a Legacy caller gets a Legacy reply', async () => {
    const res = await call(toolCall());
    expect(res.status).toBe(200);
    expect(methods()).toEqual(['server/discover', 'tools/call']);
    const upstream = seen[1];
    expect(upstream.headers!['mcp-method']).toBe('tools/call');
    expect(upstream.headers!['mcp-name']).toBe('get_my_accounts');
    expect(upstream.headers!['mcp-session-id']).toBeUndefined();
    expect(upstream.params._meta[V]).toBe('2026-07-28');
    expect(res.body.result.resultType).toBeUndefined();
    expect(res.body.result.ttlMs).toBeUndefined();
    expect(res.headers['x-gw-mcp-handshake']).toBeUndefined();
  });

  it('Modern caller through a Modern backend keeps resultType and cache hints', async () => {
    const res = await call(
      toolCall({ _meta: { [V]: '2026-07-28', [CAPS]: {} } }),
      { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'get_my_accounts' },
    );
    expect(res.status).toBe(200);
    expect(methods()).toEqual(['server/discover', 'tools/call']);
    expect(res.body.result.resultType).toBe('complete');
    expect(res.body.result.ttlMs).toBe(60_000);
  });

  it('a caller that brings its own session id stays on the Legacy path', async () => {
    const res = await call(toolCall(), { 'Mcp-Session-Id': 'caller-session' });
    expect(res.status).toBe(200);
    expect(methods()).toEqual(['tools/call']);
    expect(seen[0].headers!['mcp-session-id']).toBe('caller-session');
  });

  it('Legacy backend: handshake as before after a single probe', async () => {
    mode = 'legacy';
    const res = await call(toolCall());
    expect(res.status).toBe(200);
    expect(methods()).toEqual(['server/discover', 'initialize', 'notifications/initialized', 'tools/call']);
    expect(res.headers['x-gw-mcp-handshake']).toBeDefined();
  });

  it('a backend that refuses the Modern call is retried over the handshake', async () => {
    mode = 'liar';
    const res = await call(toolCall());
    expect(res.status).toBe(200);
    expect(methods()).toEqual(['server/discover', 'tools/call', 'initialize', 'notifications/initialized', 'tools/call']);
    expect(res.body.result.content[0].text).toBe('ok');
  });
});
