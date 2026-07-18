'use strict';

// UC2/UC2.5 (A2A delegation) regression: the specialist's tool call executes
// with the nested-act token audienced to the DEDICATED A2A gateway resource
// (a2a_gateway_audience, e.g. mcpgateway-a2a.ping.demo). Only the Node Demo
// Agent Gateway accepts that audience (comma-list MCP_GW_RESOURCE_URI);
// PingGateway (IG) introspects against its own resource URI and its
// McpProtectionFilter requires scope gateway:mcp:invoke, so with
// ff_mcp_gateway_pinggateway on the call always 401/403'd and the demo steps
// rendered "That step couldn't be completed". An A2A-audienced bearer must pin
// to the Node gateway exactly like the dual-token/bankingdata tools and the
// RAR sims (#603).

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));

const axios = require('axios');
const configStore = require('../../services/configStore');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');

const PG_URL = 'https://pinggateway.example';
const NODE_URL = 'http://mcp-gateway:3005';
const A2A_AUD = 'mcpgateway-a2a.ping.demo';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtWithAud = (aud) =>
  `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({ aud, sub: 'user1', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

let prevPg;
beforeAll(() => {
  prevPg = process.env.MCP_PINGGATEWAY_URL;
  process.env.MCP_PINGGATEWAY_URL = PG_URL;
});
afterAll(() => {
  if (prevPg === undefined) delete process.env.MCP_PINGGATEWAY_URL;
  else process.env.MCP_PINGGATEWAY_URL = prevPg;
});

beforeEach(() => {
  jest.clearAllMocks();
  configStore.getEffective.mockImplementation((key) => ({
    a2a_gateway_audience: A2A_AUD,
    mcp_demo_gateway_url: NODE_URL,
  }[key] || null));
  axios.post = jest.fn().mockResolvedValue({
    status: 200,
    headers: {},
    data: { jsonrpc: '2.0', result: { ok: true } },
  });
});

test('an A2A-audienced bearer pins the call to the Node Demo Agent Gateway', async () => {
  // PingOne mints aud as an array — cover the array branch here.
  await callToolViaGateway(PG_URL, jwtWithAud([A2A_AUD]), 'get_portfolio_summary', {}, {});
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][0]).toBe(`${NODE_URL}/mcp`);
});

test('a normal gateway-audienced bearer stays on PingGateway', async () => {
  await callToolViaGateway(PG_URL, jwtWithAud('https://api.ping.demo:3036/mcp'), 'get_my_accounts', {}, {});
  expect(axios.post.mock.calls[0][0]).toBe(`${PG_URL}/mcp`);
});

test('the pin is a no-op when the base is already the Node gateway', async () => {
  await callToolViaGateway(NODE_URL, jwtWithAud(A2A_AUD), 'get_portfolio_summary', {}, {});
  expect(axios.post.mock.calls[0][0]).toBe(`${NODE_URL}/mcp`);
});
