'use strict';
// gateway.posture must describe the gateway the FLAGS put in the path.
//
// Live 2026-08-10, with ff_mcp_gateway_pinggateway ON, the card reported
// url=http://mcp-gateway:3005 / policySource=p1az-mock while every chip call
// went through PingGateway, whose own log said
// "[P1AZ] REQUEST -> REAL ... [P1AZ] DECISION: PERMIT | backend=real".
// Two cards under one "Agent Gateway" heading describing different components,
// one of them telling the presenter to trust it on stage.
//
// The check resolves both collaborators lazily, and src/__tests__/setup.js runs
// jest.resetModules() after EVERY test — so a module handle captured at file
// scope is a different jest.fn() from the one the check will require on the
// second test onward, and the assertions silently exercise the real modules.
// load() re-requires everything inside the test that uses it.

jest.mock('../../services/mcpGatewayClient', () => ({
  tryGetMcpGatewayHttpUrl: jest.fn(),
}));
jest.mock('../../routes/mcpGatewayConfig', () => ({
  probeGatewayHealth: jest.fn(),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => null) }));

const PG = 'http://ping-gateway:8080';
const NODE_GW = 'http://mcp-gateway:3005';

function load() {
  return {
    gwClient: require('../../services/mcpGatewayClient'),
    gwConfig: require('../../routes/mcpGatewayConfig'),
    check: require('../../services/checks/gatewayPostureCheck'),
  };
}

describe('gateway.posture follows the selected gateway', () => {
  const savedPg = process.env.MCP_PINGGATEWAY_URL;
  beforeEach(() => { process.env.MCP_PINGGATEWAY_URL = PG; });
  afterAll(() => {
    if (savedPg === undefined) delete process.env.MCP_PINGGATEWAY_URL;
    else process.env.MCP_PINGGATEWAY_URL = savedPg;
  });

  test('selectedGateway flags PingGateway when the resolver returns its URL', () => {
    const { gwClient, check } = load();
    gwClient.tryGetMcpGatewayHttpUrl.mockReturnValue(`${PG}/`);
    expect(check.selectedGateway()).toEqual({ url: PG, isPingGateway: true });
  });

  test('selectedGateway flags the Node gateway when the resolver returns its URL', () => {
    const { gwClient, check } = load();
    gwClient.tryGetMcpGatewayHttpUrl.mockReturnValue(NODE_GW);
    expect(check.selectedGateway()).toEqual({ url: NODE_GW, isPingGateway: false });
  });

  test('PingGateway ready -> reports the real PingOne Authorize engine, not p1az-mock', async () => {
    const { gwClient, gwConfig, check } = load();
    gwClient.tryGetMcpGatewayHttpUrl.mockReturnValue(PG);
    gwConfig.probeGatewayHealth.mockResolvedValue({ running: true, response: { ready: true } });

    const r = await check.posture.run({});
    expect(r.status).toBe('pass');
    expect(r.meta.gateway).toBe('pinggateway');
    expect(r.meta.engineIsReal).toBe(true);
    expect(r.meta.policySource).toBe('pingone-authorize');
    expect(r.meta.url).toBe(PG);
    // The Node gateway's local-policy story must not appear on the IG card.
    expect(r.detail).not.toMatch(/authz-server|p1az-mock|snapshot/i);
  });

  test('PingGateway 503 { ready:false } is a failure, not "unreachable"', async () => {
    const { gwClient, gwConfig, check } = load();
    gwClient.tryGetMcpGatewayHttpUrl.mockReturnValue(PG);
    gwConfig.probeGatewayHealth.mockResolvedValue({ running: false, response: { ready: false } });

    const r = await check.posture.run({});
    expect(r.status).toBe('fail');
    expect(r.meta.engineIsReal).toBe(false);
    expect(r.nextAction).toMatch(/P1AZ_REAL_BASE/);
  });

  test('PingGateway unreachable -> warn, engine unknown', async () => {
    const { gwClient, gwConfig, check } = load();
    gwClient.tryGetMcpGatewayHttpUrl.mockReturnValue(PG);
    gwConfig.probeGatewayHealth.mockResolvedValue({ running: false, response: null });

    const r = await check.posture.run({});
    expect(r.status).toBe('warn');
    expect(r.meta.engineIsReal).toBeNull();
  });

  test('Node gateway selected -> unchanged authz-block reporting', async () => {
    const { gwClient, gwConfig, check } = load();
    gwClient.tryGetMcpGatewayHttpUrl.mockReturnValue(NODE_GW);
    gwConfig.probeGatewayHealth.mockResolvedValue({
      running: true,
      response: { authz: { policySource: 'p1az-mock', enforcing: { dpop: true }, failOpen: [] } },
    });

    const r = await check.posture.run({});
    expect(r.status).toBe('warn');
    expect(r.meta.gateway).toBe('node');
    expect(r.meta.engineIsReal).toBe(false);
    expect(r.detail).toMatch(/authz-server/);
  });
});
