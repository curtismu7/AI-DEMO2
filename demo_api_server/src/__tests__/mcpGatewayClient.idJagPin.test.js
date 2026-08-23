'use strict';

// Native ID-JAG (MCP Enterprise-Managed Authorization) regression: the
// redeemed token always carries oauth-mcp's own resource audience
// (TokenIssuer.resolveOwnAudience — the embedded AS is never entitled to
// assert any other audience), never PingGateway's. PingGateway's
// McpProtectionFilter demands its own resource URI, so with
// ff_mcp_gateway_pinggateway on, an ID-JAG-redeemed call always 401'd "Wrong
// audience" at the tool-call step even after mint+redeem succeeded. An
// OLB-audienced bearer must pin to the Node Demo Agent Gateway, same as the
// A2A-audienced pin above — the gateway's own MCP_GW_RESOURCE_URI comma-list
// and tokenValidator.ts's ID-JAG JWKS filter both cover that audience.

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
const OLB_AUD = 'mcpserver.ping.demo';

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
    pingone_resource_mcp_server_uri: OLB_AUD,
    mcp_demo_gateway_url: NODE_URL,
  }[key] || null));
  axios.post = jest.fn().mockResolvedValue({
    status: 200,
    headers: {},
    data: { jsonrpc: '2.0', result: { ok: true } },
  });
});

test('an OLB-audienced (native ID-JAG) bearer pins the call to the Node Demo Agent Gateway', async () => {
  // PingOne-shaped mints (and oauth-mcp's own issueAuthorizationCode reuse)
  // may set aud as an array — cover that branch here, same as the A2A pin test.
  await callToolViaGateway(PG_URL, jwtWithAud([OLB_AUD]), 'get_account_balance', {}, {});
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][0]).toBe(`${NODE_URL}/mcp`);
});

test('a normal gateway-audienced bearer stays on PingGateway, unaffected', async () => {
  await callToolViaGateway(PG_URL, jwtWithAud('https://api.ping.demo:3036/mcp'), 'get_my_accounts', {}, {});
  expect(axios.post.mock.calls[0][0]).toBe(`${PG_URL}/mcp`);
});

test('the pin is a no-op when the base is already the Node gateway', async () => {
  await callToolViaGateway(NODE_URL, jwtWithAud(OLB_AUD), 'get_account_balance', {}, {});
  expect(axios.post.mock.calls[0][0]).toBe(`${NODE_URL}/mcp`);
});
