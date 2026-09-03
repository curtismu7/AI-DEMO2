'use strict';

// The OpenSearch door is the only door whose upstream has NO auth of its own,
// so the façade must issue and enforce the challenge itself. These tests pin
// that: without a valid bearer the upstream must never be reached.

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

const { DOORS, verifyDoorBearer } = router.__test;
const AUD = 'mcpgateway.ping.demo';

// A real RSA keypair — the point of the gate is signature verification, so the
// tests sign for real rather than stubbing the verify step.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const OTHER = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// noExp omits the claim entirely — `exp: undefined` would just trigger the
// default parameter and silently mint a VALID token, which is how this helper
// first made the no-exp case pass against a gate that was working correctly.
function makeToken({ aud = AUD, exp = Math.floor(Date.now() / 1000) + 3600, noExp = false, alg = 'RS256', kid = 'k1', signWith = privateKey, claims = {} } = {}) {
  const head = b64({ alg, kid, typ: 'JWT' });
  const payload = { aud, iss: 'https://auth.pingone.com/env/as', scope: 'mcp:invoke', ...claims };
  if (!noExp) payload.exp = exp;
  const body = b64(payload);
  if (alg === 'none') return `${head}.${body}.`;
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(signWith).toString('base64url');
  return `${head}.${body}.${sig}`;
}

let upstream;
let upstreamHits;

beforeAll((done) => {
  upstreamHits = 0;
  upstream = http.createServer((req, res) => {
    upstreamHits += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'opensearch-mcp-server' } } }));
  });
  upstream.listen(0, '127.0.0.1', () => {
    process.env.MCP_FACADE_OPENSEARCH_URL = `http://127.0.0.1:${upstream.address().port}/mcp`;
    process.env.MCP_FACADE_OPENSEARCH_AUD = AUD;
    done();
  });
});

afterAll((done) => {
  delete process.env.MCP_FACADE_OPENSEARCH_URL;
  delete process.env.MCP_FACADE_OPENSEARCH_AUD;
  upstream.close(done);
});

beforeEach(() => {
  upstreamHits = 0;
  jwksService.getPublicKey.mockReset();
  jwksService.getPublicKey.mockResolvedValue(publicKey);
});

function app() {
  const a = express();
  a.use('/mcp-facade', router);
  return a;
}

const post = (token) => {
  const r = request(app()).post('/mcp-facade/opensearch/mcp').send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

describe('opensearch door — façade-enforced bearer', () => {
  it('is configured to require a bearer (the upstream cannot)', () => {
    expect(DOORS.opensearch.requireBearer).toBe(true);
    expect(DOORS.opensearch.expectedAudience()).toBe(AUD);
  });

  it('challenges an anonymous request and never touches the upstream', async () => {
    const res = await post(null);
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/resource_metadata="[^"]*oauth-protected-resource"/);
    expect(res.headers['www-authenticate']).toMatch(/scope="mcp:invoke"/);
    expect(res.body.error.data.reason).toBe('missing_bearer');
    expect(upstreamHits).toBe(0);
  });

  it('relays once the bearer verifies', async () => {
    const res = await post(makeToken());
    expect(res.status).toBe(200);
    expect(upstreamHits).toBe(1);
  });

  // Each of these is a way in if the gate is wrong; all must deny AND not relay.
  it.each([
    ['a token signed by another key', () => makeToken({ signWith: OTHER.privateKey }), 'bad_signature'],
    ['an expired token', () => makeToken({ exp: Math.floor(Date.now() / 1000) - 60 }), 'expired'],
    ['a token for another audience', () => makeToken({ aud: 'someone-else' }), 'audience_mismatch'],
    ['an alg:none token', () => makeToken({ alg: 'none' }), 'unsupported_alg'],
    ['a token with no exp', () => makeToken({ noExp: true }), 'missing_exp'],
    ['a non-JWT string', () => 'not-a-jwt', 'malformed_token'],
  ])('denies %s', async (_label, mk, reason) => {
    const res = await post(mk());
    expect(res.status).toBe(401);
    expect(res.body.error.data.reason).toBe(reason);
    expect(upstreamHits).toBe(0);
  });

  it('accepts an audience array containing the expected value', async () => {
    const res = await post(makeToken({ aud: ['other', AUD] }));
    expect(res.status).toBe(200);
    expect(upstreamHits).toBe(1);
  });

  it('fails closed when JWKS is unavailable', async () => {
    jwksService.getPublicKey.mockRejectedValue(new Error('network'));
    const res = await post(makeToken());
    expect(res.status).toBe(401);
    expect(res.body.error.data.reason).toBe('jwks_unavailable');
    expect(upstreamHits).toBe(0);
  });

  it('fails closed on an unknown kid', async () => {
    jwksService.getPublicKey.mockResolvedValue(null);
    const res = await verifyDoorBearer(
      { get: () => `Bearer ${makeToken()}` },
      DOORS.opensearch,
    );
    expect(res).toEqual({ ok: false, reason: 'unknown_kid' });
  });

  // Regression: jwksService can hand back a key shape crypto.Verify rejects
  // outright (a raw JWK, say) rather than a usable PEM/KeyObject — truthy, so
  // it passes the unknown_kid check, but createVerify().verify() throws. That
  // threw out of verifyDoorBearer as an unhandled rejection: no response was
  // ever sent, and the request hung until nginx's own 60s upstream timeout —
  // exactly the "fails closed" this function's own docstring promises NOT to
  // do. Live 2026-09-03 against the opensearch door; the same crash-then-hang
  // would just as well have hit the newer, identically-gated brave door.
  it('fails closed instead of hanging when the resolved key is unusable', async () => {
    jwksService.getPublicKey.mockResolvedValue({ not: 'a usable key' });
    const res = await verifyDoorBearer(
      { get: () => `Bearer ${makeToken()}` },
      DOORS.opensearch,
    );
    expect(res).toEqual({ ok: false, reason: 'verify_error' });
  });

  it('responds instead of hanging over HTTP when the resolved key is unusable', async () => {
    jwksService.getPublicKey.mockResolvedValue({ not: 'a usable key' });
    const res = await post(makeToken());
    expect(res.status).toBe(401);
    expect(res.body.error.data.reason).toBe('verify_error');
    expect(upstreamHits).toBe(0);
  });

  it('leaves the other doors ungated (their upstreams issue their own 401)', () => {
    for (const name of ['agent-gateway', 'agentless', 'agent', 'banking', 'pingone-admin']) {
      expect(DOORS[name].requireBearer).toBeUndefined();
    }
  });
});
