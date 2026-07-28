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

  it('resolves the verticalResult render descriptor from the SPECIALIST vertical, not the delegating one', async () => {
    // banking's manifest has no 'portfolio_summary' render key (that key only
    // exists in investment's) — delegateToSpecialist reports vertical:'banking'
    // (who delegated) alongside specialistVertical:'investment' (who owns the
    // tool + its render descriptor). Regression: looking the descriptor up
    // under `vertical` instead of `specialistVertical` resolves to null, and
    // the UI falls back to a raw JSON dump instead of the formatted card.
    a2a.delegateToSpecialist.mockImplementation((_req, opts) => Promise.resolve({
      token: 'NESTED.ACT.TOKEN',
      userSub: 'user',
      vertical: opts.vertical,
      specialistVertical: 'investment',
      specialist: 'Investment Advisor',
      tool: 'get_portfolio_summary',
      scopes: ['invest:read'],
      actChainDepth: 2,
    }));
    // The descriptor lookup reads verticalManifest.loader's cache, which is only
    // populated by init() (normally called once at server startup).
    require('../../services/verticalManifest').verticalManifest.init();
    const heuristic = { vertical: 'banking', action: 'delegate_to_specialist', params: {} };
    const out = await svc.__test.dispatchVerticalIntent(heuristic, {
      userId: 'u1', userToken: 't', req: { sessionID: 's1' }, tokenEvents: [], sessionId: 's1',
    });

    expect(out.verticalResult).toBeTruthy();
    expect(out.verticalResult.render).toBe('portfolio_summary');
    expect(out.verticalResult.descriptor).toBeTruthy();
    expect(out.verticalResult.descriptor.type).toBe('fieldList');
  });
});
