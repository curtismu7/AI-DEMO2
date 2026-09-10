'use strict';

// Task 6 of docs/superpowers/plans/2026-09-08-privilege-first-gateway.md.
//
// ff_mcp_gateway_privilege_first puts the PingOne Privilege AI Gateway in FRONT
// of whichever Agent Gateway is already selected. getMcpGatewayHttpUrl() is the
// single chokepoint every tool-call path funnels through (see its own comment),
// so the flag has to win THERE or the request keeps going straight to the Agent
// Gateway no matter what the flag says.
//
// Checked BEFORE the PingGateway branch on purpose: the two compose. Privilege
// in front, PingGateway behind, because the Agentic App's registered backend is
// what decides which Agent Gateway sits downstream.

jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));

const ENV = ['MCP_PRIVILEGE_GATEWAY_URL', 'MCP_FACADE_PRIVILEGE_GATEWAY_BASE', 'MCP_PINGGATEWAY_URL', 'MCP_DEMO_GATEWAY_URL', 'MCP_GATEWAY_HTTP_URL'];
const saved = {};

function load(flags) {
  const configStore = require('../services/configStore');
  configStore.getEffective.mockImplementation((key) => flags[key]);
  return require('../services/mcpGatewayClient');
}

describe('ff_mcp_gateway_privilege_first', () => {
  beforeEach(() => {
    jest.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.MCP_DEMO_GATEWAY_URL = 'http://mcp-gateway:3005';
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  it('OFF: the ladder is unchanged', () => {
    const { getMcpGatewayHttpUrl } = load({ ff_mcp_gateway_privilege_first: 'false' });
    expect(getMcpGatewayHttpUrl()).toBe('http://mcp-gateway:3005');
  });

  it('ON: a configured URL ending in /mcp is normalised — the client appends it', () => {
    // The console displays the door URL WITH /mcp, so an operator pastes it.
    // callToolViaGateway then appends its own, producing /agent-gateway/mcp/mcp
    // and a bare 404 — observed live 2026-09-10.
    process.env.MCP_PRIVILEGE_GATEWAY_URL = 'https://mcpgw.example/agent-gateway/mcp/';
    const { getMcpGatewayHttpUrl } = load({ ff_mcp_gateway_privilege_first: 'true' });
    expect(getMcpGatewayHttpUrl()).toBe('https://mcpgw.example/agent-gateway');
  });

  it('ON: the bare form is left alone', () => {
    process.env.MCP_PRIVILEGE_GATEWAY_URL = 'https://mcpgw.example/agent-gateway';
    const { getMcpGatewayHttpUrl } = load({ ff_mcp_gateway_privilege_first: 'true' });
    expect(getMcpGatewayHttpUrl()).toBe('https://mcpgw.example/agent-gateway');
  });

  it('ON: derives the door from the Privilege gateway base when no explicit URL is set', () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE = 'https://mcpgw.example/';
    const { getMcpGatewayHttpUrl } = load({ ff_mcp_gateway_privilege_first: 'true' });
    expect(getMcpGatewayHttpUrl()).toBe('https://mcpgw.example/agent-gateway');
  });

  it('ON: beats the PingGateway branch, so the two gateways compose front-to-back', () => {
    process.env.MCP_PRIVILEGE_GATEWAY_URL = 'https://mcpgw.example/agent-gateway';
    process.env.MCP_PINGGATEWAY_URL = 'https://ping-gateway:8080/mcp';
    const { getMcpGatewayHttpUrl } = load({
      ff_mcp_gateway_privilege_first: 'true',
      ff_mcp_gateway_pinggateway: 'true',
    });
    expect(getMcpGatewayHttpUrl()).toBe('https://mcpgw.example/agent-gateway');
  });

  it('ON but no Privilege URL resolvable: falls through rather than breaking every tool call', () => {
    const { getMcpGatewayHttpUrl } = load({ ff_mcp_gateway_privilege_first: 'true' });
    expect(getMcpGatewayHttpUrl()).toBe('http://mcp-gateway:3005');
  });
});
