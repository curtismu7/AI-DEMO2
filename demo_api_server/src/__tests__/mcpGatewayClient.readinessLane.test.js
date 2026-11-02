'use strict';

// A readiness lane BFF names its lane so the shared PingGateway sends its
// resource-server calls to the lane's own server (invest-dispatch.groovy).

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');
const previousLane = process.env.DEMO_READINESS_LANE;
const previousPingGatewayUrl = process.env.MCP_PINGGATEWAY_URL;

beforeEach(() => {
  process.env.MCP_PINGGATEWAY_URL = 'http://ping-gateway:8080';
  axios.post = jest.fn().mockResolvedValue({
    status: 200,
    headers: {},
    data: { jsonrpc: '2.0', id: '1', result: { content: [{ text: '{}' }] } },
  });
});

afterEach(() => {
  if (previousLane === undefined) delete process.env.DEMO_READINESS_LANE;
  else process.env.DEMO_READINESS_LANE = previousLane;
});

afterAll(() => {
  if (previousPingGatewayUrl === undefined) delete process.env.MCP_PINGGATEWAY_URL;
  else process.env.MCP_PINGGATEWAY_URL = previousPingGatewayUrl;
});

const sentHeaders = async () => {
  await callToolViaGateway('http://ping-gateway:8080', 'bearer-tok', 'get_portfolio_summary', {}, {});
  return axios.post.mock.calls[0][2].headers;
};

test('a lane BFF sends X-Readiness-Lane with its lane name', async () => {
  process.env.DEMO_READINESS_LANE = 'pingfederate';
  expect((await sentHeaders())['X-Readiness-Lane']).toBe('pingfederate');
});

test('the presenter BFF sends no lane header', async () => {
  delete process.env.DEMO_READINESS_LANE;
  expect((await sentHeaders())['X-Readiness-Lane']).toBeUndefined();
});
