'use strict';

/**
 * rpcMethod:'tools/list' mode on callToolViaGateway — the discovery leg of the
 * MCP lifecycle shares the tool-call's routing/transport/error handling. Pins
 * the wire shape: JSON-RPC method tools/list with bare params, same bearer and
 * headers, single attempt (no tool-keyed retry).
 */

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((k) => null),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');

const previousPingGatewayUrl = process.env.MCP_PINGGATEWAY_URL;

beforeAll(() => {
  process.env.MCP_PINGGATEWAY_URL = 'https://api.ping.demo:3036';
});

afterAll(() => {
  if (previousPingGatewayUrl === undefined) delete process.env.MCP_PINGGATEWAY_URL;
  else process.env.MCP_PINGGATEWAY_URL = previousPingGatewayUrl;
});

test('rpcMethod tools/list posts a JSON-RPC tools/list with bare params and returns the tool list', async () => {
  axios.post = jest.fn().mockResolvedValue({
    status: 200,
    headers: {},
    data: { jsonrpc: '2.0', id: 'c1', result: { tools: [{ name: 'get_account_balance' }] } },
  });

  const out = await callToolViaGateway('https://api.ping.demo:3036', 'bearer-tok', null, {}, {
    rpcMethod: 'tools/list',
    correlationId: 'c1',
    vertical: 'banking',
  });

  expect(axios.post).toHaveBeenCalledTimes(1);
  const [url, body, config] = axios.post.mock.calls[0];
  expect(url).toBe('https://api.ping.demo:3036/mcp');
  expect(body.method).toBe('tools/list');
  expect(body.params).toEqual({});
  expect(body.id).toBe('c1');
  expect(config.headers.Authorization).toBe('Bearer bearer-tok');
  expect(config.headers['X-Active-Vertical']).toBe('banking');
  expect(out.result.tools).toHaveLength(1);
});

test('discovery mode does not special-route (no /mcp/apikey|weather|brave paths)', async () => {
  axios.post = jest.fn().mockResolvedValue({
    status: 200, headers: {}, data: { jsonrpc: '2.0', id: 'c2', result: { tools: [] } },
  });

  // get_weather WOULD route to /mcp/weather on a tool call; discovery must
  // ignore the tool and use the plain /mcp endpoint.
  await callToolViaGateway('https://api.ping.demo:3036', 'bearer-tok', 'get_weather', {}, {
    rpcMethod: 'tools/list',
    correlationId: 'c2',
  });

  const body = axios.post.mock.calls[0][1];
  expect(axios.post.mock.calls[0][0]).not.toBe('https://api.ping.demo:3036/mcp/weather');
  expect(body.method).toBe('tools/list');
});

test('a tools/list JSON-RPC error surfaces as a structured gateway error — never a success', async () => {
  axios.post = jest.fn().mockResolvedValue({
    status: 403,
    headers: {},
    data: { error: 'forbidden', message: 'PingAuthorize decision: DENY' },
  });

  await expect(
    callToolViaGateway('https://api.ping.demo:3036', 'bearer-tok', null, {}, {
      rpcMethod: 'tools/list',
      correlationId: 'c3',
    })
  ).rejects.toMatchObject({
    code: 'gateway_policy_denied',
    httpStatus: 403,
  });
});
