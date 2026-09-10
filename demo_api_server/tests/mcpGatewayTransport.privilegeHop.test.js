'use strict';

// When Privilege fronts the Agent Gateway it becomes a real enforcement point in
// the request path, so the transaction record has to show it — otherwise the
// reel and the trace draw a two-gate call as if only one gate existed.
//
// What this hop may honestly claim is narrow. Privilege is a third-party gateway
// and does not post to our hop endpoint, so we record only what the BFF actually
// observed: that the call was routed through Privilege, and what came back. A
// 403 is Privilege's own policy denial. Any other failure is NOT recorded as a
// denial, because a network error is not a policy decision.

jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../services/bedrockPathGate', () => ({
  isBedrockGatewayEffective: jest.fn(() => false),
  assertBedrockPath: jest.fn(),
}));
jest.mock('../services/transactionHop', () => ({ emitHop: jest.fn(), SERVICE: 'demo-api-server' }));
jest.mock('../services/mcpGatewayClient', () => ({
  getMcpGatewayHttpUrl: jest.fn(() => 'https://mcpgw.example/agent-gateway/mcp'),
  callToolViaGateway: jest.fn(async () => ({ ok: true })),
}));

function load(flagValue) {
  require('../services/configStore').getEffective.mockImplementation(
    (k) => (k === 'ff_mcp_gateway_privilege_first' ? flagValue : undefined),
  );
  return {
    transport: require('../services/mcpGatewayTransport'),
    client: require('../services/mcpGatewayClient'),
    hop: require('../services/transactionHop'),
  };
}

describe('privilege.authorize hop', () => {
  beforeEach(() => jest.resetModules());

  it('OFF: no Privilege hop is recorded — it was not in the path', async () => {
    const { transport, hop } = load('false');
    await transport.callToolViaResolvedGateway('https://gw/mcp', 'T', 'get_my_accounts', {}, {});
    expect(hop.emitHop).not.toHaveBeenCalled();
  });

  it('ON: a successful call records Privilege as a PERMIT ahead of the Agent Gateway', async () => {
    const { transport, hop } = load('true');
    await transport.callToolViaResolvedGateway('https://mcpgw.example/agent-gateway/mcp', 'T', 'get_my_accounts', {}, {});
    expect(hop.emitHop).toHaveBeenCalledTimes(1);
    const emitted = hop.emitHop.mock.calls[0][0];
    expect(emitted.phase).toBe('privilege.authorize');
    expect(emitted.op).toBe('get_my_accounts');
    expect(emitted.decision.outcome).toBe('PERMIT');
    // Timestamped at the START of the hop. The assembler orders by ts, so
    // stamping it on completion would draw Privilege AFTER the gateway it sits
    // in front of.
    expect(typeof emitted.ts).toBe('string');
    expect(Date.parse(emitted.ts)).not.toBeNaN();
  });

  it('ON: a 403 is recorded as Privilege denying by policy', async () => {
    const { transport, client, hop } = load('true');
    client.callToolViaGateway.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    await expect(transport.callToolViaResolvedGateway('https://gw/mcp', 'T', 'get_my_accounts', {}, {}))
      .rejects.toThrow('Forbidden');
    const emitted = hop.emitHop.mock.calls[0][0];
    expect(emitted.decision.outcome).toBe('DENY');
    expect(emitted.status).toBe('denied');
  });

  it('ON: a transport failure is NOT dressed up as a policy denial', async () => {
    const { transport, client, hop } = load('true');
    client.callToolViaGateway.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(transport.callToolViaResolvedGateway('https://gw/mcp', 'T', 'get_weather', {}, {}))
      .rejects.toThrow('ECONNREFUSED');
    const emitted = hop.emitHop.mock.calls[0][0];
    expect(emitted.status).toBe('error');
    expect(emitted.decision).toBeUndefined();
  });

  it('a failure to record a hop never breaks the tool call', async () => {
    const { transport, hop } = load('true');
    hop.emitHop.mockImplementation(() => { throw new Error('ledger down'); });
    await expect(transport.callToolViaResolvedGateway('https://gw/mcp', 'T', 'get_my_accounts', {}, {}))
      .resolves.toEqual({ ok: true });
  });
});
