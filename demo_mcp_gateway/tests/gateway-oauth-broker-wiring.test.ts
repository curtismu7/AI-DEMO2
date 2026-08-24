import supertest from 'supertest';
import { GatewayServer } from '../src/server/GatewayServer';
import type { GatewayConfig } from '../src/config';

delete process.env.PINGONE_JWKS_ENDPOINT;
delete process.env.PINGONE_JWKS_URI;
process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
process.env.PINGONE_ENVIRONMENT_ID = '01d89b06-66d5-430e-9f28-65636843788b';
process.env.PINGONE_REGION = 'com';

// Comma-list on purpose: docker-compose sets MCP_GW_RESOURCE_URI to several
// accepted audiences (tokenValidator splits on ','). The broker must never
// hand that raw string to a client or to PingOne.
const GATEWAY_AUDIENCE = 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp';

// Copy the stubConfig shape from gateway-server-discover.test.ts — see that
// file for the full field list this repo's GatewayConfig requires.
const stubConfig: GatewayConfig = {
  port: 0, host: '127.0.0.1', clientId: 'test-client-id', clientSecret: 'test-client-secret',
  tokenEndpointAuthMethod: 'basic', tokenEndpoint: 'https://auth.example.com/token',
  gatewayResourceUri: GATEWAY_AUDIENCE, mcpOlbWsUrl: 'ws://localhost:8080',
  mcpResourceServerWsUrl: 'ws://localhost:8081', mcpResourceServerHttpUrl: 'http://localhost:8081',
  mcpResourceServerApiKey: '', mcpOlbResourceUri: 'https://mcp-olb.example.com',
  mcpResourceServerResourceUri: 'https://mcp-resource-server.example.com',
  pingAuthorizeEndpoint: '', pingAuthorizeWorkerId: '', p1azEnabled: false,
  hitlServiceUrl: '', introspectionEndpoint: '', introspectionClientId: '',
  introspectionClientSecret: '', devBypass: false, demoApiKeyServiceKey: 'demo-api-key-0000',
  apiResourceServerBaseUrl: 'http://localhost:8082', apiResourceServerApiKey: 'demo-mortgage-key-0000',
  bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
} as GatewayConfig;

describe('GatewayServer OAuth broker wiring', () => {
  it('GET /.well-known/oauth-authorization-server is served by the gateway', async () => {
    const server = new GatewayServer({ config: stubConfig, upstreamMcpUrl: 'ws://localhost:9' });
    const res = await supertest(server.httpServer).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.registration_endpoint).toMatch(/\/oauth\/register$/);
  });

  it('POST /oauth/register is served by the gateway', async () => {
    const server = new GatewayServer({ config: stubConfig, upstreamMcpUrl: 'ws://localhost:9' });
    const res = await supertest(server.httpServer)
      .post('/oauth/register')
      .send({ client_name: 'LM Studio', redirect_uris: ['http://127.0.0.1:1/callback'] });
    expect(res.status).toBe(201);
  });

  it('the existing RFC 9728 protected-resource metadata points authorization_servers at THIS gateway\'s reachable base URL, not the audience string', async () => {
    const server = new GatewayServer({ config: stubConfig, upstreamMcpUrl: 'ws://localhost:9' });
    const res = await supertest(server.httpServer).get('/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    // supertest addresses the server as http://127.0.0.1:<port>; that is what
    // an external client can actually GET .well-known/oauth-authorization-server from.
    expect(res.body.authorization_servers).toEqual([expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/)]);
  });

  it('/oauth/authorize sends PingOne only the FIRST audience of a comma-list MCP_GW_RESOURCE_URI as `resource`', async () => {
    process.env.GATEWAY_OAUTH_BROKER_PINGONE_CLIENT_ID = 'c8392dc4-2d82-4e49-92a8-79a78401faf5';
    const server = new GatewayServer({ config: stubConfig, upstreamMcpUrl: 'ws://localhost:9' });
    const reg = await supertest(server.httpServer)
      .post('/oauth/register')
      .send({ client_name: 'LM Studio', redirect_uris: ['http://127.0.0.1:1/callback'] });
    const res = await supertest(server.httpServer).get('/oauth/authorize').query({
      client_id: reg.body.client_id, redirect_uri: 'http://127.0.0.1:1/callback',
      response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256',
    });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).searchParams.get('resource')).toBe('mcpgateway.ping.demo');
  });
});
