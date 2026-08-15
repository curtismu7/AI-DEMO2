'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * MCP spec-compliance audit: the HTTP (Streamable HTTP) transport had no
 * equivalent of the WS transport's Progress/Cancellation support — a client
 * sending params._meta.progressToken on an invest/resource-server-routed
 * call got a plain JSON response with interim notifications/progress frames
 * silently dropped (proxyJsonRpc's onProgress callback was never wired up
 * on this code path), and notifications/cancelled fell through to the
 * default upstream forward (which doesn't understand it) instead of
 * aborting the matching in-flight call.
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

function makeToken(aud: string | string[]): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(
    JSON.stringify({ sub: 'user-123', aud, exp, iss: 'https://auth.example.com' }),
  ).toString('base64url');
  const sig = Buffer.from('fakesig').toString('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('POST /mcp — HTTP transport Progress + Cancellation (invest/resource-server routed calls)', () => {
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

  it('upgrades to SSE and streams an interim notifications/progress frame before the final result when params._meta.progressToken is present', async () => {
    mockedProxyJsonRpc.mockImplementation(async (_url, _token, _req, _x, _tls, onProgress) => {
      onProgress?.({ progress: 1, total: 2 });
      return { jsonrpc: '2.0', id: 7, result: { resources: [] } };
    });

    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        jsonrpc: '2.0', id: 7, method: 'resources/list', params: { _meta: { progressToken: 'tok-1' } },
      }));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const frames = res.text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
    expect(frames).toEqual([
      { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1, total: 2 } },
      { jsonrpc: '2.0', id: 7, result: { resources: [] } },
    ]);
  });

  it('does not upgrade to SSE when no progressToken is given (existing plain-JSON behavior unchanged)', async () => {
    mockedProxyJsonRpc.mockResolvedValue({ jsonrpc: '2.0', id: 8, result: { resources: [] } });

    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'resources/list', params: {} }));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(res.text)).toEqual({ jsonrpc: '2.0', id: 8, result: { resources: [] } });
  });

  it('aborts the matching in-flight call when notifications/cancelled arrives for its requestId', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockedProxyJsonRpc.mockImplementation((_url, _token, _req, _x, _tls, _onProgress, signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('Cancelled'), { code: 'cancelled' }));
        });
      });
    });

    const callPromise = request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'resources/list', params: {} }));
    // supertest/superagent requests are thenable but lazy — the underlying
    // HTTP call fires on the first .then()/await, not on construction.
    // Kick it off now without awaiting so it's in flight before the
    // cancellation request below.
    callPromise.then(() => {}, () => {});

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedSignal).toBeDefined();

    const cancelRes = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 42 } }));

    expect(cancelRes.status).toBe(202);
    await callPromise;
    expect(capturedSignal?.aborted).toBe(true);
  });
});
