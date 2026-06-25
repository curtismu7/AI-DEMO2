// demo_api_server/src/__tests__/agentToolsResolver.degraded.test.js
jest.mock('../../services/agentScopes', () => ({ resolveAgentScopes: () => ['read'] }));
jest.mock('../../services/agentTokenCache', () => ({
  get: () => ({ access_token: 'tok', expires_in: 600 }),
  set: () => {},
}));
jest.mock('../../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(),
}));
jest.mock('../../services/agentGatewayClient', () => ({
  listAvailableTools: jest.fn(),
  getLocalToolsCatalog: () => [
    { name: 'get_my_accounts', requiredScopes: ['read'], readOnly: true },
  ],
}));

const gw = require('../../services/agentGatewayClient');
const { resolveAvailableTools } = require('../../services/agentToolsResolver');

const req = { session: {}, agentContext: { userId: 'u1' }, tokenEvents: [] };

describe('resolveAvailableTools degraded fallback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retries with backoff then returns the local catalog with degraded=true', async () => {
    gw.listAvailableTools
      .mockRejectedValueOnce(new Error('ws closed'))
      .mockRejectedValueOnce(new Error('ws closed again'))
      .mockRejectedValueOnce(new Error('ws closed thrice'));
    const res = await resolveAvailableTools(req, { vertical: 'banking', allowWrite: true });
    expect(gw.listAvailableTools).toHaveBeenCalledTimes(3);
    expect(res.degraded).toBe(true);
    expect(res.degradedReason).toBe('discovery_unreachable');
    expect(res.availableTools.every((t) => t.permitted === true)).toBe(true);
    expect(res.availableTools[0].name).toBe('get_my_accounts');
  });

  it('does not fall back when discovery succeeds on retry', async () => {
    gw.listAvailableTools
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce({ tools: [{ name: 'x', permitted: true }] });
    const res = await resolveAvailableTools(req, { vertical: 'banking', allowWrite: true });
    expect(res.degraded).toBeFalsy();
    expect(res.availableTools[0].name).toBe('x');
  });

  it('rethrows a need_auth error without degrading', async () => {
    const e = new Error('Session expired'); e.code = 'need_auth'; e.httpStatus = 401;
    gw.listAvailableTools.mockRejectedValue(e);
    await expect(resolveAvailableTools(req, { vertical: 'banking', allowWrite: true }))
      .rejects.toMatchObject({ code: 'need_auth' });
  });

  it('marks degraded when the gateway reports a mock-failover engine', async () => {
    gw.listAvailableTools.mockResolvedValueOnce({
      tools: [{ name: 'x', permitted: true }],
      authzEngine: 'mock-failover',
    });
    const res = await resolveAvailableTools(req, { vertical: 'banking', allowWrite: true });
    expect(res.degraded).toBe(true);
    expect(res.degradedReason).toBe('authz_failover');
  });
});
