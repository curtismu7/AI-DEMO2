'use strict';

jest.mock('../../services/verticalDispatch', () => ({ resolvePlugin: jest.fn() }));
const verticalDispatch = require('../../services/verticalDispatch');
const { __test } = require('../../services/demoAgentLangGraphService');

describe('dispatchVerticalIntent — local-bypass HITL forwarding', () => {
  it('forwards a HITL envelope and threads hitlChallengeId into ctx', async () => {
    const executeTool = jest.fn().mockResolvedValue({
      result: { text: 'approve please', error: 'hitl_required', hitl: { type: 'consent' }, hitlChallengeId: 'chal-1' },
      render: 'text',
    });
    verticalDispatch.resolvePlugin.mockReturnValue({ isLocalTool: () => true, executeTool });

    const out = await __test.dispatchVerticalIntent(
      { vertical: 'oauth-teaching', action: 'demonstrate_hitl', params: {} },
      { userId: 'u1', userToken: 't1', req: {}, tokenEvents: [], sessionId: 's1', hitlChallengeId: 'chal-1' },
    );

    expect(out.error).toBe('hitl_required');
    expect(out.requiresConsent).toBe(true);
    expect(out.hitlChallengeId).toBe('chal-1');
    expect(out.action).toBe('demonstrate_hitl');
    expect(out.reply).toBe('approve please');
    // ctx given to the tool carries hitlChallengeId for the retry echo
    expect(executeTool).toHaveBeenCalledWith('demonstrate_hitl', {}, expect.objectContaining({ hitlChallengeId: 'chal-1' }));
  });

  it('a normal (non-HITL) local result is unaffected', async () => {
    const executeTool = jest.fn().mockResolvedValue({ result: { text: 'hello' }, render: 'text' });
    verticalDispatch.resolvePlugin.mockReturnValue({ isLocalTool: () => true, executeTool });

    const out = await __test.dispatchVerticalIntent(
      { vertical: 'oauth-teaching', action: 'demonstrate_token_exchange', params: {} },
      { userId: 'u1', userToken: 't1', req: {}, tokenEvents: [], sessionId: 's1' },
    );
    expect(out.error).toBeUndefined();
    expect(out.success).toBe(true);
    expect(out.reply).toBe('hello');
    expect(out.requiresConsent).toBe(false);
  });
});
