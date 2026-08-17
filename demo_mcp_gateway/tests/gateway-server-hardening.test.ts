'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * Regression tests for two GatewayServer HTTP-surface hardening fixes:
 *
 *  BUGS.md #70 — the in-flight cancellation registry was process-global and
 *  keyed only by the JSON-RPC id (a per-client small int), so one HTTP
 *  caller's notifications/cancelled {requestId:N} aborted a DIFFERENT caller's
 *  in-flight call sharing id N. The key is now scoped per authenticated caller.
 *
 *  BUGS.md #72 — readBody concatenated request chunks with no size cap, so an
 *  authenticated caller could stream an arbitrarily large body into memory.
 *  Bodies over HTTP_MAX_BODY_BYTES are now rejected 413.
 */

import supertest from 'supertest';
import type { GatewayConfig } from '../src/config';

jest.mock('../src/proxy', () => ({
  proxyJsonRpc: jest.fn(),
  MCP_PROTOCOL_VERSION: '2025-11-25',
}));

import { proxyJsonRpc } from '../src/proxy';
import { GatewayServer } from '../src/server/GatewayServer';

const mockedProxyJsonRpc = proxyJsonRpc as jest.Mock;

delete process.env.PINGONE_JWKS_ENDPOINT;
delete process.env.PINGONE_JWKS_URI;
process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';

const GATEWAY_AUDIENCE = 'https://mcp-gateway.example.com';

const stubConfig: GatewayConfig = {
  port: 0,
  host: '127.0.0.1',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tokenEndpointAuthMethod: 'basic',
  tokenEndpoint: 'https://auth.example.com/token',
  gatewayResourceUri: GATEWAY_AUDIENCE,
  mcpOlbWsUrl: 'ws://localhost:8080',
  mcpResourceServerWsUrl: 'ws://localhost:8081',
  mcpResourceServerHttpUrl: 'http://localhost:8081',
  mcpResourceServerApiKey: '',
  mcpOlbResourceUri: 'https://mcp-olb.example.com',
  mcpResourceServerResourceUri: 'https://mcp-resource-server.example.com',
  pingAuthorizeEndpoint: '',
  pingAuthorizeWorkerId: '',
  p1azEnabled: false,
  hitlServiceUrl: '',
  introspectionEndpoint: '',
  introspectionClientId: '',
  introspectionClientSecret: '',
  devBypass: false,
  demoApiKeyServiceKey: 'demo-api-key-0000',
  apiResourceServerBaseUrl: 'http://localhost:8082',
  apiResourceServerApiKey: 'demo-mortgage-key-0000',
  bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
  bffInternalSecret: 'dev-shared-secret-change-me',
  bankingResourceServerBaseUrl: 'http://localhost:3001',
  bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
  mcpServerPassthrough: false,
  mtlsEnabled: false,
  mtlsCertPath: '/tmp/gw-client.crt',
  authorizedActorClientId: '',
  mcpJwtVerifierHttpUrl: 'http://localhost:8083',
  mcpJwtVerifierResourceUri: 'mcp-jwt-verifier.ping.demo',
  mcpWeatherHttpUrl: 'http://localhost:8896',
  mcpBraveHttpUrl: 'http://localhost:8897',
  bffWeatherFlagUrl: '',
  bffBraveFlagUrl: '',
  allowLocalScopeFallback: false,
  introspectionEnabled: false,
  introspectionProvider: 'pinggateway',
  requireActForAgentTools: false,
  intentTokenRequired: false,
  requireRarIntent: false,
  rateLimitEnabled: false,
  wbaMode: 'monitor',
  rateLimitMaxRequests: 20,
  rateLimitWindowMs: 60000,
  introspectionSimDown: false,
} as unknown as GatewayConfig;

// Distinct `sub` → distinct token string → distinct per-caller scope, which is
// exactly the cross-caller condition #70 is about.
function makeToken(sub: string, aud: string | string[] = GATEWAY_AUDIENCE): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(
    JSON.stringify({ sub, aud, exp, iss: 'https://auth.example.com' }),
  ).toString('base64url');
  const sig = Buffer.from('fakesig').toString('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('GatewayServer HTTP hardening', () => {
  let gateway: GatewayServer;
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    mockedProxyJsonRpc.mockReset();
    gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
    });
    request = supertest(gateway.httpServer);
  });

  // --- #70: per-caller cancellation scope ------------------------------------
  it("does NOT abort caller A's in-flight id when a DIFFERENT caller cancels the same id", async () => {
    let capturedSignal: AbortSignal | undefined;
    mockedProxyJsonRpc.mockImplementation((_url, _token, _req, _x, _tls, _onProgress, signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('Cancelled'), { code: 'cancelled' }));
        });
      });
    });

    const tokenA = makeToken('caller-A');
    const tokenB = makeToken('caller-B');

    // Caller A starts a resource-server-routed call registered under id 1.
    const callPromise = request
      .post('/mcp')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} }));
    callPromise.then(() => {}, () => {});

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedSignal).toBeDefined();

    // Caller B cancels id 1 — must NOT touch caller A's call.
    const crossCancel = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${tokenB}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }));

    expect(crossCancel.status).toBe(202);
    await new Promise((r) => setTimeout(r, 10));
    expect(capturedSignal?.aborted).toBe(false);

    // Same caller cancelling the same id STILL aborts (legitimate path intact).
    const selfCancel = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }));

    expect(selfCancel.status).toBe(202);
    await callPromise;
    expect(capturedSignal?.aborted).toBe(true);
  });

  // --- #72: request body size cap --------------------------------------------
  it('rejects an over-limit POST /mcp body with 413 instead of buffering it unbounded', async () => {
    // Default cap is 1 MB; send just over it. The body is valid JSON-RPC so the
    // rejection is provably the size cap, not a parse/validation error.
    const filler = 'x'.repeat(1024 * 1024 + 1024);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'noop', filler } });

    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken('caller-A')}`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(413);
    expect(JSON.parse(res.text).error).toBe('payload_too_large');
    // The upstream proxy must never have been reached for an over-cap body.
    expect(mockedProxyJsonRpc).not.toHaveBeenCalled();
  });

  it('still accepts a normal-size POST /mcp body (cap does not affect legitimate traffic)', async () => {
    mockedProxyJsonRpc.mockResolvedValue({ jsonrpc: '2.0', id: 10, result: { resources: [] } });

    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken('caller-A')}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'resources/list', params: {} }));

    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ jsonrpc: '2.0', id: 10, result: { resources: [] } });
  });
});
