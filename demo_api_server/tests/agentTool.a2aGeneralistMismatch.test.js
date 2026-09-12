'use strict';

// executeA2aDelegation and executeA2aGeneralistMismatch call
// a2aDelegationService and a2aProtocolClient via a fresh require() inside the
// function body — that returns the same cached module.exports object every
// call, so spying on exchangeAsGeneralist / probeGeneralistMismatch /
// sendA2aProtocolHandoff on those shared objects (not the internal
// executeA2aDelegation closure reference, which jest.spyOn cannot intercept) is
// what actually takes effect. Same technique agentTool.a2aFastPath.test.js uses
// at the a2aDelegationService layer.
//
// Leg 1 is now Exchange #1 only (exchangeAsGeneralist); the specialist's own
// Exchange #2 and tool call happen behind the wire hop, so the hop is the second
// seam this file has to stub.

describe('executeA2aGeneralistMismatch', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs leg 1 then probes the mismatch and merges both results', async () => {
    const svc = require('../services/demoAgentLangGraphService');
    const a2a = require('../services/a2aDelegationService');
    const client = require('../services/a2aProtocolClient');

    jest.spyOn(a2a, 'exchangeAsGeneralist').mockResolvedValue(
      { token: 'fake-token', tool: 'get_portfolio_summary', userSub: 'user-1', tokenEvents: [] },
    );
    jest.spyOn(client, 'sendA2aProtocolHandoff').mockResolvedValue(
      { ok: true, tokenEvents: [], result: { positions: [] }, toolError: null, actChainDepth: 2, scopes: ['invest:read'] },
    );
    jest.spyOn(a2a, 'probeGeneralistMismatch').mockResolvedValue(
      { decision: 'DENY', reason: 'invalid_a2a_generalist: ...', simulated: true, tokenEvents: [] },
    );

    const json = await svc.executeA2aGeneralistMismatch('investment', {}, { req: {}, tokenEvents: [], sessionId: 's1' });
    const parsed = JSON.parse(json);

    expect(parsed.tool).toBe('get_portfolio_summary');
    expect(parsed.mismatchProbe.decision).toBe('DENY');
  });

  it('skips the probe when leg 1 fails', async () => {
    const svc = require('../services/demoAgentLangGraphService');
    const a2a = require('../services/a2aDelegationService');

    jest.spyOn(a2a, 'exchangeAsGeneralist').mockResolvedValue({ error: 'a2a_delegation_disabled', tokenEvents: [] });
    jest.spyOn(a2a, 'probeGeneralistMismatch').mockRejectedValue(new Error('must not be called'));

    const json = await svc.executeA2aGeneralistMismatch('investment', {}, { req: {}, tokenEvents: [], sessionId: 's1' });
    const parsed = JSON.parse(json);

    expect(parsed.error).toBe('a2a_delegation_disabled');
    expect(parsed.mismatchProbe).toBeUndefined();
  });
});
