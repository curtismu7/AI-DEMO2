'use strict';

// One door, every registered Agentic App: /privilege-gateway/<app>/mcp resolves
// to <gateway>/<app>/mcp. The segment lands in the URL of an AUTHENTICATED
// upstream hop, so most of what matters here is that it is treated as a name
// and never as a path.

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({ appendHop: jest.fn() }));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true') }));
jest.mock('../../services/jwksService', () => ({ getPublicKey: jest.fn() }));

const crypto = require('crypto');
const http = require('http');
const express = require('express');
const request = require('supertest');
const jwksService = require('../../services/jwksService');
const router = require('../../routes/mcpFacade');
const gatewaySession = require('../../services/privilegeGatewaySession');

const AUD = 'mcpgateway.ping.demo';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function callerToken() {
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ aud: AUD, iss: 'https://auth.pingone.com/env/as', exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

let gateway;
let seenPath;

beforeAll((done) => {
  gateway = http.createServer((req, res) => {
    seenPath = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }));
  });
  gateway.listen(0, '127.0.0.1', () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE = `http://127.0.0.1:${gateway.address().port}`;
    process.env.MCP_FACADE_OPENSEARCH_AUD = AUD;
    done();
  });
});

afterAll((done) => {
  delete process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE;
  delete process.env.MCP_FACADE_OPENSEARCH_AUD;
  gateway.close(done);
});

const app = () => express().use('/api/mcp-facade', router);
const RPC = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

describe('mcp-facade multi-app door', () => {
  beforeEach(() => {
    seenPath = undefined;
    jwksService.getPublicKey.mockResolvedValue({ keyObject: publicKey, alg: 'RS256' });
    gatewaySession.remember({
      accessToken: 'gateway-token',
      expiresIn: 3600,
      tokenUri: 'https://mcpgw.example.com/token',
    });
  });
  afterEach(() => gatewaySession.clear());

  test('routes each app segment to its own gateway app', async () => {
    for (const appName of ['opensearch22', 'banking-mcp', 'git_server.v2']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app())
        .post(`/api/mcp-facade/privilege-gateway/${appName}/mcp`)
        .set('Authorization', `Bearer ${callerToken()}`)
        .send(RPC);
      expect(res.status).toBe(200);
      expect(seenPath).toBe(`/${appName}/mcp`);
    }
  });

  test('the bare door still reaches the default app', async () => {
    const res = await request(app())
      .post('/api/mcp-facade/privilege-gateway/mcp')
      .set('Authorization', `Bearer ${callerToken()}`)
      .send(RPC);

    expect(res.status).toBe(200);
    expect(seenPath).toBe('/opensearch22/mcp');
  });

  test('discovery advertises the resource URL that was actually called', async () => {
    const res = await request(app())
      .get('/api/mcp-facade/privilege-gateway/banking-mcp/.well-known/oauth-protected-resource');

    // A client that authenticates for one app must not be handed another app's
    // resource identifier.
    expect(res.status).toBe(200);
    expect(res.body.resource).toMatch(/\/mcp-facade\/privilege-gateway\/banking-mcp\/mcp$/);
  });

  test.each([
    ['traversal', '..%2F..%2Fadmin'],
    ['absolute url', 'https:%2F%2Fevil.example.com'],
    ['space', 'two words'],
    ['too long', 'a'.repeat(65)],
  ])('rejects a %s app name without calling upstream', async (_label, appName) => {
    const res = await request(app())
      .post(`/api/mcp-facade/privilege-gateway/${appName}/mcp`)
      .set('Authorization', `Bearer ${callerToken()}`)
      .send(RPC);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_app');
    expect(seenPath).toBeUndefined();
  });

  test('a door that takes no app says so instead of silently ignoring the segment', async () => {
    const res = await request(app())
      .post('/api/mcp-facade/opensearch/anything/mcp')
      .set('Authorization', `Bearer ${callerToken()}`)
      .send(RPC);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('door_takes_no_app');
  });
});
