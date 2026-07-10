'use strict';

// Unit test for the X-BFF-Exchanged header that callToolViaGateway stamps when
// ff_gateway_brokered_exchange is OFF (bff-brokered) — the signal that tells the
// IG's olb-token-exchange.groovy to SKIP its exchange because the BFF already
// minted the mcp-server-audience token. Exercises BOTH feature flags together:
//   ff_mcp_gateway_pinggateway (routing) x ff_gateway_brokered_exchange (broker).
// The header is added ONLY when routing through PingGateway AND the broker flag
// is explicitly 'false'; default/unset preserves gateway-brokered behavior (no
// header), and the Node-gateway path never sees it.

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

describe('callToolViaGateway X-BFF-Exchanged header (both feature flags)', () => {
  beforeEach(() => {
    mockGetEffective.mockReset();
    axios.post.mockReset();
    axios.post.mockResolvedValue(okResponse());
  });

  test('pinggateway ON + brokered OFF -> X-BFF-Exchanged: true (bff-brokered)', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'true', ff_gateway_brokered_exchange: 'false' });

    await callToolViaGateway('http://ping-gateway:8080', 'tok', 'get_accounts', {});

    expect(lastHeaders()['X-BFF-Exchanged']).toBe('true');
  });

  test('pinggateway ON + brokered ON -> no X-BFF-Exchanged (gateway-brokered)', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'true', ff_gateway_brokered_exchange: 'true' });

    await callToolViaGateway('http://ping-gateway:8080', 'tok', 'get_accounts', {});

    expect(lastHeaders()).not.toHaveProperty('X-BFF-Exchanged');
  });

  test('pinggateway ON + brokered unset -> no X-BFF-Exchanged (default gateway-brokered)', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'true' });

    await callToolViaGateway('http://ping-gateway:8080', 'tok', 'get_accounts', {});

    expect(lastHeaders()).not.toHaveProperty('X-BFF-Exchanged');
  });

  test('pinggateway OFF + brokered OFF -> no X-BFF-Exchanged (Node path ignores broker flag)', async () => {
    stubConfig({ ff_mcp_gateway_pinggateway: 'false', ff_gateway_brokered_exchange: 'false' });

    await callToolViaGateway('http://mcp-gateway:3005', 'tok', 'get_accounts', {});

    expect(lastHeaders()).not.toHaveProperty('X-BFF-Exchanged');
  });
});
