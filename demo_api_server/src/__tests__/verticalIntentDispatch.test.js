const HEALTHCARE_WRITE_TOOLS = [
  {
    name: 'book_appointment',
    description: 'Book a new appointment with a provider.',
    inputSchema: {
      type: 'object',
      properties: { provider: { type: 'string' }, clinic: { type: 'string' }, when: { type: 'string' }, reason: { type: 'string' } },
      required: ['provider', 'when'],
    },
    scopes: ['write'],
    authz: {},
  },
  {
    name: 'release_records',
    description: 'Release medical records to a third party (requires step-up + consent).',
    inputSchema: { type: 'object', properties: { recordId: { type: 'string' } }, required: ['recordId'] },
    scopes: ['write'],
    authz: { stepUp: true, consent: true },
  },
];

const configStore = require('../../services/configStore');

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    const defaults = { ff_hitl_enabled: 'true', ff_authorize_real: 'false' };
    return defaults[key] || null;
  }),
  get: jest.fn((key) => {
    const defaults = { ff_hitl_enabled: 'true', ff_authorize_real: 'false' };
    return defaults[key] || null;
  }),
}));

// Authorization now runs INSIDE the unified pipeline (executeBffTool →
// runMcpToolPipeline). dispatchVerticalIntent no longer calls a separate
// agentPreflightService — a deny/HITL/step-up is surfaced as an envelope from
// executeBffTool, exactly like the banking and LLM paths.
jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(),
}));

jest.mock('../../utils/mcpToolRegistry', () => ({
  callMcpToolInternal: jest.fn(async () =>
    JSON.stringify({ success: true, render: 'view_coverage', data: { plan: 'PPO' } }),
  ),
  createMcpToolRegistry: jest.fn(() => []),
}));

jest.mock('../../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(async () => ({
    token: 'agent-tok',
    tokenEvents: [{ type: 'exchange', label: 'test' }],
  })),
}));

jest.mock('../../services/verticalDispatch', () => {
  const tools = [
    { name: 'view_coverage', inputSchema: { type: 'object', properties: {} }, authz: {} },
    {
      name: 'book_appointment',
      inputSchema: {
        type: 'object',
        properties: { provider: { type: 'string' }, when: { type: 'string' } },
        required: ['provider', 'when'],
      },
      authz: {},
    },
    {
      name: 'release_records',
      inputSchema: { type: 'object', properties: { recordId: { type: 'string' } }, required: ['recordId'] },
      authz: { stepUp: true, consent: true },
    },
  ];
  return {
    hasPlugin: jest.fn(() => true),
    toolSchemasFor: jest.fn(() => tools),
    executeToolFor: jest.fn(async () => ({ result: { plan: 'PPO' }, render: 'view_coverage' })),
    resolvePlugin: jest.fn(() => ({ getTools: () => tools, getHeuristics: () => [] })),
    authzFor: jest.fn(() => ({ release_records: { stepUp: true, consent: true }, book_appointment: {} })),
    isPluginToolName: jest.fn((name) => tools.some((t) => t.name === name)),
  };
});

const dispatch = require('../../services/verticalDispatch');
const { executeBffTool } = require('../../services/bffMcpToolExecutor');
const { __test } = require('../../services/demoAgentLangGraphService');

describe('dispatchVerticalIntent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    executeBffTool.mockImplementation(async ({ name }) => {
      if (name === 'view_coverage') {
        return JSON.stringify({ success: true, render: 'view_coverage', data: { plan: 'PPO' } });
      }
      if (name === 'book_appointment') {
        return JSON.stringify({ success: true, render: 'book_appointment', data: { status: 'Confirmed' } });
      }
      return JSON.stringify({ error: 'boom' });
    });
  });

  it('executes the vertical tool via MCP and returns an envelope with a verticalResult payload', async () => {
    const heuristic = { kind: 'vertical', vertical: 'healthcare', action: 'view_coverage', params: {} };
    const out = await __test.dispatchVerticalIntent(heuristic, { userId: 'u', userToken: 't', req: null, tokenEvents: [], sessionId: 's' });
    expect(executeBffTool).toHaveBeenCalled();
    expect(dispatch.executeToolFor).not.toHaveBeenCalled();
    expect(typeof out.reply).toBe('string');
    expect(out.success).toBe(true);
    expect(out.verticalResult).toEqual({ action: 'view_coverage', render: 'view_coverage', data: { plan: 'PPO' } });
  });

  it('surfaces a tool error in the reply and marks success:false', async () => {
    executeBffTool.mockResolvedValueOnce(JSON.stringify({ error: 'boom' }));
    const heuristic = { kind: 'vertical', vertical: 'healthcare', action: 'book_appointment', params: { provider: 'Dr. Lee', when: '2026-06-01' } };
    const out = await __test.dispatchVerticalIntent(heuristic, { userId: 'u', userToken: 't', req: null, tokenEvents: [], sessionId: 's' });
    expect(out.success).toBe(false);
    expect(out.reply).toMatch(/boom/);
  });

  it('surfaces MCP throw as tool error in reply (not uncaught)', async () => {
    executeBffTool.mockRejectedValueOnce(new Error('gateway unreachable'));
    const heuristic = { kind: 'vertical', vertical: 'healthcare', action: 'view_coverage', params: {} };
    const out = await __test.dispatchVerticalIntent(heuristic, { userId: 'u', userToken: 't', req: null, tokenEvents: [], sessionId: 's' });
    expect(out.success).toBe(false);
    expect(out.reply).toMatch(/gateway unreachable/);
  });

  it('returns a needsParams envelope when required params are missing (no execute)', async () => {
    const heuristic = { kind: 'vertical', vertical: 'healthcare', action: 'book_appointment', params: {} };
    const out = await __test.dispatchVerticalIntent(heuristic, { userId: 'u', userToken: 't', req: null, tokenEvents: [], sessionId: 's' });
    expect(out.success).toBe(false);
    expect(out.needsParams).toBeDefined();
    expect(out.needsParams.action).toBe('book_appointment');
    expect(out.needsParams.missing).toContain('provider');
    expect(executeBffTool).not.toHaveBeenCalled();
  });

  it('executes book_appointment when required params are present', async () => {
    const heuristic = { kind: 'vertical', vertical: 'healthcare', action: 'book_appointment', params: { provider: 'Dr. Lee', when: '2026-06-01' } };
    const out = await __test.dispatchVerticalIntent(heuristic, { userId: 'u', userToken: 't', req: null, tokenEvents: [], sessionId: 's' });
    expect(executeBffTool).toHaveBeenCalled();
    expect(out.success).toBe(true);
    expect(out.verticalResult).toEqual({ action: 'book_appointment', render: 'book_appointment', data: { status: 'Confirmed' } });
  });

  it('gates release_records with a step_up_required envelope (pipeline gate, no result)', async () => {
    // The unified pipeline's authorize gate emits the mcp_-prefixed code
    // (mcp_step_up_required) — the actual runMcpToolPipeline 428 block shape, NOT
    // the bare form. dispatchVerticalIntent must still surface it as a step-up
    // envelope (normalised to the bare code) and never produce a success result.
    executeBffTool.mockImplementationOnce(async () =>
      JSON.stringify({ error: 'mcp_step_up_required', error_description: 'Step-up required.', decisionId: 'd1', step_up_method: 'email', step_up_acr: 'Multi_Factor' }),
    );
    const heuristic = { kind: 'vertical', vertical: 'healthcare', action: 'release_records', params: { recordId: 'rec-1' } };
    const out = await __test.dispatchVerticalIntent(heuristic, { userId: 'u', userToken: 't', req: null, tokenEvents: [], sessionId: 's' });
    expect(executeBffTool).toHaveBeenCalled();
    expect(out.error).toBe('step_up_required');
    expect(out.step_up_required).toBe(true);
    // CIBA acr_values must survive to the client (parity with the removed preflight).
    expect(out.step_up_method).toBe('email');
    expect(out.step_up_acr).toBe('Multi_Factor');
    expect(out.success).toBe(false);
    expect(out.verticalResult).toBeUndefined();
  });

  it('gates release_records with an mcp_hitl_required block → consent envelope + challengeId', async () => {
    // The gate's HITL block carries the mcp_-prefixed code plus challengeId /
    // error_description (no bare `hitl`/`message` fields). dispatchVerticalIntent
    // must normalise it to a consent envelope and thread the challengeId — the
    // behaviour the removed agentPreflightService preflight used to provide.
    executeBffTool.mockImplementationOnce(async () =>
      JSON.stringify({
        error: 'mcp_hitl_required',
        error_description: 'Human approval required.',
        challengeId: 'chal-1',
        mcpAuthorizeEvaluation: { decision: 'INDETERMINATE', engine: 'simulated', decisionId: 'd-1' },
      }),
    );
    const heuristic = { kind: 'vertical', vertical: 'healthcare', action: 'release_records', params: { recordId: 'rec-1' } };
    const out = await __test.dispatchVerticalIntent(heuristic, { userId: 'u', userToken: 't', req: null, tokenEvents: [], sessionId: 's' });
    expect(out.error).toBe('hitl_required');
    expect(out.requiresConsent).toBe(true);
    expect(out.hitl).toEqual({ type: 'consent' });
    expect(out.hitlChallengeId).toBe('chal-1');
    expect(out.success).toBe(false);
    // ProofOfEnforcement's authorize-decision step only lights up when this
    // survives to the top-level response — see demoAgentService.js's
    // ingestLegacyRunTrace, which gates ingestAuthorize() on its presence.
    expect(out.mcpAuthorizeEvaluation).toEqual({ decision: 'INDETERMINATE', engine: 'simulated', decisionId: 'd-1' });
  });
});
