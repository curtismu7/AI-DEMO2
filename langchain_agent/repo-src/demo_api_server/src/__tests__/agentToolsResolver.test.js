/**
 * resolveAvailableTools — cache reuse + write-toggle behavior.
 * Discovery uses the DELEGATED token (RFC 8693 via agentMcpTokenService), not the CC token.
 * setup.js runs jest.resetModules() per test, so require SUT + mocks INSIDE each test.
 */

jest.mock('../../services/agentMcpTokenService', () => ({ resolveMcpAccessTokenWithEvents: jest.fn() }));
jest.mock('../../services/agentGatewayClient', () => ({ listAvailableTools: jest.fn() }));
// resolveAgentScopes is real (reads the SoT); agentTokenCache is real (operates on req.session).

function makeReq() {
  return { session: {}, agentContext: { userId: 'user-sub-1' }, tokenEvents: [] };
}

describe('resolveAvailableTools', () => {
  it('exchanges a delegated token on first call and reuses it for the same (vertical, allowWrite)', async () => {
    const agentMcpTokenService = require('../../services/agentMcpTokenService');
    const agentGatewayClient = require('../../services/agentGatewayClient');
    const { resolveAvailableTools } = require('../../services/agentToolsResolver');

    // jest caches mock-factory fns across resetModules, so clear call history per test.
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockClear();
    agentGatewayClient.listAvailableTools.mockClear();
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({ token: 'delegated-jwt', userSub: 'user-sub-1' });
    agentGatewayClient.listAvailableTools.mockResolvedValue({
      tools: [
        { name: 'view_records', permitted: true },
        { name: 'book_appointment', permitted: false, deniedReason: 'requires write' },
      ],
    });

    const req = makeReq();
    const first = await resolveAvailableTools(req, { vertical: 'healthcare', allowWrite: false });
    const second = await resolveAvailableTools(req, { vertical: 'healthcare', allowWrite: false });

    // Exchanged once (second call hits the session cache), but tools re-listed both times.
    expect(agentMcpTokenService.resolveMcpAccessTokenWithEvents).toHaveBeenCalledTimes(1);
    expect(agentGatewayClient.listAvailableTools).toHaveBeenCalledTimes(2);
    // listAvailableTools receives the delegated token.
    expect(agentGatewayClient.listAvailableTools.mock.calls[0][1]).toBe('delegated-jwt');
    expect(first.availableTools.map((t) => t.name)).toEqual(['view_records', 'book_appointment']);
    expect(second.availableTools.find((t) => t.name === 'book_appointment').permitted).toBe(false);
  });

  it('flipping the write toggle is a cache miss and re-exchanges', async () => {
    const agentMcpTokenService = require('../../services/agentMcpTokenService');
    const agentGatewayClient = require('../../services/agentGatewayClient');
    const { resolveAvailableTools } = require('../../services/agentToolsResolver');

    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockClear();
    agentGatewayClient.listAvailableTools.mockClear();
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({ token: 'delegated-jwt', userSub: 'u1' });
    agentGatewayClient.listAvailableTools.mockResolvedValue({ tools: [] });

    const req = makeReq();
    await resolveAvailableTools(req, { vertical: 'healthcare', allowWrite: false });
    await resolveAvailableTools(req, { vertical: 'healthcare', allowWrite: true });

    expect(agentMcpTokenService.resolveMcpAccessTokenWithEvents).toHaveBeenCalledTimes(2);
  });

  it('drives the exchange scopeOverride from the write toggle (write only when allowWrite)', async () => {
    const agentMcpTokenService = require('../../services/agentMcpTokenService');
    const agentGatewayClient = require('../../services/agentGatewayClient');
    const { resolveAvailableTools } = require('../../services/agentToolsResolver');

    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockClear();
    agentGatewayClient.listAvailableTools.mockClear();
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({ token: 'delegated-jwt', userSub: 'u1' });
    agentGatewayClient.listAvailableTools.mockResolvedValue({ tools: [] });

    await resolveAvailableTools(makeReq(), { vertical: 'banking', allowWrite: true });
    const [, , opts] = agentMcpTokenService.resolveMcpAccessTokenWithEvents.mock.calls[0];
    expect(opts.scopeOverride).toEqual(expect.arrayContaining(['write']));

    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockClear();
    await resolveAvailableTools(makeReq(), { vertical: 'banking', allowWrite: false });
    const [, , optsRo] = agentMcpTokenService.resolveMcpAccessTokenWithEvents.mock.calls[0];
    expect(optsRo.scopeOverride).not.toContain('write');
  });

  it('surfaces need_auth when the exchange returns no token', async () => {
    const agentMcpTokenService = require('../../services/agentMcpTokenService');
    const { resolveAvailableTools } = require('../../services/agentToolsResolver');
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockClear();
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({ token: null, need_auth: true });
    await expect(resolveAvailableTools(makeReq(), { vertical: 'banking', allowWrite: false }))
      .rejects.toMatchObject({ code: 'need_auth', httpStatus: 401 });
  });
});
