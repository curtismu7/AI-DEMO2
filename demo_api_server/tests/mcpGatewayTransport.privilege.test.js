'use strict';

// Task 7 of docs/superpowers/plans/2026-09-08-privilege-first-gateway.md.
//
// With Privilege in front, the bearer the CALLER presents is no longer the
// bearer the hop needs: Privilege authenticates its own client and stamps the
// configured Static Token into Authorization on its backend hop. The user's
// exchanged token therefore has to travel in a header instead — X-Subject-Token,
// which was measured surviving the hop unmodified on 2026-09-10 (see
// privilege/CURRENT-CONFIGURATION.md, "Backend hop").
//
// The BFF cannot mint Privilege's own inbound credential, so this transport
// sends the user token in the header and leaves the Authorization slot to
// Privilege. The Agent Gateway end of the bridge is Task 8.

jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../services/bedrockPathGate', () => ({
  isBedrockGatewayEffective: jest.fn(() => false),
  assertBedrockPath: jest.fn(),
}));
jest.mock('../services/mcpGatewayClient', () => ({
  getMcpGatewayHttpUrl: jest.fn(() => 'https://mcpgw.example/agent-gateway/mcp'),
  callToolViaGateway: jest.fn(async () => ({ ok: true })),
}));

function load(flagValue) {
  const configStore = require('../services/configStore');
  configStore.getEffective.mockImplementation((k) => (k === 'ff_mcp_gateway_privilege_first' ? flagValue : undefined));
  return {
    transport: require('../services/mcpGatewayTransport'),
    client: require('../services/mcpGatewayClient'),
  };
}

describe('privilege-first MCP transport', () => {
  beforeEach(() => jest.resetModules());

  it('OFF: transport kind and call are untouched', async () => {
    const { transport, client } = load('false');
    expect(transport.resolveMcpGatewayTransport().kind).toBe('demo');
    await transport.callToolViaResolvedGateway('https://gw/mcp', 'USER-TOKEN', 'get_my_accounts', {}, {});
    const [, bearer, , , opts] = client.callToolViaGateway.mock.calls[0];
    expect(bearer).toBe('USER-TOKEN');
    expect(opts.extraHeaders).toBeUndefined();
  });

  it('ON: reports the privilege kind so the trace can name the front gateway', () => {
    const { transport } = load('true');
    const resolved = transport.resolveMcpGatewayTransport();
    expect(resolved.kind).toBe('privilege');
    expect(resolved.url).toBe('https://mcpgw.example/agent-gateway/mcp');
  });

  it('ON: the user token rides in X-Subject-Token, not the Authorization slot', async () => {
    const { transport, client } = load('true');
    await transport.callToolViaResolvedGateway('https://mcpgw.example/agent-gateway/mcp', 'USER-TOKEN', 'get_my_accounts', {}, {});
    const [, bearer, tool, , opts] = client.callToolViaGateway.mock.calls[0];
    expect(tool).toBe('get_my_accounts');
    expect(opts.extraHeaders['X-Subject-Token']).toBe('USER-TOKEN');
    // Privilege owns Authorization on its own backend hop; sending the user
    // token there too would be rejected as a foreign app's token.
    expect(bearer).toBe('');
  });

  it('ON: caller-supplied extra headers survive alongside the subject token', async () => {
    const { transport, client } = load('true');
    await transport.callToolViaResolvedGateway('https://gw/mcp', 'USER-TOKEN', 'get_weather', {}, {
      extraHeaders: { 'X-Active-Vertical': 'banking' },
    });
    const opts = client.callToolViaGateway.mock.calls[0][4];
    expect(opts.extraHeaders['X-Active-Vertical']).toBe('banking');
    expect(opts.extraHeaders['X-Subject-Token']).toBe('USER-TOKEN');
  });
});
