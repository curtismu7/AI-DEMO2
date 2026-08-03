'use strict';

/**
 * Discovery (tools/list) is WebSocket-only. PingGateway (IG) is the HTTP
 * transport — it routes /health, /mcp* and /aam and serves no WebSocket
 * listener — so deriving the discovery WS URL from MCP_GATEWAY_HTTP_URL dials
 * IG's unrouted origin, the handshake 404s, and every vertical silently
 * degrades to the local catalog (losing Authorize-filtered chip affordance).
 */

jest.mock('../services/configStore', () => ({ getEffective: () => undefined }));

const PINGGATEWAY = 'http://ping-gateway:8080';
const NODE_GATEWAY = 'http://mcp-gateway:3005';

const ENV_KEYS = ['MCP_GATEWAY_HTTP_URL', 'MCP_PINGGATEWAY_URL', 'MCP_DEMO_GATEWAY_URL'];

function load(env) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  jest.resetModules();
  return require('../services/mcpWebSocketClient').getMcpGatewayWsUrl();
}

describe('getMcpGatewayWsUrl', () => {
  const saved = {};
  beforeAll(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('PingGateway mode targets the Node gateway, not IG', () => {
    expect(load({
      MCP_GATEWAY_HTTP_URL: PINGGATEWAY,
      MCP_PINGGATEWAY_URL: PINGGATEWAY,
      MCP_DEMO_GATEWAY_URL: NODE_GATEWAY,
    })).toBe('ws://mcp-gateway:3005');
  });

  test('trailing slashes do not defeat the PingGateway match', () => {
    expect(load({
      MCP_GATEWAY_HTTP_URL: `${PINGGATEWAY}/`,
      MCP_PINGGATEWAY_URL: PINGGATEWAY,
      MCP_DEMO_GATEWAY_URL: NODE_GATEWAY,
    })).toBe('ws://mcp-gateway:3005');
  });

  test('Node-gateway mode is left alone', () => {
    expect(load({
      MCP_GATEWAY_HTTP_URL: NODE_GATEWAY,
      MCP_PINGGATEWAY_URL: PINGGATEWAY,
      MCP_DEMO_GATEWAY_URL: NODE_GATEWAY,
    })).toBe('ws://mcp-gateway:3005');
  });

  test('https becomes wss', () => {
    expect(load({ MCP_GATEWAY_HTTP_URL: 'https://api.ping.demo:3005' }))
      .toBe('wss://api.ping.demo:3005');
  });

  test('no gateway configured returns null', () => {
    expect(load({})).toBeNull();
  });
});
