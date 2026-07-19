'use strict';
/**
 * runPipelineForSim is the "full flow, not direct" entry point the attack sims
 * (UC10/UC13) use — same production deps as a real chip/agent call. Verify it
 * (a) throws a clear error instead of silently no-opping when deps are unwired,
 * and (b) forwards ctx to runMcpToolPipeline with the wired deps, unmodified.
 */

const mockRunMcpToolPipeline = jest.fn();

jest.mock('../../services/mcpToolPipeline', () => ({
  runMcpToolPipeline: (...args) => mockRunMcpToolPipeline(...args),
}));

// Avoid pulling in the real, heavier modules these files require transitively.
jest.mock('../../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(),
}));
jest.mock('../../services/verticalDispatch', () => ({ isPluginToolName: () => false }));
jest.mock('../../services/customerTokenGuard', () => ({
  isAdminClientToken: () => false, isCustomerBankingTool: () => false, ADMIN_TOKEN_ON_CUSTOMER: {},
}));
jest.mock('../../config/useCases', () => ({ deriveUseCaseId: () => 'derived', isValidUseCaseId: () => true }));
jest.mock('../../services/useCaseTagging', () => ({ stampUseCaseId: jest.fn(), stampVertical: jest.fn() }));
jest.mock('../../utils/mcpToolRegistry', () => ({ callMcpToolInternal: jest.fn() }));

const bffMcpToolExecutor = require('../../services/bffMcpToolExecutor');
const { runPipelineForSim, setPipelineDeps } = bffMcpToolExecutor;

beforeEach(() => {
  mockRunMcpToolPipeline.mockReset();
  setPipelineDeps(null);
});

describe('runPipelineForSim', () => {
  test('throws pipeline_unavailable when deps are unwired — never silently no-ops', async () => {
    await expect(runPipelineForSim({ tool: 'get_my_accounts', params: {}, req: {} }))
      .rejects.toMatchObject({ code: 'pipeline_unavailable' });
    expect(mockRunMcpToolPipeline).not.toHaveBeenCalled();
  });

  test('forwards tool/params/req/useCaseId to runMcpToolPipeline with the wired deps', async () => {
    const deps = { emit: jest.fn() };
    setPipelineDeps(deps);
    mockRunMcpToolPipeline.mockResolvedValue({ kind: 'result', httpStatus: 200, tokenEvents: [], body: {} });

    const req = { session: { user: { sub: 'u1' } }, body: { _testActClientId: 'rogue' } };
    const outcome = await runPipelineForSim({ tool: 'get_my_accounts', params: { a: 1 }, req, useCaseId: 'confused-deputy-actor-injection' });

    expect(mockRunMcpToolPipeline).toHaveBeenCalledTimes(1);
    const ctx = mockRunMcpToolPipeline.mock.calls[0][0];
    expect(ctx.tool).toBe('get_my_accounts');
    expect(ctx.params).toEqual({ a: 1 });
    expect(ctx.req).toBe(req);
    expect(ctx.useCaseId).toBe('confused-deputy-actor-injection');
    // deps.emit is a no-op fallback (req.body.flowTraceId absent) — same deps object forwarded.
    expect(ctx.deps.emit).toBe(deps.emit);
    expect(outcome.kind).toBe('result');
  });
});
