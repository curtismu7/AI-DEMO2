'use strict';

// Self-signed certs on both sides of the hop — disable verification for the
// supertest client and the gateway→upstream axios calls alike.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// Force decode-only inbound validation (no JWKS): the fake bearer below has no
// kid, and a developer .env with PINGONE_JWKS_ENDPOINT set would otherwise turn
// this suite's 200 into a 401 invalid_token before the middleware runs.
delete process.env.PINGONE_JWKS_ENDPOINT;
delete process.env.PINGONE_JWKS_URI;

/**
 * gateway-mtls-upstream.test.ts — mTLS client half for the HTTP-ingress
 * upstream forward (the node-gateway side of #906).
 *
 * mcp-server with MCP_MTLS_ENABLED=true serves :8080 over TLS and answers
 * 403 mtls_required when no client certificate is presented. The WS proxy
 * path already sends the gateway client cert (proxy.ts MtlsOptions); the
 * HTTP forwardToUpstream path did not — every A2A sensitive_* tool call
 * (UC2, 7 verticals) died as ECONNRESET/403 → 502 upstream error.
 *
 * This suite stands up a real TLS upstream that REQUIRES a client cert and
 * proves the gateway presents it end-to-end through POST /mcp.
 */

import https from 'https';
import type { TLSSocket } from 'tls';
import type { AddressInfo } from 'net';
import { generate } from 'selfsigned';
import supertest from 'supertest';
import { GatewayServer, McpRequestMiddleware } from '../src/server/GatewayServer';
import { generateGatewayCerts, GatewayCerts } from '../src/mtls';
import type { GatewayConfig } from '../src/config';

const GATEWAY_AUDIENCE = 'https://mcp-gateway.example.com';

const stubConfig = {
  port: 0,
  host: '127.0.0.1',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tokenEndpointAuthMethod: 'basic',
  tokenEndpoint: 'https://auth.example.com/token',
  gatewayResourceUri: GATEWAY_AUDIENCE,
  mcpOlbWsUrl: 'wss://localhost:8080',
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
  demoApiKeyServiceKey: 'demo-api-key-0000',
  mortgageServiceBaseUrl: 'http://localhost:8082',
  mortgageServiceApiKey: 'demo-mortgage-key-0000',
  bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
  bffInternalSecret: 'dev-shared-secret-change-me',
  bankingResourceServerBaseUrl: 'http://localhost:3001',
  bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
  mcpServerPassthrough: false,
  mtlsEnabled: false,
  mtlsCertPath: '/tmp/gw-client-test.crt',
} as GatewayConfig;

function makeToken(aud: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: 'user-123', aud, exp: Math.floor(Date.now() / 1000) + 3600, iss: 'https://auth.example.com' }),
  ).toString('base64url');
  return `${header}.${payload}.${Buffer.from('fakesig').toString('base64url')}`;
}

describe('forwardToUpstream — mTLS client half to a TLS upstream (#906)', () => {
  let upstream: https.Server;
  let upstreamUrl: string;
  let gatewayCerts: GatewayCerts;
  let sawClientCertCn: string | null;

  beforeAll(async () => {
    gatewayCerts = await generateGatewayCerts({ writeCertTo: '/tmp/gw-client-test.crt' });
    const notAfterDate = new Date();
    notAfterDate.setDate(notAfterDate.getDate() + 1);
    const serverPems = await generate(
      [{ name: 'commonName', value: 'mtls-test-upstream' }],
      { notAfterDate, keySize: 2048, algorithm: 'sha256' },
    );

    sawClientCertCn = null;
    upstream = https.createServer(
      { cert: serverPems.cert, key: serverPems.private, requestCert: true, rejectUnauthorized: false },
      (req, res) => {
        // Mirror BankingMCPServer's mTLS gate: no client cert → 403 mtls_required.
        const peer = (req.socket as TLSSocket).getPeerCertificate();
        if (!peer || !peer.subject) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'mtls_required', message: 'no client certificate presented' }));
          return;
        }
        sawClientCertCn = String(peer.subject.CN ?? '') || null;

        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          let rpc: { id?: unknown; method?: string } = {};
          try { rpc = JSON.parse(raw); } catch { /* notification bodies parse fine; ignore */ }
          if (rpc.method === 'initialize') {
            res.writeHead(200, { 'Content-Type': 'application/json', 'mcp-session-id': 'sess-1' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: { protocolVersion: '2025-11-25' } }));
            return;
          }
          if (rpc.method === 'notifications/initialized') {
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end('{}');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: { content: [{ type: 'text', text: 'sensitive ok' }] } }));
        });
      },
    );
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    upstreamUrl = `https://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it('presents the gateway client cert on the https upstream hop (tools/call succeeds)', async () => {
    const passthrough: McpRequestMiddleware = async (_bearer, body, _req, _res, forward) => {
      await forward('exchanged-upstream-token', body);
    };
    const gateway = new GatewayServer({
      config: stubConfig,
      upstreamMcpUrl: upstreamUrl,
      requestMiddleware: passthrough,
      mtlsCerts: { clientCert: gatewayCerts.clientCert, clientKey: gatewayCerts.clientKey },
    });

    // A developer .env (re-injected post-import by dotenv) would flip inbound
    // validation to real-JWKS mode and 401 the kid-less stub bearer — this
    // suite tests the UPSTREAM hop, so force decode-only right before the call.
    delete process.env.PINGONE_JWKS_ENDPOINT;
    delete process.env.PINGONE_JWKS_URI;
    process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS = 'true';
    const res = await supertest(gateway.httpServer)
      .post('/mcp')
      .set('Authorization', `Bearer ${makeToken(GATEWAY_AUDIENCE)}`)
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'sensitive_patient_records', arguments: {} } });

    // Without the client cert the upstream answers 403 mtls_required (the
    // exact live failure) — the gateway must complete handshake + call.
    expect({ status: res.status, body: res.body, www: res.headers['www-authenticate'] }).toEqual({ status: 200, body: expect.anything(), www: undefined });
    expect(JSON.stringify(res.body)).toContain('sensitive ok');
    expect(sawClientCertCn).toBe('banking-mcp-gateway');
  });
});
