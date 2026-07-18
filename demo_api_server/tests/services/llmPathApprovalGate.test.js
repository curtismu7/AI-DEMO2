/**
 * LLM path must re-emit an approval gate the model paraphrased away.
 *
 * The reason loop stringifies tool results for the LLM. When a tool refuses
 * pending approval the model turns that into fluent prose and the loop reports
 * ok, so the response envelope lost error/step_up/challenge fields and the SPA
 * showed "Incomplete" with no way to approve.
 */
const {
  __test: { APPROVAL_GATE_ERRORS, approvalGateResponse },
} = require('../../services/demoAgentLangGraphService');

describe('LLM path approval gate', () => {
  it('treats all four SPA-recognised gate codes as approval gates', () => {
    for (const code of ['hitl_required', 'mcp_hitl_required', 'step_up_required', 'mcp_step_up_required']) {
      expect(APPROVAL_GATE_ERRORS.has(code)).toBe(true);
    }
  });

  it('does not treat a hard denial or a generic failure as an approval gate', () => {
    expect(APPROVAL_GATE_ERRORS.has('authorization_denied')).toBe(false);
    expect(APPROVAL_GATE_ERRORS.has('tool_terminal')).toBe(false);
  });

  it('rebuilds the step-up envelope the SPA modal needs', () => {
    const out = approvalGateResponse({
      result: {
        error: 'step_up_required',
        message: 'Step-up authentication required for this transfer.',
        step_up_method: 'otp',
        step_up_acr: 'urn:acr:otp',
        hitlChallengeId: 'chal-123',
      },
      toolName: 'create_transfer',
      args: { fromAccountId: 'a1', toAccountId: 'a2', amount: 600, type: 'transfer' },
    }, []);

    expect(out.error).toBe('step_up_required');
    expect(out.success).toBe(false);
    expect(out.toolsCalled).toEqual(['create_transfer']);
    expect(out.hitlChallengeId).toBe('chal-123');
    expect(out.step_up_method).toBe('otp');
    // The SPA picks its monetary consent shape on transactionAmount != null.
    expect(out.transactionAmount).toBe(600);
    expect(out.fromAccountId).toBe('a1');
    expect(out.transactionType).toBe('transfer');
  });

  it('rebuilds the HITL consent envelope, preferring the tool amount over the arg', () => {
    const out = approvalGateResponse({
      result: {
        error: 'hitl_required',
        message: 'This transfer requires your approval.',
        hitl: { type: 'consent' },
        hitl_threshold_usd: 500,
        transactionAmount: 300,
      },
      toolName: 'create_transfer',
      args: { amount: 999 },
    }, []);

    expect(out.error).toBe('hitl_required');
    expect(out.hitl).toEqual({ type: 'consent' });
    expect(out.hitl_threshold_usd).toBe(500);
    expect(out.transactionAmount).toBe(300);
  });

  it('omits absent fields rather than emitting undefined keys', () => {
    const out = approvalGateResponse({
      result: { error: 'mcp_hitl_required' },
      toolName: 'release_records',
      args: {},
    }, []);

    expect(out.error).toBe('mcp_hitl_required');
    expect(out.reply).toBeTruthy();
    expect('transactionAmount' in out).toBe(false);
    expect('hitlChallengeId' in out).toBe(false);
    expect('step_up_method' in out).toBe(false);
  });
});
