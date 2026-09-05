'use strict';

// Dev TLS certs exist on disk, so GatewayServer creates an HTTPS server.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * TECH_DEBT.md "gateway tools/list is only governed on the WebSocket
 * transport" — the HTTP transport (GatewayServer.ts) used to relay the
 * upstream tools/list body verbatim, with no per-tool scope filtering. These
 * tests prove a caller holding a scope-narrowed token (read, not audit:read)
 * gets the audit tool dropped from tools/list over HTTP, matching what the
 * WS transport (index.ts) already does via the same guardToolsList gate.
 */

import axios from 'axios';
import http from 'http';
import supertest from 'supertest';
import { GatewayServer } from '../src/server/GatewayServer';
import type { GatewayConfig } from '../src/config';

delete process.env.PINGONE_JWKS_ENDPOINT;
delete process.env.PINGONE_JWKS_URI;
process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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
  // Local-fallback scope engine, not a real PDP round trip: guardToolsList's
  // per-tool filtering (evaluateScopeDecisionLocally) is what's under test
  // here, not PingAuthorize connectivity.
  p1azEnabled: false,
  allowLocalScopeFallback: true,
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
  enterpriseManagedMcpAuth: false,
} as GatewayConfig;

// Same shape as gateway-server.test.ts's makeToken — jwt.decode()-only, no
// real signature (MCP_GW_ALLOW_UNVERIFIED_TOKENS bypasses verification).
function makeToken(scope: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-123',
    aud: GATEWAY_AUDIENCE,
    scope,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://auth.example.com',
  })).toString('base64url');
  const sig = Buffer.from('fakesig').toString('base64url');
  return `${header}.${payload}.${sig}`;
}

const TOOLS_LIST_RESULT = {
  tools: [
    { name: 'get_my_accounts', description: 'List accounts' },
    { name: 'search_audit_activities', description: 'Search the audit trail' },
  ],
};

function mockUpstreamToolsListResponse(): void {
  mockedAxios.post.mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'application/json' },
    data: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: TOOLS_LIST_RESULT })),
  } as never);
}

describe('GatewayServer HTTP tools/list governance', () => {
  let gateway: GatewayServer;
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    mockedAxios.post.mockReset();
    gateway = new GatewayServer({ config: stubConfig, upstreamMcpUrl: 'http://127.0.0.1:19999' });
    request = supertest(gateway.httpServer);
  });

  it('drops a tool the caller\'s scope does not cover (audit:read missing)', async () => {
    mockUpstreamToolsListResponse();
    const token = makeToken('read mcp:invoke');

    const res = await request
      .post('/mcp')
      // Supplying a session id skips the upstream initialize handshake, so
      // exactly one axios.post call (the real tools/list forward) happens.
      .set('Mcp-Session-Id', 'test-session')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));

    expect(res.status).toBe(200);
    const names = res.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('get_my_accounts');
    expect(names).not.toContain('search_audit_activities');
  });

  it('keeps every tool the caller\'s scope already covers (audit:read present)', async () => {
    mockUpstreamToolsListResponse();
    const token = makeToken('read audit:read mcp:invoke');

    const res = await request
      .post('/mcp')
      .set('Mcp-Session-Id', 'test-session')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));

    expect(res.status).toBe(200);
    const names = res.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(['get_my_accounts', 'search_audit_activities']);
  });

  it('does not touch a tools/call response (only tools/list is governed)', async () => {
    // Shaped like a tools/list result on purpose — proves the filter keys off
    // the JSON-RPC method, not off "any body with a tools array".
    mockedAxios.post.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: TOOLS_LIST_RESULT })),
    } as never);
    const token = makeToken('read mcp:invoke');

    const res = await request
      .post('/mcp')
      .set('Mcp-Session-Id', 'test-session')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'get_my_accounts', arguments: {} },
      }));

    expect(res.status).toBe(200);
    const names = res.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(['get_my_accounts', 'search_audit_activities']);
  });
});
