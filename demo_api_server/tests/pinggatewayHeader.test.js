'use strict';

// Unit test for the X-Authz-Simulated header that callToolViaGateway stamps on
// PingGateway-bound requests. The BFF carries the effective ff_authorize_simulated
// value to PingGateway so its Groovy decision filter picks the live authorize
// backend (mock demo_authz_server vs real PingOne Authorize). The header is added
// ONLY when ff_mcp_gateway_pinggateway is ON, so the Node-gateway request shape
// is unchanged.

const mockGetEffective = jest.fn();
jest.mock('../services/configStore', () => ({
  getEffective: (...args) => mockGetEffective(...args),
}));
jest.mock('../services/mcpActorBridge', () => ({
  buildActorBridgeHeaders: () => ({}),
}));
jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const { callToolViaGateway } = require('../services/mcpGatewayClient');

function stubConfig(map = {}) {
  mockGetEffective.mockImplementation((key) => {
    if (key in map) return map[key];
    if (key === 'ff_mcp_gateway_pinggateway') return 'false';
    return undefined;
  });
}

function okResponse() {
  return {
    status: 200,
    data: { jsonrpc: '2.0', id: '1', result: { ok: true } },
    headers: {},
  };
}

function lastHeaders() {
  const call = axios.post.mock.calls[axios.post.mock.calls.length - 1];
  return call[2].headers;
}

describe('callToolViaGateway X-Authz-Simulated header', () => {
  beforeEach(() => {
    mockGetEffective.mockReset();
    axios.post.mockReset();
    axios.post.mockResolvedValue(okResponse());
  });

  test('flag ON + ff_authorize_simulated true -> X-Authz-Simulated: true', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'true', ff_authorize_simulated: 'true' });

    await callToolViaGateway('http://ping-gateway:8080', 'tok', 'get_accounts', {});

    expect(lastHeaders()['X-Authz-Simulated']).toBe('true');
  });

  test('flag ON + ff_authorize_simulated false -> X-Authz-Simulated: false', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'true', ff_authorize_simulated: 'false' });

    await callToolViaGateway('http://ping-gateway:8080', 'tok', 'get_accounts', {});

    expect(lastHeaders()['X-Authz-Simulated']).toBe('false');
  });

  test('flag OFF -> no X-Authz-Simulated header (Node path unchanged)', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'false', ff_authorize_simulated: 'true' });

    await callToolViaGateway('http://mcp-gateway:3005', 'tok', 'get_accounts', {});

    expect(lastHeaders()).not.toHaveProperty('X-Authz-Simulated');
  });
});
