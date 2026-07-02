'use strict';

// Unit test for the X-Token-Validation header that callToolViaGateway stamps on
// PingGateway-bound requests. The BFF carries the effective ff_mcp_gateway_jwks
// value so the gateway selects the validation route per request: 'jwks' matches
// route 00-mcp-olb-jwks.json (local JWT validation), 'introspect' falls through
// to route 01-mcp-olb.json (RFC 7662 introspection, today's behavior). Added
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

describe('callToolViaGateway X-Token-Validation header', () => {
  beforeEach(() => {
    mockGetEffective.mockReset();
    axios.post.mockReset();
    axios.post.mockResolvedValue(okResponse());
  });

  test('gateway flag ON + ff_mcp_gateway_jwks true -> X-Token-Validation: jwks', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'true', ff_mcp_gateway_jwks: 'true' });

    await callToolViaGateway('http://ping-gateway:8080', 'tok', 'get_accounts', {});

    expect(lastHeaders()['X-Token-Validation']).toBe('jwks');
  });

  test('gateway flag ON + ff_mcp_gateway_jwks false -> X-Token-Validation: introspect', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'true', ff_mcp_gateway_jwks: 'false' });

    await callToolViaGateway('http://ping-gateway:8080', 'tok', 'get_accounts', {});

    expect(lastHeaders()['X-Token-Validation']).toBe('introspect');
  });

  test('gateway flag ON + jwks flag unset -> X-Token-Validation: introspect (safe default)', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'true' });

    await callToolViaGateway('http://ping-gateway:8080', 'tok', 'get_accounts', {});

    expect(lastHeaders()['X-Token-Validation']).toBe('introspect');
  });

  test('gateway flag OFF -> no X-Token-Validation header (Node path unchanged)', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'false', ff_mcp_gateway_jwks: 'true' });

    await callToolViaGateway('http://mcp-gateway:3005', 'tok', 'get_accounts', {});

    expect(lastHeaders()).not.toHaveProperty('X-Token-Validation');
  });
});
