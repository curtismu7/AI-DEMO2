/**
 * @file a2aExecution.test.js
 * The delegate_to_specialist interception runs Exchange #1 ONLY, sends that
 * delegated token over the A2A wire hop as the bearer, and maps the
 * specialist's data-only reply back into an unchanged output contract.
 *
 * Exchange #2, the tool call and the REGRESSION_PLAN §1 locked PERMIT-gated
 * local serve now run inside the specialist executor — they are covered by
 * tests/a2aSpecialistExecutor.test.js, which owns those locked cases.
 */

jest.mock('../../services/a2aDelegationService', () => ({ exchangeAsGeneralist: jest.fn() }));
jest.mock('../../services/a2aProtocolClient', () => ({ sendA2aProtocolHandoff: jest.fn() }));

jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(),
  executeBffToolWithToken: jest.fn(),
  callMcpToolAsAgent: jest.fn(),
  setPipelineDeps: jest.fn(),
}));

const HAPPY_GENERALIST = (_req, opts) => {
  (opts.tokenEvents || []).push({ id: 'a2a-exchange1', claims: { sub: 'user', act: { sub: 'gen' } } });
  return Promise.resolve({
    token: 'T.AGENT1',
    userSub: 'user',
    vertical: opts.vertical,
    specialist: 'Investment Advisor',
    specialistAppKey: 'investment',
    specialistVertical: 'investment',
    tool: 'get_portfolio_summary',
    scopes: ['invest:read'],
  });
};

// The specialist's own legs happen behind the hop; it reports their outcome.
const HAPPY_HANDOFF = ({ tokenEvents }) => {
  (tokenEvents || []).push({
    id: 'a2a-exchange2',
    claims: { sub: 'user', act: { sub: 'spec', act: { sub: 'gen' } } },
  });
  return Promise.resolve({
    ok: true,
    tokenEvents,
    result: { positions: [{ symbol: 'VTI' }] },
    toolError: null,
    actChainDepth: 2,
    scopes: ['invest:read'],
  });
};

describe('A2A execution wiring', () => {
  // setup.js runs jest.resetModules() afterEach, so re-require fresh each test to
  // keep svc / a2a / client in the same module graph as the lazy require inside
  // executeA2aDelegation.
  let svc, a2a, client, executor;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = require('../../services/demoAgentLangGraphService');
    a2a = require('../../services/a2aDelegationService');
    client = require('../../services/a2aProtocolClient');
    executor = require('../../services/bffMcpToolExecutor');
  });

  it('runs Exchange #1 and hands that delegated token to the wire hop as the bearer', async () => {
    a2a.exchangeAsGeneralist.mockImplementation(HAPPY_GENERALIST);
    client.sendA2aProtocolHandoff.mockImplementation(HAPPY_HANDOFF);
    const tokenEvents = [];
    const out = await svc.__test.executeA2aDelegation('banking', { subtask: 'positions' }, { req: { sessionID: 's1' }, tokenEvents, sessionId: 's1' });
    const parsed = JSON.parse(out);

    expect(parsed.delegated).toBe(true);
    expect(parsed.specialist).toBe('Investment Advisor');
    expect(parsed.tool).toBe('get_portfolio_summary');
    expect(parsed.result).toEqual({ positions: [{ symbol: 'VTI' }] });
    expect(parsed.toolError).toBeNull();
    expect(parsed.actChainDepth).toBe(2);
    expect(parsed.scopes).toEqual(['invest:read']);

    // The hop carries the Exchange #1 token and the tool to authorize against.
    expect(client.sendA2aProtocolHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        vertical: 'banking',
        subjectToken: 'T.AGENT1',
        tool: 'get_portfolio_summary',
      }),
    );
    // The generalist no longer calls the specialist's tool itself.
    expect(executor.executeBffToolWithToken).not.toHaveBeenCalled();

    // Both halves' events flowed onto the ONE shared chain (→ SSE/UI): Exchange
    // #1 from this side, Exchange #2 from the specialist through ctx.tokenEvents.
    expect(tokenEvents.some((e) => e.id === 'a2a-exchange1')).toBe(true);
    expect(tokenEvents.some((e) => e.id === 'a2a-exchange2')).toBe(true);
  });

  // The orchestrator's coordinator picks an investment tool without arguments.
  it.each(['get_investment_balance', 'get_investment_transactions', 'get_portfolio_summary'])(
    'fills the first portfolio as account_id for %s, which requires one',
    async (tool) => {
      a2a.exchangeAsGeneralist.mockImplementation((_req, opts) => HAPPY_GENERALIST(_req, opts).then((r) => ({ ...r, tool })));
      client.sendA2aProtocolHandoff.mockImplementation(HAPPY_HANDOFF);
      require('../../services/verticalManifest').verticalManifest.init();
      const verticalDispatch = require('../../services/verticalDispatch');
      jest.spyOn(verticalDispatch, 'resolvePlugin').mockReturnValue({
        getDataStore: () => ({ get: () => ({ portfolios: [{ id: 'PF-01' }] }) }),
      });
      await svc.__test.executeA2aDelegation('banking', { tool }, { req: { sessionID: 's1', session: { user: { id: 'u1' } } }, tokenEvents: [], sessionId: 's1' });
      expect(client.sendA2aProtocolHandoff.mock.calls[0][0].toolArgs).toMatchObject({ account_id: 'PF-01' });
    },
  );

  it('does not invent an account_id for a tool that takes none', async () => {
    a2a.exchangeAsGeneralist.mockImplementation((_req, opts) => HAPPY_GENERALIST(_req, opts).then((r) => ({ ...r, tool: 'get_investment_accounts' })));
    client.sendA2aProtocolHandoff.mockImplementation(HAPPY_HANDOFF);
    await svc.__test.executeA2aDelegation('banking', { tool: 'get_investment_accounts' }, { req: { sessionID: 's1' }, tokenEvents: [], sessionId: 's1' });
    expect(client.sendA2aProtocolHandoff.mock.calls[0][0].toolArgs).not.toHaveProperty('account_id');
  });

  it('returns delegated:false and runs no tool when Exchange #1 minted nothing', async () => {
    a2a.exchangeAsGeneralist.mockImplementation(() => Promise.resolve({ error: 'A2A delegation is disabled', token: null }));
    const out = await svc.__test.executeA2aDelegation('banking', {}, { req: {}, tokenEvents: [], sessionId: 's' });
    const parsed = JSON.parse(out);

    expect(parsed.delegated).toBe(false);
    expect(parsed.error).toMatch(/disabled/);
    expect(client.sendA2aProtocolHandoff).not.toHaveBeenCalled();
    expect(executor.executeBffToolWithToken).not.toHaveBeenCalled();
  });

  // No soft-fail: a refused or broken hop is not a delegation. Before this, the
  // wire hop was detached and its failure could not be reported at all.
  it('reports delegated:false with the hop code when the wire hop fails, and runs no tool', async () => {
    a2a.exchangeAsGeneralist.mockImplementation(HAPPY_GENERALIST);
    client.sendA2aProtocolHandoff.mockImplementation(({ tokenEvents }) => Promise.resolve({
      ok: false, tokenEvents, error: 'unauthorized', code: 'a2a_unauthorized',
    }));

    const out = await svc.__test.executeA2aDelegation('banking', { subtask: 'positions' }, { req: { sessionID: 's1' }, tokenEvents: [], sessionId: 's1' });
    const parsed = JSON.parse(out);

    expect(parsed.delegated).toBe(false);
    expect(parsed.error).toBe('a2a_unauthorized');
    expect(executor.executeBffToolWithToken).not.toHaveBeenCalled();
  });

  it('resolves the verticalResult render descriptor from the SPECIALIST vertical, not the delegating one', async () => {
    // banking's manifest has no 'portfolio_summary' render key (that key only
    // exists in investment's) — Exchange #1 reports vertical:'banking' (who
    // delegated) alongside specialistVertical:'investment' (who owns the tool +
    // its render descriptor). Regression: looking the descriptor up under
    // `vertical` instead of `specialistVertical` resolves to null, and the UI
    // falls back to a raw JSON dump instead of the formatted card.
    a2a.exchangeAsGeneralist.mockImplementation(HAPPY_GENERALIST);
    client.sendA2aProtocolHandoff.mockImplementation(HAPPY_HANDOFF);
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

  // PingOne Authorize holds a consent tool the specialist calls (PingFederate
  // A2A, 2026-10-31): the gateway answers 428 with a challenge, which reaches
  // the user as the same approval envelope a held vertical tool gets.
  it('surfaces a held specialist call as hitl_required with the challenge, and the retry carries the receipt', async () => {
    a2a.exchangeAsGeneralist.mockImplementation(HAPPY_GENERALIST);
    client.sendA2aProtocolHandoff.mockImplementation(({ tokenEvents }) => Promise.resolve({
      ok: true, tokenEvents, result: { error: 'hitl_required', challengeId: 'ch-1' }, toolError: 'hitl_required', actChainDepth: 2, scopes: [],
    }));
    const heuristic = { vertical: 'banking', action: 'delegate_to_specialist', params: {} };
    const opts = { userId: 'u1', userToken: 't', req: { sessionID: 's1' }, tokenEvents: [], sessionId: 's1' };
    const held = await svc.__test.dispatchVerticalIntent(heuristic, opts);

    expect(held).toMatchObject({ success: false, error: 'hitl_required', hitlChallengeId: 'ch-1', action: 'get_portfolio_summary' });
    expect(client.sendA2aProtocolHandoff.mock.calls[0][0].toolArgs).not.toHaveProperty('_hitl_challenge_id');

    client.sendA2aProtocolHandoff.mockImplementation(HAPPY_HANDOFF);
    const retried = await svc.__test.dispatchVerticalIntent(heuristic, { ...opts, hitlChallengeId: 'ch-1' });

    expect(client.sendA2aProtocolHandoff.mock.calls[1][0].toolArgs).toMatchObject({ _hitl_challenge_id: 'ch-1' });
    expect(retried).toMatchObject({ success: true });
    expect(retried.error).toBeUndefined();
  });

  it('a specialist tool error that is not a hold stays a plain failure', async () => {
    a2a.exchangeAsGeneralist.mockImplementation(HAPPY_GENERALIST);
    client.sendA2aProtocolHandoff.mockImplementation(({ tokenEvents }) => Promise.resolve({
      ok: true, tokenEvents, result: { error: 'mcp_error' }, toolError: 'mcp_error', actChainDepth: 2, scopes: [],
    }));
    const out = await svc.__test.dispatchVerticalIntent({ vertical: 'banking', action: 'delegate_to_specialist', params: {} }, {
      userId: 'u1', userToken: 't', req: { sessionID: 's1' }, tokenEvents: [], sessionId: 's1',
    });
    expect(out).toMatchObject({ success: false, reply: expect.stringContaining('mcp_error') });
    expect(out.hitlChallengeId).toBeUndefined();
  });
});
