'use strict';

// The privilege-gateway door is the one that survives a gateway restart: the
// MCP client authenticates to OUR broker and never registers with the AI
// Gateway, whose RFC 7591 client registry is in memory. Two things must hold —
// the caller's bearer must NOT reach the gateway, and a missing operator
// session must produce an actionable answer instead of bouncing the client back
// to an authorization server it already satisfied.

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

const DOOR = '/api/mcp-facade/privilege-gateway/mcp';
const AUD = 'mcpgateway.ping.demo';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function callerToken() {
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64({ aud: AUD, iss: 'https://auth.pingone.com/env/as', exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

let upstream;
let seenAuth;

beforeAll((done) => {
  upstream = http.createServer((req, res) => {
    seenAuth = req.headers.authorization || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }));
  });
  upstream.listen(0, '127.0.0.1', () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_URL = `http://127.0.0.1:${upstream.address().port}/opensearch22/mcp`;
    process.env.MCP_FACADE_OPENSEARCH_AUD = AUD;
    done();
  });
});

afterAll((done) => {
  delete process.env.MCP_FACADE_PRIVILEGE_GATEWAY_URL;
  delete process.env.MCP_FACADE_OPENSEARCH_AUD;
  upstream.close(done);
});

function buildApp() {
  const app = express();
  app.use('/api/mcp-facade', router);
  return app;
}

const RPC = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

describe('mcp-facade privilege-gateway door', () => {
  beforeEach(() => {
    seenAuth = undefined;
    jwksService.getPublicKey.mockResolvedValue({ keyObject: publicKey, alg: 'RS256' });
    gatewaySession.clear();
  });
  afterEach(() => gatewaySession.clear());

  test('answers 503 with a remedy when no operator session exists', async () => {
    const res = await request(buildApp()).post(DOOR)
      .set('Authorization', `Bearer ${callerToken()}`)
      .send(RPC);

    // 401 would tell the client to re-authenticate with our broker, which it
    // already did — the missing piece is a human sign-in against the gateway.
    expect(res.status).toBe(503);
    expect(res.body.error.data.remedy).toMatch(/privilege-mcp-client/);
    expect(seenAuth).toBeUndefined();
  });

  test('sends the server-side gateway token upstream, never the caller bearer', async () => {
    const caller = callerToken();
    gatewaySession.remember({
      accessToken: 'gateway-token',
      refreshToken: 'r1',
      expiresIn: 3600,
      tokenUri: 'https://mcpgw.example.com/opensearch22/token',
      clientId: 'dcr-1',
    });

    const res = await request(buildApp()).post(DOOR)
      .set('Authorization', `Bearer ${caller}`)
      .send(RPC);

    expect(res.status).toBe(200);
    expect(seenAuth).toBe('Bearer gateway-token');
    expect(seenAuth).not.toContain(caller);
  });

  test('still refuses an unauthenticated caller, session or not', async () => {
    gatewaySession.remember({
      accessToken: 'gateway-token',
      expiresIn: 3600,
      tokenUri: 'https://mcpgw.example.com/opensearch22/token',
    });

    const res = await request(buildApp()).post(DOOR).send(RPC);

    // Otherwise the door would relay anonymous traffic on the operator's
    // gateway session — the whole point of requireBearer here.
    expect(res.status).toBe(401);
    expect(seenAuth).toBeUndefined();
  });
});
