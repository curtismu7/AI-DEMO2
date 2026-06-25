/**
 * @file a2aExecution.test.js
 * Slice 3b: the delegate_to_specialist interception mints the nested-act token,
 * then executes the specialist's tool WITH that token (executeBffToolWithToken →
 * the suppliedToken pipeline path), and returns the real tool result.
 */

jest.mock('../../services/a2aDelegationService', () => ({ delegateToSpecialist: jest.fn() }));

const HAPPY_DELEGATION = (req, opts) => {
  (opts.tokenEvents || []).push({ id: 'a2a-exchange2', claims: { sub: 'user', act: { sub: 'spec', act: { sub: 'gen' } } } });
  return Promise.resolve({
    token: 'NESTED.ACT.TOKEN',
    userSub: 'user',
    vertical: opts.vertical,
    specialist: 'Investment Advisor',
    tool: 'get_portfolio_summary',
    scopes: ['invest:read'],
    actChainDepth: 2,
  });
};

jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(),
  executeBffToolWithToken: jest.fn(async (o) => JSON.stringify({ positions: [{ symbol: 'VTI' }], _sawToken: o.suppliedToken })),
  callMcpToolAsAgent: jest.fn(),
  setPipelineDeps: jest.fn(),
}));

describe('A2A execution wiring (Slice 3b)', () => {
  // setup.js runs jest.resetModules() afterEach, so re-require fresh each test to
  // keep svc / a2a / executor in the same module graph as the lazy require inside
  // executeA2aDelegation.
  let svc, a2a, executor;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = require('../../services/demoAgentLangGraphService');
    a2a = require('../../services/a2aDelegationService');
    executor = require('../../services/bffMcpToolExecutor');
  });

  it('delegates, then executes the specialist tool with the nested-act token', async () => {
    a2a.delegateToSpecialist.mockImplementation(HAPPY_DELEGATION);
    const tokenEvents = [];
    const out = await svc.__test.executeA2aDelegation('banking', { subtask: 'positions' }, { req: { sessionID: 's1' }, tokenEvents, sessionId: 's1' });
    const parsed = JSON.parse(out);

    expect(parsed.delegated).toBe(true);
    expect(parsed.specialist).toBe('Investment Advisor');
    expect(parsed.tool).toBe('get_portfolio_summary');

    // The tool ran with the PRE-MINTED nested-act token (not a fresh exchange).
    expect(executor.executeBffToolWithToken).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'get_portfolio_summary', suppliedToken: 'NESTED.ACT.TOKEN', suppliedUserSub: 'user' }),
    );
    expect(parsed.result).toEqual({ positions: [{ symbol: 'VTI' }], _sawToken: 'NESTED.ACT.TOKEN' });

    // The chained-exchange token events flowed onto the shared chain (→ SSE/UI).
    expect(tokenEvents.some((e) => e.id === 'a2a-exchange2')).toBe(true);
  });

  it('returns delegated:false and runs no tool when no token was minted', async () => {
    a2a.delegateToSpecialist.mockImplementation(() => Promise.resolve({ error: 'A2A delegation is disabled', token: null }));
    const out = await svc.__test.executeA2aDelegation('banking', {}, { req: {}, tokenEvents: [], sessionId: 's' });
    const parsed = JSON.parse(out);

    expect(parsed.delegated).toBe(false);
    expect(parsed.error).toMatch(/disabled/);
    expect(executor.executeBffToolWithToken).not.toHaveBeenCalled();
  });
});
