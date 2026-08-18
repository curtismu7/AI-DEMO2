'use strict';

// Dev TLS certs may exist on disk, so GatewayServer can create an HTTPS server.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * gateway-sse-client-close.test.ts
 *
 * GET /mcp is an SSE passthrough: the gateway pipes the upstream event stream to
 * the client. Previously, when the SSE client disconnected mid-stream the gateway
 * never watched req/res for 'close', so pipe() only unpipe()'d and the upstream
 * GET (and its socket) leaked for the process lifetime. It now destroys the
 * upstream request on client close — without regressing normal completion.
 */

import { GatewayServer, McpRequestMiddleware } from '../src/server/GatewayServer';
import type { GatewayConfig } from '../src/config';
import * as http from 'node:http';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';

// tokenValidator does real JWKS verification when PINGONE_JWKS_ENDPOINT / _URI is
// set; devBypass skips inbound validation but keep the env clean regardless.
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
};

// Dev-bypass middleware: forward the inbound bearer unchanged (mirrors
// buildAuthorizeMcpRequest's dev branch) so the request reaches pipeGetToUpstream.
const passthrough: McpRequestMiddleware = async (bearer, body, _req, _res, forward) => {
  await forward(bearer, body);
};

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('GatewayServer GET /mcp — SSE upstream teardown on client close', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let upstreamReqClosed: boolean;
  let holdOpen: boolean;

  beforeEach(async () => {
    upstreamReqClosed = false;
    holdOpen = true;
    upstream = http.createServer((req, res) => {
      req.on('close', () => { upstreamReqClosed = true; });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('event: ready\ndata: {}\n\n');
      if (!holdOpen) res.end();
      // When holdOpen, never end — simulate a long-lived SSE stream.
    });
    upstreamPort = await listen(upstream);
  });

  afterEach(async () => { await close(upstream); });

  it('destroys the upstream request when the SSE client disconnects mid-stream', async () => {
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
          // Got the first SSE bytes — now hang up the client mid-stream.
          res.once('data', () => { clientReq.destroy(); resolve(); });
          res.on('error', () => resolve());
        },
      );
      clientReq.on('error', () => resolve());
      clientReq.end();
      setTimeout(reject, 3000, new Error('no SSE data received'));
    });

    // The gateway must have torn down the upstream GET rather than leaking it.
    await waitFor(() => upstreamReqClosed);
    expect(upstreamReqClosed).toBe(true);

    await close(gateway.httpServer);
  });

  it('completes a normal SSE stream without teardown side-effects (no regression)', async () => {
    holdOpen = false; // upstream writes one event then ends
    const gateway = new GatewayServer({
      config: baseConfig,
      upstreamMcpUrl: `http://127.0.0.1:${upstreamPort}`,
      requestMiddleware: passthrough,
    });
    const gwPort = await listen(gateway.httpServer);
    const isTls = gateway.httpServer instanceof https.Server;
    const lib = isTls ? https : http;

    const body = await new Promise<string>((resolve, reject) => {
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
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { data += c; });
          res.on('end', () => resolve(data));
          res.on('error', reject);
        },
      );
      clientReq.on('error', reject);
      clientReq.end();
      setTimeout(reject, 3000, new Error('stream did not complete'));
    });

    expect(body).toContain('event: ready');
    await close(gateway.httpServer);
  });
});
