// demo_api_server/tests/mcpGatewayRouting.privilegeFirst.real.test.js
'use strict';
/**
 * With ff_mcp_gateway_privilege_first ON, a regular vertical tool call must reach the
 * Privilege door, not PingGateway.
 *
 * The existing privilege-first tests mock callToolViaGateway, so they never exercise
 * its routing. This one runs the REAL transport and the REAL client and mocks only
 * axios, then reads where the request went. The caller passes the PingGateway URL as
 * gatewayUrl, exactly as mcpToolPipeline.js does for every regular tool.
 */

const PRIVILEGE = 'https://mcpgw.example/agent-gateway';
const PINGGATEWAY = 'https://pinggateway.example';
const NODE_GATEWAY = 'https://node-gateway.example';

async function run({ flag, tool = 'get_my_accounts', gatewayUrl = PINGGATEWAY }) {
  jest.resetModules();
  const sent = [];
  jest.doMock('axios', () => ({
    post: jest.fn(async (url, body, cfg) => {
      sent.push({ url, headers: (cfg && cfg.headers) || {} });
      return { status: 200, headers: {}, data: { jsonrpc: '2.0', id: 1, result: { content: [] } } };
    }),
    get: jest.fn(async () => ({ status: 200, headers: {}, data: {} })),
  }));
  jest.doMock('../services/bedrockPathGate', () => ({
    isBedrockGatewayEffective: jest.fn(() => false),
    assertBedrockPath: jest.fn(),
  }));
  jest.doMock('../services/privilegeGatewaySession', () => ({
    getAccessToken: jest.fn(async () => 'PRIVILEGE-SESSION-TOKEN'),
  }));
  jest.doMock('../services/mcpToolAuthorizationService', () => ({ resolveResourceOwnerId: jest.fn() }));
  const configStore = require('../services/configStore');
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => {
    if (k === 'ff_mcp_gateway_privilege_first') return flag ? 'true' : 'false';
    if (k === 'mcp_pinggateway_url') return PINGGATEWAY;
    if (k === 'mcp_demo_gateway_url') return NODE_GATEWAY;
    return undefined;
  });
  process.env.MCP_PRIVILEGE_GATEWAY_URL = PRIVILEGE;
  process.env.MCP_PINGGATEWAY_URL = PINGGATEWAY;
  process.env.MCP_DEMO_GATEWAY_URL = NODE_GATEWAY;
  const { callToolViaResolvedGateway } = require('../services/mcpGatewayTransport');
  try {
    await callToolViaResolvedGateway(gatewayUrl, 'USER-TOKEN', tool, {}, {});
  } catch (_) { /* what is asserted is where the request went, not the reply shape */ }
  return sent;
}

describe('privilege-first routing through the real client', () => {
  afterEach(() => {
    delete process.env.MCP_PRIVILEGE_GATEWAY_URL;
    delete process.env.MCP_PINGGATEWAY_URL;
    delete process.env.MCP_DEMO_GATEWAY_URL;
  });

  it('OFF: a regular tool goes to PingGateway, as before', async () => {
    const sent = await run({ flag: false });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${PINGGATEWAY}/mcp`);
  });

  it('ON: a regular tool goes to the Privilege door, not PingGateway', async () => {
    const sent = await run({ flag: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${PRIVILEGE}/mcp`);
  });

  it('ON: the Privilege session token is the bearer and the user token rides in tx-token', async () => {
    const sent = await run({ flag: true });
    expect(sent[0].headers.Authorization).toBe('Bearer PRIVILEGE-SESSION-TOKEN');
    expect(sent[0].headers['tx-token']).toBe('USER-TOKEN');
  });

  it('ON: nothing is sent to PingGateway or the Node gateway', async () => {
    const sent = await run({ flag: true });
    expect(sent.filter((s) => s.url.startsWith(PINGGATEWAY) || s.url.startsWith(NODE_GATEWAY))).toEqual([]);
  });
});
