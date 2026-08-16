'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * MCP spec 2026-07-28 Streamable HTTP §Request Metadata: Modern requests
 * mirror selected JSON-RPC body fields into HTTP headers (Mcp-Method on
 * every request; Mcp-Name on tools/call, resources/read, prompts/get) so
 * intermediaries can route/inspect without parsing the body. Servers MUST
 * validate the header matches the body and reject with -32020
 * (HeaderMismatch) + HTTP 400 on any mismatch or missing required header.
 *
 * Scoped to Modern requests only — this repo's Legacy (2025-11-25) traffic
 * never had this header requirement and is untouched.
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

const MODERN_META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };

describe('POST /mcp — Modern header-based routing (Mcp-Method / Mcp-Name)', () => {
  let gateway: GatewayServer;
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
    });
    request = supertest(gateway.httpServer);
  });

  it('rejects a Modern tools/call missing Mcp-Method with -32020 HeaderMismatch and HTTP 400', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'get_my_accounts', arguments: {}, _meta: MODERN_META },
      }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: -32020 });
  });

  it('rejects a Modern tools/call where Mcp-Method does not match the body method', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .set('Mcp-Method', 'tools/list')
      .set('Mcp-Name', 'get_my_accounts')
      .send(JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'get_my_accounts', arguments: {}, _meta: MODERN_META },
      }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: -32020 });
  });

  it('rejects a Modern tools/call missing Mcp-Name', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .set('Mcp-Method', 'tools/call')
      .send(JSON.stringify({
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'get_my_accounts', arguments: {}, _meta: MODERN_META },
      }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: -32020 });
  });

  it('rejects a Modern tools/call where Mcp-Name does not match params.name', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .set('Mcp-Method', 'tools/call')
      .set('Mcp-Name', 'create_transfer')
      .send(JSON.stringify({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'get_my_accounts', arguments: {}, _meta: MODERN_META },
      }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: -32020 });
  });

  it('accepts a Modern tools/call with matching Mcp-Method + Mcp-Name and proceeds to the normal pipeline', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .set('Mcp-Method', 'tools/call')
      .set('Mcp-Name', 'get_my_accounts')
      .send(JSON.stringify({
        jsonrpc: '2.0', id: 5, method: 'tools/call',
        params: { name: 'get_my_accounts', arguments: {}, _meta: MODERN_META },
      }));
    // Not a HeaderMismatch — reaches the normal (unreachable-upstream) path.
    expect(res.status).not.toBe(400);
  });

  it('does not require Mcp-Method/Mcp-Name on a Modern non-tools/call request (e.g. server/discover)', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        jsonrpc: '2.0', id: 6, method: 'server/discover',
        params: { _meta: MODERN_META },
      }));
    expect(res.status).toBe(200);
  });

  it('does not require these headers on an ordinary Legacy request', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        jsonrpc: '2.0', id: 7, method: 'tools/call',
        params: { name: 'get_my_accounts', arguments: {} },
      }));
    expect(res.status).not.toBe(400);
  });
});
