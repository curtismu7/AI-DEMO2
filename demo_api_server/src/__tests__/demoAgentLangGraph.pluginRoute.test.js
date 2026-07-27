jest.mock('../../services/verticalDispatch', () => ({
  hasPlugin: jest.fn(),
  toolSchemasFor: jest.fn(),
  executeToolFor: jest.fn(),
  isPluginToolName: jest.fn(() => false),
}));
jest.mock('../../services/scopeTopology', () => ({
  ...jest.requireActual('../../services/scopeTopology'),
  isA2aDelegatedTool: jest.fn(),
}));
jest.mock('../../services/a2aDelegationService', () => ({
  isA2aEnabled: jest.fn(),
  delegateToSpecialist: jest.fn(),
}));
jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(),
  executeBffToolWithToken: jest.fn(),
}));
const dispatch = require('../../services/verticalDispatch');
const { executeBffToolWithToken } = require('../../services/bffMcpToolExecutor');
const { __test } = require('../../services/demoAgentLangGraphService');

// scopeTopology / a2aDelegationService are LAZILY required INSIDE
// resolveExecuteTool's returned closure (called fresh on every invocation),
// unlike verticalDispatch/bffMcpToolExecutor above which demoAgentLangGraphService
// requires once at its own module top. setup.js's global `afterEach(jest.resetModules())`
// invalidates the module registry after every test, so a lazy require done LATER
// (inside the SUT, at call time) resolves to a NEW mock instance than a `const`
// captured ONCE here at file-parse time — the two silently drift apart and every
// `.mockReturnValue()` call below would target a mock object the SUT never sees.
// Fix: re-require them in `beforeEach`, so the reference here and the SUT's lazy
// require happen in the same post-reset epoch. See project-llm-only-intent-grammar
// memory note (same landmine, different file) for the general pattern.
let scopeTopology;
let a2aDelegationService;

describe('agent reason-loop plugin routing helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    scopeTopology = require('../../services/scopeTopology');
    a2aDelegationService = require('../../services/a2aDelegationService');
  });

  it('resolveToolSchemas uses plugin schemas when plugin exists', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.toolSchemasFor.mockReturnValue([{ name: 'book_appointment', description: 'b', inputSchema: {} }]);
    const out = __test.resolveToolSchemas('health', { terminology: {} });
    expect(out).toEqual([{ name: 'book_appointment', description: 'b', inputSchema: {} }]);
  });

  it('resolveToolSchemas falls back to legacy builder when no plugin', () => {
    dispatch.hasPlugin.mockReturnValue(false);
    const out = __test.resolveToolSchemas('banking', { terminology: { accounts: 'accounts' } });
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((t) => t.name === 'get_my_accounts')).toBe(true);
  });

  it('resolveExecuteTool dispatches to plugin executeTool when plugin exists', async () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.executeToolFor.mockResolvedValue({ result: { ok: 1 }, render: null });
    scopeTopology.isA2aDelegatedTool.mockReturnValue(false);
    const exec = __test.resolveExecuteTool('health', { userId: 'u', userToken: 't', req: null, tokenEvents: [], sessionId: 's' });
    const out = await exec('book_appointment', { when: 'tomorrow' });
    expect(dispatch.executeToolFor).toHaveBeenCalledWith('health', 'book_appointment', { when: 'tomorrow' }, expect.any(Object), expect.any(Function));
    expect(typeof out).toBe('string');
    expect(JSON.parse(out)).toEqual({ result: { ok: 1 }, render: null });
  });

  describe('resolveExecuteTool — A2A fast-path for a direct model tool call', () => {
    // The model is hasnded the full plugin tool list (incl. a2aDelegated tools
    // like sensitive_patient_records) and may call one directly instead of
    // going through delegate_to_specialist. Direct execution hits the
    // McpFirstTool DENY (a2a-delegation-required) and that DENY becomes the
    // final chat reply. resolveExecuteTool must intercept and delegate,
    // exactly like dispatchVerticalIntent's heuristic path already does.
    it('routes a directly-called a2aDelegated tool through delegation, not the plugin/BFF path', async () => {
      scopeTopology.isA2aDelegatedTool.mockImplementation((n) => n === 'sensitive_patient_records');
      a2aDelegationService.isA2aEnabled.mockReturnValue(true);
      a2aDelegationService.delegateToSpecialist.mockResolvedValue({
        token: 'specialist-token',
        specialist: 'Records Specialist',
        vertical: 'healthcare',
        tool: 'sensitive_patient_records',
        actChainDepth: 2,
        scopes: ['records:read'],
      });
      executeBffToolWithToken.mockResolvedValue(JSON.stringify({ success: true }));

      const exec = __test.resolveExecuteTool('healthcare', {
        userId: 'u', userToken: 't', req: {}, tokenEvents: [], sessionId: 's',
      });
      const out = await exec('sensitive_patient_records', {});

      expect(a2aDelegationService.delegateToSpecialist).toHaveBeenCalled();
      expect(dispatch.executeToolFor).not.toHaveBeenCalled();
      expect(dispatch.isPluginToolName).not.toHaveBeenCalled();
      const parsed = JSON.parse(out);
      expect(parsed.delegated).toBe(true);
      expect(parsed.tool).toBe('sensitive_patient_records');
    });

    it('leaves ordinary plugin tools on the direct path', async () => {
      scopeTopology.isA2aDelegatedTool.mockReturnValue(false);
      dispatch.executeToolFor.mockResolvedValue({ result: { ok: 1 }, render: null });
      const exec = __test.resolveExecuteTool('healthcare', {
        userId: 'u', userToken: 't', req: {}, tokenEvents: [], sessionId: 's',
      });
      await exec('view_coverage', {});
      expect(a2aDelegationService.delegateToSpecialist).not.toHaveBeenCalled();
      expect(dispatch.executeToolFor).toHaveBeenCalled();
    });

    it('skips the fast-path when ff_a2a_delegation is off (direct call, DENY is the answer)', async () => {
      scopeTopology.isA2aDelegatedTool.mockImplementation((n) => n === 'sensitive_patient_records');
      a2aDelegationService.isA2aEnabled.mockReturnValue(false);
      dispatch.executeToolFor.mockResolvedValue({ result: { error: 'denied' }, render: null });
      const exec = __test.resolveExecuteTool('healthcare', {
        userId: 'u', userToken: 't', req: {}, tokenEvents: [], sessionId: 's',
      });
      await exec('sensitive_patient_records', {});
      expect(a2aDelegationService.delegateToSpecialist).not.toHaveBeenCalled();
      expect(dispatch.executeToolFor).toHaveBeenCalled();
    });
  });
});
