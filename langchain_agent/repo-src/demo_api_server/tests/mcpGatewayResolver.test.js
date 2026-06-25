'use strict';

// Unit test for mcpGatewayClient.getMcpGatewayHttpUrl() resolution precedence.
//
// Guards two behaviors:
//  1. The env-first behavior that fixes the cold-start "ECONNREFUSED
//     127.0.0.1:3005" race: process.env.MCP_GATEWAY_HTTP_URL must win over the
//     configStore mcp_gateway_http_url value. See skill `mcp-gateway`.
//  2. ff_mcp_gateway_pinggateway routing: when the flag is ON and a PingGateway
//     URL is resolvable, the resolver returns it instead of the Node gateway —
//     so the flag actually re-routes the tool call (not just the token audience).

const mockGetEffective = jest.fn();
jest.mock('../services/configStore', () => ({
  getEffective: (...args) => mockGetEffective(...args),
}));

const { getMcpGatewayHttpUrl } = require('../services/mcpGatewayClient');

// Keyed configStore.getEffective stub: returns per-key values from a map,
// defaulting the PingGateway flag to 'false' so non-flag tests see the
// Node-gateway path.
function stubConfig(map = {}) {
  mockGetEffective.mockImplementation((key) => {
    if (key in map) return map[key];
    if (key === 'ff_mcp_gateway_pinggateway') return 'false';
    return undefined;
  });
}

describe('getMcpGatewayHttpUrl resolution precedence', () => {
  const ORIG_NODE = process.env.MCP_GATEWAY_HTTP_URL;
  const ORIG_PG = process.env.MCP_PINGGATEWAY_URL;

  beforeEach(() => {
    mockGetEffective.mockReset();
    delete process.env.MCP_GATEWAY_HTTP_URL;
    delete process.env.MCP_PINGGATEWAY_URL;
  });

  afterAll(() => {
    if (ORIG_NODE === undefined) delete process.env.MCP_GATEWAY_HTTP_URL;
    else process.env.MCP_GATEWAY_HTTP_URL = ORIG_NODE;
    if (ORIG_PG === undefined) delete process.env.MCP_PINGGATEWAY_URL;
    else process.env.MCP_PINGGATEWAY_URL = ORIG_PG;
  });

  test('env var wins over configStore mcp_gateway_http_url (prevents cold-start :3005 race)', () => {
    process.env.MCP_GATEWAY_HTTP_URL = 'http://mcp-server:8080';
    // configStore still returning the committed loopback default mid-seed:
    stubConfig({ mcp_gateway_http_url: 'https://api.ping.demo:3005' });

    expect(getMcpGatewayHttpUrl()).toBe('http://mcp-server:8080');
    // The Node-gateway configStore key is never consulted when the env var is set.
    expect(mockGetEffective).not.toHaveBeenCalledWith('mcp_gateway_http_url');
  });

  test('falls back to configStore when the env var is unset', () => {
    stubConfig({ mcp_gateway_http_url: 'https://api.ping.demo:3005' });

    expect(getMcpGatewayHttpUrl()).toBe('https://api.ping.demo:3005');
    expect(mockGetEffective).toHaveBeenCalledWith('mcp_gateway_http_url');
  });

  test('strips a single trailing slash', () => {
    process.env.MCP_GATEWAY_HTTP_URL = 'http://mcp-server:8080/';
    stubConfig();
    expect(getMcpGatewayHttpUrl()).toBe('http://mcp-server:8080');
  });

  test('throws when neither env nor configStore provides a URL', () => {
    stubConfig();
    expect(() => getMcpGatewayHttpUrl()).toThrow(/not configured/i);
  });
});

describe('getMcpGatewayHttpUrl ff_mcp_gateway_pinggateway routing', () => {
  const ORIG_NODE = process.env.MCP_GATEWAY_HTTP_URL;
  const ORIG_PG = process.env.MCP_PINGGATEWAY_URL;

  beforeEach(() => {
    mockGetEffective.mockReset();
    delete process.env.MCP_GATEWAY_HTTP_URL;
    delete process.env.MCP_PINGGATEWAY_URL;
  });

  afterAll(() => {
    if (ORIG_NODE === undefined) delete process.env.MCP_GATEWAY_HTTP_URL;
    else process.env.MCP_GATEWAY_HTTP_URL = ORIG_NODE;
    if (ORIG_PG === undefined) delete process.env.MCP_PINGGATEWAY_URL;
    else process.env.MCP_PINGGATEWAY_URL = ORIG_PG;
  });

  test('flag ON -> returns mcp_pinggateway_url (not the Node gateway)', () => {
    process.env.MCP_GATEWAY_HTTP_URL = 'http://mcp-gateway:3005';
    stubConfig({
      ff_mcp_gateway_pinggateway: 'true',
      mcp_pinggateway_url: 'https://api.ping.demo:3006',
    });

    expect(getMcpGatewayHttpUrl()).toBe('https://api.ping.demo:3006');
  });

  test('flag ON -> env MCP_PINGGATEWAY_URL wins over configStore mcp_pinggateway_url', () => {
    process.env.MCP_PINGGATEWAY_URL = 'http://ping-gateway:8080';
    stubConfig({
      ff_mcp_gateway_pinggateway: 'true',
      mcp_pinggateway_url: 'https://api.ping.demo:3006',
    });

    expect(getMcpGatewayHttpUrl()).toBe('http://ping-gateway:8080');
  });

  test('flag OFF -> returns the Node gateway URL', () => {
    process.env.MCP_GATEWAY_HTTP_URL = 'http://mcp-gateway:3005';
    stubConfig({
      ff_mcp_gateway_pinggateway: 'false',
      mcp_pinggateway_url: 'https://api.ping.demo:3006',
    });

    expect(getMcpGatewayHttpUrl()).toBe('http://mcp-gateway:3005');
  });

  test('flag ON but no PingGateway URL -> falls back to the Node gateway', () => {
    process.env.MCP_GATEWAY_HTTP_URL = 'http://mcp-gateway:3005';
    stubConfig({ ff_mcp_gateway_pinggateway: 'true' }); // no mcp_pinggateway_url

    expect(getMcpGatewayHttpUrl()).toBe('http://mcp-gateway:3005');
  });
});
