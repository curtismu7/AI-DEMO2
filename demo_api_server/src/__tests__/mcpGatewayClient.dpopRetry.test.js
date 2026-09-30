'use strict';

jest.mock('axios');
jest.mock('../../services/configStore', () => ({ get: jest.fn(() => null), getEffective: jest.fn(() => null) }));
jest.mock('../../services/dpopKeyService', () => ({
  signDpopProof: jest.fn(() => `proof-${jest.requireMock('../../services/dpopKeyService').signDpopProof.mock.calls.length}`),
  accessTokenHash: jest.fn(() => 'ath'),
  signWebBotAuthHeaders: jest.fn(() => ({})),
}));

const axios = require('axios');
const configStore = require('../../services/configStore');
const dpop = require('../../services/dpopKeyService');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');
const previousPingGatewayUrl = process.env.MCP_PINGGATEWAY_URL;

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const subjectToken = `${encode({ alg: 'none' })}.${encode({ sub: 'user-1', aud: 'mcpgateway.ping.demo', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

beforeEach(() => {
  process.env.MCP_PINGGATEWAY_URL = 'https://api.ping.demo:3005';
  jest.clearAllMocks();
  configStore.getEffective.mockImplementation((key) => ({
    pingone_resource_mcp_server_uri: 'mcpserver.ping.demo',
    mcp_demo_gateway_url: 'https://gateway.example',
  }[key] || null));
  const observedHeaders = [];
  axios.post = jest.fn(async (_url, _body, options) => {
    observedHeaders.push({ ...options.headers });
    return observedHeaders.length === 1
      ? { status: 502, headers: {}, data: { error: 'upstream_unavailable' } }
      : { status: 200, headers: {}, data: { jsonrpc: '2.0', result: { ok: true } } };
  });
  axios.observedHeaders = observedHeaders;
});

afterAll(() => {
  if (previousPingGatewayUrl === undefined) delete process.env.MCP_PINGGATEWAY_URL;
  else process.env.MCP_PINGGATEWAY_URL = previousPingGatewayUrl;
});

test('a retried idempotent read gets a fresh DPoP proof for each HTTP attempt', async () => {
  await callToolViaGateway('https://gateway.example', subjectToken, 'get_airline_bookings', {}, {
    dpopKey: { privatePem: 'private-key', publicJwk: { kty: 'EC' } },
  });

  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(axios.observedHeaders[0].DPoP).toBeTruthy();
  expect(axios.observedHeaders[1].DPoP).toBeTruthy();
  expect(axios.observedHeaders[1].DPoP).not.toBe(axios.observedHeaders[0].DPoP);
  expect(dpop.signDpopProof).toHaveBeenCalledTimes(2);
});
