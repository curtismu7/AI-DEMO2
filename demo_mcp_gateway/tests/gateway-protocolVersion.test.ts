'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * MCP spec-compliance audit: no code path validated an inbound
 * MCP-Protocol-Version header against what the gateway actually supports —
 * a client requesting an unsupported revision got silently forwarded as if
 * everything matched. Streamable HTTP transport: once a session is
 * established, the client SHOULD send this header on every request, and the
 * server SHOULD reject an unsupported value with 400.
 *
 * `initialize` is exempt — that's the request where negotiation happens in
 * the first place, before any version has been agreed.
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

describe('POST /mcp — MCP-Protocol-Version validation', () => {
  let gateway: GatewayServer;
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
    });
    request = supertest(gateway.httpServer);
  });

  const toolsListBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  const initializeBody = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-01-01', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
  });

  it('rejects an unsupported version on a non-initialize request with 400', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('MCP-Protocol-Version', '2024-01-01')
      .set('Content-Type', 'application/json')
      .send(toolsListBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_protocol_version');
  });

  it('does not reject initialize for proposing an unsupported version — that is what negotiation is for', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('MCP-Protocol-Version', '2024-01-01')
      .set('Content-Type', 'application/json')
      .send(initializeBody);

    // Auth + version-gate both passed — reaches the upstream (which is down) => 502, not 400.
    expect(res.status).toBe(502);
  });

  it('still passes through when the header is absent (backward compat)', async () => {
    const res = await request
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send(toolsListBody);

    expect(res.status).toBe(502);
  });
});
