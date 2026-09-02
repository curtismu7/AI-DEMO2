'use strict';

// Dev TLS certs may exist on disk, so GatewayServer can create an HTTPS server.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * gateway-sse-upstream-error.test.ts
 *
 * GET /mcp is an SSE passthrough: the gateway pipes the upstream event stream to
 * the client. If the upstream connection resets mid-stream (after headers were
 * already sent to the client), the only teardown hook was `upstreamRes.on('error',
 * finish)`, and `finish()` only resolves an internal promise — it never called
 * res.end()/res.destroy(). Node's stream.pipe() does not auto-end the destination
 * on a source 'error' (only on source 'end'), so the client-facing SSE response
 * was left open forever. Finding #67 (round-5 audit).
 */

import { GatewayServer, McpRequestMiddleware } from '../src/server/GatewayServer';
import type { GatewayConfig } from '../src/config';
import * as http from 'node:http';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';

delete process.env.PINGONE_JWKS_ENDPOINT;
delete process.env.PINGONE_JWKS_URI;
process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';

const GATEWAY_AUDIENCE = 'https://mcp-gateway.example.com';

const baseConfig: GatewayConfig = {
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
  devBypass: true,
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
  mcpJwtVerifierHttpUrl: 'http://localhost:8083',
  mcpJwtVerifierResourceUri: 'mcp-jwt-verifier.ping.demo',
  mcpWeatherHttpUrl: 'http://localhost:8896',
  mcpBraveHttpUrl: 'http://localhost:8897',
  bffWeatherFlagUrl: '',
  bffBraveFlagUrl: '',
  allowLocalScopeFallback: false,
  introspectionEnabled: false,
  introspectionProvider: 'pinggateway',
  authorizedActorClientId: '',
  requireActForAgentTools: false,
  intentTokenRequired: false,
  requireRarIntent: false,
  rateLimitEnabled: false,
  wbaMode: 'monitor',
  rateLimitMaxRequests: 20,
  rateLimitWindowMs: 60000,
  introspectionSimDown: false,
  enterpriseManagedMcpAuth: false,
};

const passthrough: McpRequestMiddleware = async (bearer, body, _req, _res, forward) => {
  await forward(bearer, body);
};

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('GatewayServer GET /mcp — SSE client teardown on upstream error', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let upstreamSocket: import('node:net').Socket | null;

  beforeEach(async () => {
    upstreamSocket = null;
    upstream = http.createServer((req, res) => {
      upstreamSocket = res.socket as import('node:net').Socket;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('event: ready\ndata: {}\n\n');
      // Never end — the test abruptly resets the connection after first bytes.
    });
    upstreamPort = await listen(upstream);
  });

  afterEach(async () => { await close(upstream); });

  it('ends the client-facing SSE response when the upstream connection resets mid-stream', async () => {
    const gateway = new GatewayServer({
      config: baseConfig,
      upstreamMcpUrl: `http://127.0.0.1:${upstreamPort}`,
      requestMiddleware: passthrough,
    });
    const gwPort = await listen(gateway.httpServer);
    const isTls = gateway.httpServer instanceof https.Server;
    const lib = isTls ? https : http;

    await new Promise<void>((resolve, reject) => {
      const clientReq = (lib as typeof http).request(
        {
          hostname: '127.0.0.1',
          port: gwPort,
          path: '/mcp',
          method: 'GET',
          headers: { Authorization: 'Bearer dev-token', Accept: 'text/event-stream' },
          ...(isTls ? { rejectUnauthorized: false } : {}),
        } as http.RequestOptions,
        (res) => {
          let closed = false;
          res.on('data', () => {
            // Got the first SSE bytes — now abruptly reset the upstream connection
            // (not a clean end()), simulating mcp-server restarting/resetting.
            if (upstreamSocket) upstreamSocket.destroy();
          });
          res.on('end', () => { closed = true; resolve(); });
          res.on('close', () => { if (!closed) { closed = true; resolve(); } });
          res.on('error', () => { if (!closed) { closed = true; resolve(); } });
        },
      );
      clientReq.on('error', () => resolve());
      clientReq.end();
      // Pre-fix, the client-facing response never ends: nothing above ever fires
      // and this timeout — a genuine test failure, not a false negative — is what
      // proves the hang.
      setTimeout(() => reject(new Error('client-facing SSE response never ended')), 2000);
    });

    await close(gateway.httpServer);
  });
});
