'use strict';

// The façade exchanges before forwarding on a door that declares an
// upstreamAudience — and, deliberately, can be made NOT to.
//
// oauth-mcp refuses a forwarded gateway-audience token by design ("D-05
// violation … the gateway must perform RFC 8693 exchange before forwarding").
// That refusal is the lesson this demo teaches, so
// ff_facade_upstream_exchange=false leaves it on screen: the door shows the
// real 401, and turning the flag back on shows the exchange fixing it.
//
// What must never happen is the middle case — forwarding the caller's
// gateway-audience token as if nothing were wrong. That is the bypass D-05
// exists to catch, and it would surface as a confusing upstream 401 rather
// than naming what went wrong here.
//
// The mocks are plain functions over module-level state, NOT jest.fn(): this
// repo sets clearMocks:true, which wipes jest.fn implementations before the
// test body runs and silently turned two of these into false passes.

const express = require('express');
const request = require('supertest');

let mockFlagValue;
let mockIsConfigured;
let mockExchangeResult;
let mockExchangeError;
let mockExchangeCalls;
let mockExchangeCached;

let mockHops;
jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  appendHop: (correlationId, hop) => { mockHops.push(hop); },
  __esModule: true,
}));
jest.mock('../../services/configStore', () => ({
  getEffective: (k) => (k === 'ff_facade_upstream_exchange' ? mockFlagValue : undefined),
}));
jest.mock('../../services/facadeUpstreamExchange', () => ({
  isConfigured: () => mockIsConfigured,
  exchangeForUpstream: async (...args) => {
    mockExchangeCalls.push(args);
    if (mockExchangeError) throw mockExchangeError;
    return { accessToken: mockExchangeResult, cached: mockExchangeCached };
  },
}));

const BANKING = '/mcp-facade/banking/mcp';
let lastUpstreamAuth;
let upstreamServer;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.post('/mcp', (req, res) => {
    lastUpstreamAuth = req.get('authorization') || null;
    res.json({ jsonrpc: '2.0', id: req.body.id, result: { tools: [] } });
  });
  upstreamServer = app.listen(0, () => {
    process.env.MCP_FACADE_BANKING_URL = `http://127.0.0.1:${upstreamServer.address().port}/mcp`;
    done();
  });
});

afterAll((done) => {
  delete process.env.MCP_FACADE_BANKING_URL;
  upstreamServer.close(done);
});

function facadeApp() {
  const router = require('../../routes/mcpFacade');
  const a = express();
  a.use('/mcp-facade', router);
  return a;
}

const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const withBearer = () => request(facadeApp()).post(BANKING)
  .set('Authorization', 'Bearer CALLER-GATEWAY-TOKEN')
  .send(rpc);

beforeEach(() => {
  mockFlagValue = undefined; // default = ON
  mockIsConfigured = true;
  mockExchangeResult = 'EXCHANGED-TOKEN';
  mockExchangeError = null;
  mockExchangeCalls = [];
  mockExchangeCached = false;
  mockHops = [];
  lastUpstreamAuth = null;
});

test('the caller bearer is EXCHANGED before forwarding, never passed through', async () => {
  await withBearer().expect(200);

  expect(mockExchangeCalls).toHaveLength(1);
  expect(mockExchangeCalls[0][0]).toBe('CALLER-GATEWAY-TOKEN');
  expect(mockExchangeCalls[0][1]).toBe('mcpserver.ping.demo');
  expect(lastUpstreamAuth).toBe('Bearer EXCHANGED-TOKEN');
  // The bypass D-05 exists to catch.
  expect(lastUpstreamAuth).not.toContain('CALLER-GATEWAY-TOKEN');
});

test('ff_facade_upstream_exchange=false keeps the D-05 refusal demonstrable', async () => {
  mockFlagValue = 'false';

  await withBearer();

  expect(mockExchangeCalls).toHaveLength(0);
  // Forwarded as-is, so the upstream can refuse it and the lesson lands.
  expect(lastUpstreamAuth).toBe('Bearer CALLER-GATEWAY-TOKEN');
});

test('an exchange failure is surfaced, not papered over by forwarding the original', async () => {
  mockExchangeError = Object.assign(new Error('invalid_grant'), { code: 'exchange_failed' });

  const res = await withBearer().expect(502);

  expect(res.body.error.message).toMatch(/exchange failed/i);
  expect(res.body.error.data.audience).toBe('mcpserver.ping.demo');
  // Never reached the upstream with the un-exchanged token.
  expect(lastUpstreamAuth).toBeNull();
});

test('an anonymous call is untouched — nothing to exchange', async () => {
  await request(facadeApp()).post(BANKING).send(rpc).expect(200);

  expect(mockExchangeCalls).toHaveLength(0);
  expect(lastUpstreamAuth).toBeNull();
});

test('with the exchange unconfigured the door still works, un-exchanged', async () => {
  mockIsConfigured = false;

  await withBearer().expect(200);

  expect(mockExchangeCalls).toHaveLength(0);
  expect(lastUpstreamAuth).toBe('Bearer CALLER-GATEWAY-TOKEN');
});

// The hop is the whole point of the flag: without it the trace jumps
// request -> response with no sign a token was swapped, and the RFC 8693
// moment — the thing being demonstrated — is invisible.
test('a successful exchange records a token.exchange hop naming both audiences', async () => {
  await withBearer().expect(200);

  const x = mockHops.find((h) => h.phase === 'token.exchange');
  expect(x).toBeTruthy();
  expect(x.status).toBe('ok');
  expect(x.details.rfc).toBe('RFC 8693');
  expect(x.details.audiences.to).toBe('mcpserver.ping.demo');
  expect(x.details.cached).toBe(false);
});

test('a cache hit is recorded as cached, so the demo does not claim a mint per message', async () => {
  mockExchangeCached = true;

  await withBearer().expect(200);

  const x = mockHops.find((h) => h.phase === 'token.exchange');
  expect(x.details.cached).toBe(true);
});

test('a failed exchange records the reason on the hop, not just a 502', async () => {
  mockExchangeError = Object.assign(new Error('invalid_grant'), { code: 'exchange_failed' });

  await withBearer().expect(502);

  const x = mockHops.find((h) => h.phase === 'token.exchange');
  expect(x.status).toBe('error');
  expect(x.details.reason).toBe('exchange_failed');
});

test('with the flag OFF the skip is recorded, so the D-05 refusal reads as a consequence', async () => {
  mockFlagValue = 'false';

  await withBearer();

  const x = mockHops.find((h) => h.phase === 'token.exchange');
  expect(x.status).toBe('skipped');
  expect(x.details.reason).toBe('ff_facade_upstream_exchange=false');
  expect(x.details.consequence).toMatch(/D-05/);
});
