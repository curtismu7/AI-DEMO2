import supertest from 'supertest';
import { GatewayServer } from '../src/server/GatewayServer';
import type { GatewayConfig } from '../src/config';

delete process.env.PINGONE_JWKS_ENDPOINT;
delete process.env.PINGONE_JWKS_URI;
process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
process.env.PINGONE_ENVIRONMENT_ID = '01d89b06-66d5-430e-9f28-65636843788b';
process.env.PINGONE_REGION = 'com';

const GATEWAY_AUDIENCE = 'https://mcp-gateway.example.com';

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

  it('the existing RFC 9728 protected-resource metadata now points authorization_servers at THIS gateway, not raw PingOne', async () => {
    const server = new GatewayServer({ config: stubConfig, upstreamMcpUrl: 'ws://localhost:9' });
    const res = await supertest(server.httpServer).get('/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect(res.body.authorization_servers).toEqual([GATEWAY_AUDIENCE]);
  });
});
