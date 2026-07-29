'use strict';

// Dev TLS certs exist on disk, so GatewayServer creates an HTTPS server.
// Disable certificate verification so supertest can connect to the self-signed cert.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * gateway-server.test.ts — Plan 243-01 foundational tests.
 *
 * Verifies the GatewayServer:
 *   1. Owns the protected-resource metadata (not a pass-through to upstream)
 *   2. Enforces basic auth-challenge semantics on POST /mcp
 *
 * Tests are transport-focused and do NOT depend on the PingOne Authorize
 * decision path (that is wired in Plan 243-02).
 */

import http from 'http';
import supertest from 'supertest';
import { GatewayServer } from '../src/server/GatewayServer';
import type { GatewayConfig } from '../src/config';

// makeToken below produces jwt.decode()-only tokens (fake signature) — see its
// own comment. tokenValidator.ts attempts REAL JWKS signature verification
// whenever PINGONE_JWKS_ENDPOINT or its alias PINGONE_JWKS_URI is set, and
// fails closed if neither is configured (omission is not permission). Both
// must be cleared and the opt-in set explicitly: importing GatewayServer above
// transitively loads config.ts, which calls dotenv.config() — dotenv fills any
// env var that is not ALREADY set, so deleting these before the import is
// pointless (dotenv just re-populates them from demo_mcp_gateway/.env, a
// worktree-shared symlink to real PingOne credentials). Clearing must happen
// after the import, once dotenv has already run.
delete process.env.PINGONE_JWKS_ENDPOINT;
delete process.env.PINGONE_JWKS_URI;
process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';

// ---------------------------------------------------------------------------
// Minimal GatewayConfig stub — only fields used by GatewayServer in plan 01
// ---------------------------------------------------------------------------

const GATEWAY_AUDIENCE = 'https://mcp-gateway.example.com';

const stubConfig: GatewayConfig = {
  port: 0, // random port in tests
  host: '127.0.0.1',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tokenEndpointAuthMethod: 'basic',
  tokenEndpoint: 'https://auth.example.com/token',
  gatewayResourceUri: GATEWAY_AUDIENCE,
  mcpOlbWsUrl: 'ws://localhost:8080',
  mcpInvestWsUrl: 'ws://localhost:8081',
  mcpOlbResourceUri: 'https://mcp-olb.example.com',
  mcpInvestResourceUri: 'https://mcp-invest.example.com',
  pingAuthorizeEndpoint: '',
  pingAuthorizeWorkerId: '',
  p1azEnabled: false,
  hitlServiceUrl: '',
  introspectionEndpoint: '',
  introspectionClientId: '',
  introspectionClientSecret: '',
  devBypass: false,
  // Phase 266 fields
  demoApiKeyServiceKey: 'demo-api-key-0000',
  mortgageServiceBaseUrl: 'http://localhost:8082',
  mortgageServiceApiKey: 'demo-mortgage-key-0000',
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
};

const INTERNAL_SECRET = stubConfig.bffInternalSecret;

// ---------------------------------------------------------------------------
// Helper: create a minimal JWT payload encoded as a real-ish base64url token
// This is NOT a cryptographically valid JWT — GatewayServer.validateInboundToken
// uses jwt.decode() (not verify) so this is sufficient for auth shape tests.
// ---------------------------------------------------------------------------

function makeToken(
  aud: string | string[],
  opts: { expired?: boolean; sub?: string } = {},
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const exp = opts.expired
    ? Math.floor(Date.now() / 1000) - 60
    : Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(
    JSON.stringify({ sub: opts.sub ?? 'user-123', aud, exp, iss: 'https://auth.example.com' }),
  ).toString('base64url');
  // Fake signature — jwt.decode() does not verify signatures
  const sig = Buffer.from('fakesig').toString('base64url');
  return `${header}.${payload}.${sig}`;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GatewayServer — Plan 243-01 foundational tests', () => {
  let gateway: GatewayServer;
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    // Stub the middleware so no upstream call is made during tests
    gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999', // non-existent — upstream should not be called in these tests
    });
    request = supertest(gateway.httpServer);
  });

  afterEach(async () => {
    // GatewayServer in test mode doesn't call start() so no listen to close.
    // supertest binds once per request — no persistent server to shut down.
  });

  // -------------------------------------------------------------------------
  // 1. GET /.well-known/oauth-protected-resource returns GATEWAY metadata
  // -------------------------------------------------------------------------

  describe('GET /.well-known/oauth-protected-resource', () => {
    it('returns 200 with gateway-owned resource metadata', async () => {
      const res = await request.get('/.well-known/oauth-protected-resource');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('resource claim matches the configured gateway audience (not an upstream passthrough)', async () => {
      const res = await request.get('/.well-known/oauth-protected-resource');

      expect(res.body.resource).toBe(GATEWAY_AUDIENCE);
    });

    it('returns bearer_methods_supported and scopes_supported', async () => {
      const res = await request.get('/.well-known/oauth-protected-resource');

      expect(Array.isArray(res.body.bearer_methods_supported)).toBe(true);
      expect(res.body.bearer_methods_supported).toContain('header');
      expect(Array.isArray(res.body.scopes_supported)).toBe(true);
    });

    it('includes resource_name identifying this as the MCP Gateway (not the upstream server)', async () => {
      const res = await request.get('/.well-known/oauth-protected-resource');

      expect(res.body.resource_name).toMatch(/gateway/i);
    });
  });

  // -------------------------------------------------------------------------
  // 2. POST /mcp enforces bearer token and audience requirements
  // -------------------------------------------------------------------------

  describe('POST /mcp — auth enforcement', () => {
    const mcpBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });

    it('returns 401 and WWW-Authenticate when Authorization header is absent', async () => {
      const res = await request
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .send(mcpBody);

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBeDefined();
      expect(res.headers['www-authenticate']).toMatch(/Bearer/i);
      // McpProtectionFilter equivalent: resource_metadata directive for AS discovery (RFC 9728 §4)
      expect(res.headers['www-authenticate']).toMatch(/resource_metadata=/i);
    });

    it('returns 401 when Authorization is not a Bearer token', async () => {
      const res = await request
        .post('/mcp')
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .set('Content-Type', 'application/json')
        .send(mcpBody);

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Bearer/i);
    });

    it('returns 401 when token audience does not match the gateway audience (wrong-hop token)', async () => {
      // Simulate a token targeted at the upstream MCP server, not the gateway
      const wrongAudToken = makeToken('https://mcp-olb.example.com');

      const res = await request
        .post('/mcp')
        .set('Authorization', `Bearer ${wrongAudToken}`)
        .set('Content-Type', 'application/json')
        .send(mcpBody);

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Bearer/i);
    });

    it('returns 401 when token is expired', async () => {
      const expiredToken = makeToken(GATEWAY_AUDIENCE, { expired: true });

      const res = await request
        .post('/mcp')
        .set('Authorization', `Bearer ${expiredToken}`)
        .set('Content-Type', 'application/json')
        .send(mcpBody);

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Bearer/i);
    });

    it('does not crash the gateway when emitting WWW-Authenticate on auth failure', async () => {
      // Verify gateway stays alive after multiple auth rejections
      for (let i = 0; i < 3; i++) {
        const res = await request
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .send(mcpBody);
        expect(res.status).toBe(401);
      }

      // Gateway is still alive — metadata endpoint still responds
      const metaRes = await request.get('/.well-known/oauth-protected-resource');
      expect(metaRes.status).toBe(200);
    });

    it('proceeds to upstream forwarding when token has correct gateway audience', async () => {
      const validToken = makeToken(GATEWAY_AUDIENCE);

      // Upstream is intentionally unreachable — we expect a 502 not a 401
      // This proves the gateway reached the forwarding layer (auth passed)
      const res = await request
        .post('/mcp')
        .set('Authorization', `Bearer ${validToken}`)
        .set('MCP-Protocol-Version', '2025-11-25')
        .set('Content-Type', 'application/json')
        .send(mcpBody);

      // Auth passed — response is 502 (upstream down) not 401 (auth rejected)
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('upstream_unavailable');
    });
  });

  // -------------------------------------------------------------------------
  // 3. GET /mcp — SSE proxy (PingGateway: ReverseProxyHandler with streaming)
  // Requires bearer token just like POST /mcp.
  // When upstream is unreachable: 502 (auth passed) not 401 (auth failed).
  // -------------------------------------------------------------------------

  describe('GET /mcp — SSE proxy', () => {
    it('returns 401 + WWW-Authenticate when Authorization header is absent', async () => {
      const res = await request.get('/mcp');

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Bearer/i);
    });

    it('proceeds to upstream when token has correct gateway audience (auth passed → 502 upstream down)', async () => {
      const validToken = makeToken(GATEWAY_AUDIENCE);

      const res = await request
        .get('/mcp')
        .set('Authorization', `Bearer ${validToken}`)
        .set('Accept', 'text/event-stream');

      // Auth passed — upstream unreachable → 502, not 401
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('upstream_unavailable');
    });
  });

  // -------------------------------------------------------------------------
  // 4. GET /health
  // -------------------------------------------------------------------------

  describe('GET /health', () => {
    it('returns 200 with service name', async () => {
      const res = await request.get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('banking-mcp-gateway');
    });
  });

  // -------------------------------------------------------------------------
  // 5. GET /admin/config — live safe-view config read (internal-secret gated)
  // -------------------------------------------------------------------------

  describe('GET /admin/config', () => {
    it('returns 401 without the internal secret', async () => {
      const res = await request.get('/admin/config');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });

    it('returns 401 with a wrong internal secret', async () => {
      const res = await request.get('/admin/config').set('x-internal-gateway-secret', 'wrong');
      expect(res.status).toBe(401);
    });

    it('returns the non-secret safe-view config with the correct secret', async () => {
      const res = await request.get('/admin/config').set('x-internal-gateway-secret', INTERNAL_SECRET);
      expect(res.status).toBe(200);
      expect(res.body.gatewayResourceUri).toBe(GATEWAY_AUDIENCE);
      expect(res.body.mcpOlbWsUrl).toBe('ws://localhost:8080');
      // Phase 266/267 HTTP backend routes are exposed for the topology view
      expect(res.body.bankingResourceServerBaseUrl).toBe('http://localhost:3001');
      // secrets are never projected
      expect(res.body.clientSecret).toBeUndefined();
      expect(res.body.mortgageServiceApiKey).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('demo-mortgage-key');
    });
  });
});
