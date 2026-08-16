'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * MCP spec 2026-07-28: server/discover. Servers MUST implement it. Answered
 * locally by the gateway (not forwarded upstream) — it exists so a client
 * can learn about the server it is directly connected to, and the gateway
 * is a real MCP server in its own right, not a transparent pipe. Mirrors
 * how the WS transport (index.ts) already answers `initialize` locally with
 * the gateway's own identity, rather than the HTTP transport's existing
 * forward-to-upstream behavior for `initialize`.
 */

import supertest from 'supertest';
import { GatewayServer } from '../src/server/GatewayServer';
import type { GatewayConfig } from '../src/config';

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

describe('POST /mcp — server/discover', () => {
  let gateway: GatewayServer;
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
    });
    request = supertest(gateway.httpServer);
  });

  it('answers locally with resultType complete, supportedVersions, capabilities, and serverInfo — no upstream call', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} }));

    // Upstream at 127.0.0.1:19999 is unreachable — a 502 here would mean this
    // request was forwarded instead of answered locally.
    expect(res.status).toBe(200);
    expect(res.body.result.resultType).toBe('complete');
    expect(res.body.result.supportedVersions).toEqual(['2025-11-25']);
    expect(res.body.result.capabilities).toMatchObject({ tools: {} });
    expect(res.body.result._meta['io.modelcontextprotocol/serverInfo']).toMatchObject({ name: expect.any(String) });
  });

  it('still answers when the discover call itself carries Modern _meta — discovery must work regardless of what the caller claims', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'server/discover',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
      }));
    expect(res.status).toBe(200);
    expect(res.body.result.resultType).toBe('complete');
  });
});

describe('POST /mcp — Modern per-request version negotiation (_meta)', () => {
  let gateway: GatewayServer;
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
    });
    request = supertest(gateway.httpServer);
  });

  it('rejects a request carrying an unsupported Modern _meta.protocolVersion with -32022, listing what is actually supported', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        jsonrpc: '2.0', id: 9, method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
      }));

    // MCP spec 2026-07-28 Streamable HTTP §Protocol Version Header: "If the
    // server does not implement the requested protocol version... it MUST
    // respond with 400 Bad Request and an UnsupportedProtocolVersionError."
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: -32022,
      message: 'Unsupported protocol version',
      data: { supported: ['2025-11-25'], requested: '2026-07-28' },
    });
  });

  it('does not touch an ordinary Legacy request with no _meta.protocolVersion — falls through to normal forwarding', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} }));

    // Upstream at 127.0.0.1:19999 is unreachable — 502 proves this request
    // was NOT rejected at the version gate and instead reached forwarding,
    // exactly like before this change.
    expect(res.status).toBe(502);
  });
});
