/**
 * The LLM/reason path must not swallow a HITL/step-up gate.
 *
 * resolveExecuteTool hands raw MCP payloads to the model as text. When that
 * payload is a gate, the model paraphrases it into prose and the loop reports
 * ok — so the response envelope lost the fields the SPA's approval handler keys
 * on and the run rendered "Incomplete" with no way to approve.
 *
 * The first attempt at this hooked `out.error` and never fired, because the gate
 * arrives as a raw MCP payload classified by parseMcpToolPayload, not as an
 * error property on the dispatch result. These tests therefore assert the hook
 * ACTUALLY FIRES for a realistic gateway payload, not just that the envelope
 * builder works in isolation.
 */
jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(),
}));
jest.mock('../../services/verticalDispatch', () => ({
  isPluginToolName: jest.fn(() => true),
  executeToolFor: jest.fn(),
  hasPlugin: jest.fn(() => false),
  toolSchemasFor: jest.fn(() => []),
  systemPromptFor: jest.fn(() => ''),
}));

const { executeBffTool } = require('../../services/bffMcpToolExecutor');
const {
  __test: { resolveExecuteTool, approvalGateResponse },
} = require('../../services/demoAgentLangGraphService');

/** The shape the gateway actually returns for a HITL-gated tool call. */
const HITL_PAYLOAD = JSON.stringify({
  error: 'mcp_hitl_required',
  error_description: "Tool 'create_transfer' requires human approval before proceeding.",
  challengeId: 'chal-abc',
});

const STEP_UP_PAYLOAD = JSON.stringify({
  error: 'mcp_step_up_required',
  error_description: 'Step-up authentication required.',
  challengeId: 'chal-xyz',
  step_up_method: 'otp',
});

describe('LLM path approval gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fires onGate for a HITL payload and still returns the raw result to the loop', async () => {
    executeBffTool.mockResolvedValue(HITL_PAYLOAD);
    const seen = [];
    const exec = resolveExecuteTool('banking', {
      userId: 'u1', userToken: 't', req: {}, tokenEvents: [], sessionId: 's',
      onGate: (envelope, toolName, args) => seen.push({ envelope, toolName, args }),
    });

    const raw = await exec('create_transfer', { amount: 300 });

    expect(seen).toHaveLength(1);
    // Normalised to the bare code the SPA handler recognises.
    expect(seen[0].envelope.error).toBe('hitl_required');
    expect(seen[0].envelope.hitlChallengeId).toBe('chal-abc');
    expect(seen[0].toolName).toBe('create_transfer');
    expect(seen[0].args).toEqual({ amount: 300 });
    // The loop must still receive the payload unchanged.
    expect(raw).toBe(HITL_PAYLOAD);
  });

  it('fires onGate for a step-up payload', async () => {
    executeBffTool.mockResolvedValue(STEP_UP_PAYLOAD);
    const seen = [];
    const exec = resolveExecuteTool('banking', {
      userId: 'u1', userToken: 't', req: {}, tokenEvents: [], sessionId: 's',
      onGate: (envelope) => seen.push(envelope),
    });

    await exec('create_transfer', { amount: 600 });

    expect(seen).toHaveLength(1);
    expect(seen[0].error).toBe('step_up_required');
    expect(seen[0].step_up_method).toBe('otp');
  });

  it('does not fire onGate for a normal successful tool result', async () => {
    executeBffTool.mockResolvedValue(JSON.stringify({ data: { balance: 100 }, render: 'text' }));
    const seen = [];
    const exec = resolveExecuteTool('banking', {
      userId: 'u1', userToken: 't', req: {}, tokenEvents: [], sessionId: 's',
      onGate: () => seen.push(1),
    });

    await exec('get_my_accounts', {});

    expect(seen).toHaveLength(0);
  });

  it('does not fire onGate for a hard denial — there is nothing to approve', async () => {
    executeBffTool.mockResolvedValue(JSON.stringify({
      error: 'authorization_denied',
      error_description: 'Policy denied the tool call.',
    }));
    const seen = [];
    const exec = resolveExecuteTool('banking', {
      userId: 'u1', userToken: 't', req: {}, tokenEvents: [], sessionId: 's',
      onGate: () => seen.push(1),
    });

    await exec('create_transfer', { amount: 5 });

    expect(seen).toHaveLength(0);
  });

  it('survives an unparseable payload without breaking tool execution', async () => {
    executeBffTool.mockResolvedValue('not json at all');
    const exec = resolveExecuteTool('banking', {
      userId: 'u1', userToken: 't', req: {}, tokenEvents: [], sessionId: 's',
      onGate: () => { throw new Error('should not fire'); },
    });

    await expect(exec('get_my_accounts', {})).resolves.toBe('not json at all');
  });

  it('rebuilds the envelope the SPA modal needs', () => {
    const out = approvalGateResponse({
      envelope: {
        error: 'step_up_required',
        message: 'Step-up authentication required.',
        step_up_method: 'otp',
        hitlChallengeId: 'chal-xyz',
      },
      toolName: 'create_transfer',
      args: { fromAccountId: 'a1', toAccountId: 'a2', amount: 600, type: 'transfer' },
    }, []);

    expect(out.success).toBe(false);
    expect(out.error).toBe('step_up_required');
    expect(out.hitlChallengeId).toBe('chal-xyz');
    // The SPA picks its monetary consent shape on transactionAmount != null.
    expect(out.transactionAmount).toBe(600);
    expect(out.fromAccountId).toBe('a1');
    expect(out.transactionType).toBe('transfer');
    expect(out.toolsCalled).toEqual(['create_transfer']);
  });

  it('omits absent fields rather than emitting undefined keys', () => {
    const out = approvalGateResponse({
      envelope: { error: 'hitl_required' },
      toolName: 'release_records',
      args: {},
    }, []);

    expect(out.reply).toBeTruthy();
    expect('transactionAmount' in out).toBe(false);
    expect('step_up_method' in out).toBe(false);
  });
});
