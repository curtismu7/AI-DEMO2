'use strict';

// Two new Direct-mode doors, sibling to `opensearch`: `banking` (oauth-mcp,
// which owns its own OAuth — ungated pass-through, same shape as agent-gateway)
// and `brave` (mcp-brave, which has no auth of its own — façade-gated, same
// shape as opensearch). verifyDoorBearer itself is already fully exercised by
// mcpFacadeOpensearchDoor.test.js; these tests only prove each new door is
// wired to the right behavior.

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

const { DOORS } = router.__test;
const AUD = 'mcpgateway.ping.demo';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function makeToken() {
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const payload = { aud: AUD, iss: 'https://auth.pingone.com/env/as', scope: 'mcp:invoke', exp: Math.floor(Date.now() / 1000) + 3600 };
  const body = b64(payload);
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

let upstream;
let upstreamHits;
let lastUpstreamAuthHeader;

beforeAll((done) => {
  upstreamHits = 0;
  upstream = http.createServer((req, res) => {
    upstreamHits += 1;
    lastUpstreamAuthHeader = req.headers.authorization || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'stub' } } }));
  });
  upstream.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${upstream.address().port}/mcp`;
    process.env.MCP_FACADE_BANKING_URL = base;
    process.env.MCP_FACADE_BRAVE_URL = base;
    process.env.MCP_FACADE_OPENSEARCH_AUD = AUD;
    done();
  });
});

afterAll((done) => {
  delete process.env.MCP_FACADE_BANKING_URL;
  delete process.env.MCP_FACADE_BRAVE_URL;
  delete process.env.MCP_FACADE_OPENSEARCH_AUD;
  upstream.close(done);
});

beforeEach(() => {
  upstreamHits = 0;
  lastUpstreamAuthHeader = null;
  jwksService.getPublicKey.mockReset();
  jwksService.getPublicKey.mockResolvedValue({ keyObject: publicKey, alg: 'RS256' });
});

function app() {
  const a = express();
  a.use('/mcp-facade', router);
  return a;
}

describe('banking door — ungated, upstream owns its own OAuth', () => {
  it('is not façade-gated', () => {
    expect(DOORS.banking.requireBearer).toBeUndefined();
    expect(DOORS.banking.authorizationServer).toBeNull();
  });

  it('relays an anonymous call straight through, unlike opensearch/brave', async () => {
    const res = await request(app()).post('/mcp-facade/banking/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(200);
    expect(upstreamHits).toBe(1);
    expect(lastUpstreamAuthHeader).toBeNull();
  });
});

describe('brave door — façade-enforced bearer, same gate as opensearch', () => {
  it('is configured to require a bearer', () => {
    expect(DOORS.brave.requireBearer).toBe(true);
    expect(DOORS.brave.expectedAudience()).toBe(AUD);
  });

  it('challenges an anonymous request and never touches the upstream', async () => {
    const res = await request(app()).post('/mcp-facade/brave/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(401);
    expect(upstreamHits).toBe(0);
  });

  it('relays once the bearer verifies', async () => {
    const res = await request(app()).post('/mcp-facade/brave/mcp')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(200);
    expect(upstreamHits).toBe(1);
  });
});
