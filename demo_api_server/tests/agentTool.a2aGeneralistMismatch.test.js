'use strict';

// executeA2aDelegation and executeA2aGeneralistMismatch both call
// a2aDelegationService via a fresh require('./a2aDelegationService') inside
// the function body — that returns the same cached module.exports object
// every call, so spying on delegateToSpecialist/probeGeneralistMismatch on
// that shared object (not the internal executeA2aDelegation closure
// reference, which jest.spyOn cannot intercept) is what actually takes
// effect. Same technique agentTool.a2aFastPath.test.js uses at the
// a2aDelegationService layer.

describe('executeA2aGeneralistMismatch', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs leg 1 then probes the mismatch and merges both results', async () => {
    const svc = require('../services/demoAgentLangGraphService');
    const a2a = require('../services/a2aDelegationService');

    jest.spyOn(a2a, 'delegateToSpecialist').mockResolvedValue(
      { token: 'fake-token', tool: 'get_portfolio_summary', userSub: 'user-1', tokenEvents: [] },
    );
    jest.spyOn(a2a, 'probeGeneralistMismatch').mockResolvedValue(
      { decision: 'DENY', reason: 'invalid_a2a_generalist: ...', simulated: true, tokenEvents: [] },
    );

    const json = await svc.executeA2aGeneralistMismatch('investment', {}, { req: {}, tokenEvents: [], sessionId: 's1' });
    const parsed = JSON.parse(json);

    expect(parsed.token).toBe('fake-token');
    expect(parsed.mismatchProbe.decision).toBe('DENY');
  });

  it('skips the probe when leg 1 fails', async () => {
    const svc = require('../services/demoAgentLangGraphService');
    const a2a = require('../services/a2aDelegationService');

    jest.spyOn(a2a, 'delegateToSpecialist').mockResolvedValue({ error: 'a2a_delegation_disabled', tokenEvents: [] });
    jest.spyOn(a2a, 'probeGeneralistMismatch').mockRejectedValue(new Error('must not be called'));

    const json = await svc.executeA2aGeneralistMismatch('investment', {}, { req: {}, tokenEvents: [], sessionId: 's1' });
    const parsed = JSON.parse(json);

    expect(parsed.error).toBe('a2a_delegation_disabled');
    expect(parsed.mismatchProbe).toBeUndefined();
  });
});
