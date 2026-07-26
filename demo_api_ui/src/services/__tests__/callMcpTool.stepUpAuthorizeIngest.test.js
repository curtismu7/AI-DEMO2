/**
 * Regression: callMcpTool's !response.ok branch threw on 428
 * mcp_step_up_required without ingestAuthorize, so ProofOfEnforcement saw
 * useCaseId from tokenEvents but missing authorize-decision → Incomplete.
 *
 * setupTests aliases globalThis.localStorage → window.localStorage via a
 * getter; importing demoAgentService can recurse that chain. Install a
 * concrete mock before the dynamic import.
 */
const lsStore = Object.create(null);
const mockLocalStorage = {
  getItem: (key) => (Object.prototype.hasOwnProperty.call(lsStore, key) ? lsStore[key] : null),
  setItem: (key, value) => { lsStore[key] = String(value); },
  removeItem: (key) => { delete lsStore[key]; },
  clear: () => { Object.keys(lsStore).forEach((k) => { delete lsStore[k]; }); },
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, configurable: true, writable: true });
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, configurable: true, writable: true });

const { callMcpTool } = await import('../demoAgentService');
const { tokenChainTraceStore } = await import('../tokenChainTrace/tokenChainTraceStore');

describe('callMcpTool step-up 428 authorize ingest', () => {
  beforeEach(() => {
    tokenChainTraceStore.reset();
  });

  test('ingests mcpAuthorizeEvaluation from a 428 mcp_step_up_required body', async () => {
    const evaluation = {
      decision: 'INDETERMINATE',
      engine: 'simulated',
      decisionId: 'd-stepup',
      useCaseId: 'step-up-required',
    };
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 428,
        headers: { get: () => 'application/json' },
        json: () =>
          Promise.resolve({
            error: 'mcp_step_up_required',
            error_description: 'Step-up MFA required',
            tokenEvents: [{ id: 'user-token', useCaseId: 'step-up-required' }],
            mcpAuthorizeEvaluation: evaluation,
          }),
      }),
    );

    await expect(callMcpTool('create_transfer', { amount: 600 })).rejects.toMatchObject({
      statusCode: 428,
      code: 'mcp_step_up_required',
    });

    const snap = tokenChainTraceStore.getState();
    expect(snap.trace.authorize).toEqual(evaluation);
    expect(snap.trace.tokenEvents.some((e) => e && e.id === 'authorize-decision')).toBe(true);
    expect(snap.steps.find((s) => s.id === 'authorize').status).toBe('active');
  });

  test('preserves step_up_method=ciba on thrown mcp_step_up_required (CIBA chip path)', async () => {
    // runAction's catch must see step_up_method to open CIBA instead of MFA.
    // Dropping it made the CIBA chip satisfy step-up via in-session MFA.
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 428,
        headers: { get: () => 'application/json' },
        json: () =>
          Promise.resolve({
            error: 'mcp_step_up_required',
            error_description: 'Out-of-band approval required',
            step_up_method: 'ciba',
            step_up_acr: 'Multi_Factor',
            transaction_amount: 150,
            fromAccountId: 'acct-from',
            toAccountId: 'acct-to',
            tokenEvents: [{ id: 'user-token', useCaseId: 'ciba-out-of-band-approval' }],
          }),
      }),
    );

    await expect(callMcpTool('create_transfer', { amount: 150 })).rejects.toMatchObject({
      statusCode: 428,
      code: 'mcp_step_up_required',
      step_up_method: 'ciba',
      step_up_acr: 'Multi_Factor',
      transaction_amount: 150,
      fromAccountId: 'acct-from',
      toAccountId: 'acct-to',
    });
  });

  test('ingests mcpAuthorizeEvaluation from a 428 hitl_required body', async () => {
    const evaluation = {
      decision: 'INDETERMINATE',
      engine: 'simulated',
      decisionId: 'd-hitl',
      useCaseId: 'hitl-consent',
    };
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 428,
        headers: { get: () => 'application/json' },
        json: () =>
          Promise.resolve({
            error: 'hitl_required',
            tokenEvents: [{ id: 'user-token', useCaseId: 'hitl-consent' }],
            mcpAuthorizeEvaluation: evaluation,
          }),
      }),
    );

    await callMcpTool('create_transfer', { amount: 300 });

    const snap = tokenChainTraceStore.getState();
    expect(snap.trace.authorize).toEqual(evaluation);
    expect(snap.trace.tokenEvents.some((e) => e && e.id === 'authorize-decision')).toBe(true);
  });

  test('mcp_hitl_required 428 returns HITL result (not Error: MCP error: 428) and updates chain', async () => {
    const evaluation = {
      decision: 'INDETERMINATE',
      engine: 'simulated',
      decisionId: 'd-mcp-hitl',
      useCaseId: 'hitl-consent',
    };
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 428,
        headers: { get: () => 'application/json' },
        json: () =>
          Promise.resolve({
            error: 'mcp_hitl_required',
            error_description: 'Human consent required',
            tokenEvents: [
              { id: 'access-token', useCaseId: 'hitl-consent' },
              { id: 'token-exchange', useCaseId: 'hitl-consent', exchangeStep: 1 },
            ],
            mcpAuthorizeEvaluation: evaluation,
          }),
      }),
    );

    const out = await callMcpTool('create_transfer', { amount: 100 });
    expect(out.result.error).toBe('mcp_hitl_required');
    expect(out.tokenEvents.some((e) => e && e.id === 'authorize-decision')).toBe(true);

    const snap = tokenChainTraceStore.getState();
    expect(snap.trace.authorize).toEqual(evaluation);
    expect(snap.trace.tokenEvents.some((e) => e && e.id === 'authorize-decision')).toBe(true);
  });
});
