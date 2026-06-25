'use strict';

// Dev TLS certs exist on disk, so GatewayServer creates an HTTPS server.
// Disable certificate verification so supertest can connect to the self-signed cert.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * gateway-get-delete-middleware.test.ts — Phase 3 CR-03 regression tests.
 *
 * Verifies that GET /mcp and DELETE /mcp now route through the SAME
 * middleware() callback that POST /mcp uses — RFC 7662 introspection +
 * GatewayTokenPolicy (D-05 anti-bypass) + PingAuthorize + RFC 8693 exchange.
 *
 * Before this fix, GET and DELETE forwarded the inbound bearer verbatim,
 * bypassing the entire auth pipeline. These tests exercise the middleware
 * contract directly (a spy middleware injected via GatewayServerOptions),
 * which is the same shape the production buildAuthorizeMcpRequest produces.
 */

import { GatewayServer, McpRequestMiddleware } from '../src/server/GatewayServer';
import type { GatewayConfig } from '../src/config';
import supertest from 'supertest';

const GATEWAY_AUDIENCE = 'https://mcp-gateway.example.com';
const UPSTREAM_AUDIENCE = 'https://mcp-olb.example.com';

const stubConfig: GatewayConfig = {
  port: 0,
  host: '127.0.0.1',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tokenEndpointAuthMethod: 'basic',
  tokenEndpoint: 'https://auth.example.com/token',
  gatewayResourceUri: GATEWAY_AUDIENCE,
  mcpOlbWsUrl: 'ws://localhost:8080',
  mcpInvestWsUrl: 'ws://localhost:8081',
  mcpOlbResourceUri: UPSTREAM_AUDIENCE,
  mcpInvestResourceUri: 'https://mcp-invest.example.com',
  pingAuthorizeEndpoint: '',
  pingAuthorizeWorkerId: '',
  p1azEnabled: false,
  hitlServiceUrl: '',
  introspectionEndpoint: '',
  introspectionClientId: '',
  introspectionClientSecret: '',
  devBypass: false,
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
};

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
  const sig = Buffer.from('fakesig').toString('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('GatewayServer GET /mcp — Phase 3 CR-03 middleware unification', () => {
  it('routes GET through the middleware (not the inbound bearer) when auth passes', async () => {
    let middlewareCalled = false;
    let middlewareReceivedBearer: string | null = null;
    let middlewareReceivedBody: Buffer | null = null;
    const EXCHANGED = 'exchanged-upstream-olb-token';

    const spyMiddleware: McpRequestMiddleware = async (bearer, body, _req, _res, forward) => {
      middlewareCalled = true;
      middlewareReceivedBearer = bearer;
      middlewareReceivedBody = body;
      // Simulate exchange: forward continuation with the upstream-aud token,
      // NOT the inbound bearer. Upstream will be unreachable (port 19999),
      // so we expect 502 — which proves the continuation ran with the exchanged token.
      await forward(EXCHANGED, body);
    };

    const gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
      requestMiddleware: spyMiddleware,
    });
    const request = supertest(gateway.httpServer);

    const validToken = makeToken(GATEWAY_AUDIENCE);
    const res = await request
      .get('/mcp')
      .set('Authorization', `Bearer ${validToken}`)
      .set('Accept', 'text/event-stream');

    expect(middlewareCalled).toBe(true);
    // The middleware received the original inbound bearer (it's the one that
    // decides whether to exchange; the gateway must not pre-exchange).
    expect(middlewareReceivedBearer).toBe(validToken);
    // GET has no body — middleware receives an empty buffer.
    expect(middlewareReceivedBody).not.toBeNull();
    expect(Buffer.isBuffer(middlewareReceivedBody)).toBe(true);
    expect((middlewareReceivedBody as unknown as Buffer).length).toBe(0);
    // Upstream unreachable → 502 (auth + middleware + exchange all ran cleanly).
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('upstream_unavailable');
  });

  it('returns 401 when bearer is absent — middleware must not run', async () => {
    const spyMiddleware: McpRequestMiddleware = jest.fn();
    const gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
      requestMiddleware: spyMiddleware,
    });
    const request = supertest(gateway.httpServer);

    const res = await request.get('/mcp');

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/Bearer/i);
    expect(spyMiddleware).not.toHaveBeenCalled();
  });

  it('rejects pre-exchanged upstream-aud tokens before the middleware (D-05 anti-bypass at the edge)', async () => {
    // A token whose aud is the OLB upstream URI must be rejected by the inbound
    // aud check. This is the same defense the POST path uses to reject wrong-hop
    // tokens. (The deeper D-05 invariant inside GatewayTokenPolicy adds a second
    // layer; this edge check fires first.)
    const spyMiddleware: McpRequestMiddleware = jest.fn();
    const gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
      requestMiddleware: spyMiddleware,
    });
    const request = supertest(gateway.httpServer);

    const wrongAudToken = makeToken(UPSTREAM_AUDIENCE);
    const res = await request
      .get('/mcp')
      .set('Authorization', `Bearer ${wrongAudToken}`);

    expect(res.status).toBe(401);
    expect(spyMiddleware).not.toHaveBeenCalled();
  });

  it('honors devBypass — middleware short-circuit forwards inbound bearer (dev mode)', async () => {
    // In dev mode, the middleware is expected to forward the inbound bearer.
    // The GatewayServer must not block dev-mode traffic.
    let forwardedToken: string | null = null;
    const passthroughMiddleware: McpRequestMiddleware = async (bearer, body, _req, _res, forward) => {
      // Mirror buildAuthorizeMcpRequest's dev-bypass branch: forward inbound bearer.
      forwardedToken = bearer;
      await forward(bearer, body);
    };
    const devConfig = { ...stubConfig, devBypass: true };
    const gateway = new GatewayServer({
      config: devConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
      requestMiddleware: passthroughMiddleware,
    });
    const request = supertest(gateway.httpServer);

    // In dev bypass, even a token without proper aud should reach the middleware.
    const looseToken = makeToken('https://anything.example.com');
    const res = await request
      .get('/mcp')
      .set('Authorization', `Bearer ${looseToken}`);

    expect(forwardedToken).toBe(looseToken);
    // Upstream unreachable → 502
    expect(res.status).toBe(502);
  });
});

describe('GatewayServer DELETE /mcp — Phase 3 CR-03 middleware unification', () => {
  it('routes DELETE through the middleware and forwards with the exchanged token', async () => {
    let middlewareCalled = false;
    let middlewareReceivedBearer: string | null = null;
    let middlewareReceivedBody: Buffer | null = null;
    const EXCHANGED = 'exchanged-upstream-olb-token';

    const spyMiddleware: McpRequestMiddleware = async (bearer, body, _req, _res, forward) => {
      middlewareCalled = true;
      middlewareReceivedBearer = bearer;
      middlewareReceivedBody = body;
      await forward(EXCHANGED, body);
    };

    const gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
      requestMiddleware: spyMiddleware,
    });
    const request = supertest(gateway.httpServer);

    const validToken = makeToken(GATEWAY_AUDIENCE);
    const res = await request
      .delete('/mcp')
      .set('Authorization', `Bearer ${validToken}`);

    expect(middlewareCalled).toBe(true);
    expect(middlewareReceivedBearer).toBe(validToken);
    expect(Buffer.isBuffer(middlewareReceivedBody)).toBe(true);
    expect((middlewareReceivedBody as unknown as Buffer).length).toBe(0);
    // Upstream unreachable → 502
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('upstream_unavailable');
  });

  it('returns 401 when bearer is absent — middleware must not run', async () => {
    const spyMiddleware: McpRequestMiddleware = jest.fn();
    const gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
      requestMiddleware: spyMiddleware,
    });
    const request = supertest(gateway.httpServer);

    const res = await request.delete('/mcp');

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/Bearer/i);
    expect(spyMiddleware).not.toHaveBeenCalled();
  });

  it('rejects pre-exchanged upstream-aud tokens before the middleware (D-05 anti-bypass at the edge)', async () => {
    const spyMiddleware: McpRequestMiddleware = jest.fn();
    const gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
      requestMiddleware: spyMiddleware,
    });
    const request = supertest(gateway.httpServer);

    const wrongAudToken = makeToken(UPSTREAM_AUDIENCE);
    const res = await request
      .delete('/mcp')
      .set('Authorization', `Bearer ${wrongAudToken}`);

    expect(res.status).toBe(401);
    expect(spyMiddleware).not.toHaveBeenCalled();
  });

  it('honors devBypass — middleware short-circuit forwards inbound bearer (dev mode)', async () => {
    let forwardedToken: string | null = null;
    const passthroughMiddleware: McpRequestMiddleware = async (bearer, body, _req, _res, forward) => {
      forwardedToken = bearer;
      await forward(bearer, body);
    };
    const devConfig = { ...stubConfig, devBypass: true };
    const gateway = new GatewayServer({
      config: devConfig,
      upstreamMcpUrl: 'http://127.0.0.1:19999',
      requestMiddleware: passthroughMiddleware,
    });
    const request = supertest(gateway.httpServer);

    const looseToken = makeToken('https://anything.example.com');
    const res = await request
      .delete('/mcp')
      .set('Authorization', `Bearer ${looseToken}`);

    expect(forwardedToken).toBe(looseToken);
    // Upstream unreachable → 502
    expect(res.status).toBe(502);
  });
});
