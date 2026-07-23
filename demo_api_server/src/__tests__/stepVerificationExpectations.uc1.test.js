// demo_api_server/src/__tests__/stepVerificationExpectations.uc1.test.js
'use strict';

const {
  scoreDelegatedAccessInvoke,
} = require('../../services/stepVerificationExpectations');

describe('scoreDelegatedAccessInvoke (UC1 Demo Step path)', () => {
  const evidence = ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'];

  it('PASSes a successful invoke with exchange + gw-authorize + tools', () => {
    const scored = scoreDelegatedAccessInvoke(
      {
        status: 200,
        body: {
          success: true,
          reply: 'Your balances:\n• CHECKING — $100.00',
          toolsCalled: ['get_my_accounts'],
          tokenEvents: [
            { id: 'user-token', explanation: 'session' },
            { id: 'two-ex-exchange1', exchangeStep: '1-exchange', claims: { aud: 'x' } },
            { id: 'gw-authorize', decision: 'PERMIT', explanation: 'PERMIT' },
          ],
        },
      },
      { evidenceTokenChain: evidence },
    );
    expect(scored.ok).toBe(true);
    expect(scored.matchedSteps).toEqual(evidence);
  });

  it('FAILs when authorize never ran (stale worker / Incomplete ProofStrip)', () => {
    const scored = scoreDelegatedAccessInvoke(
      {
        status: 200,
        body: {
          success: false,
          error: 'mcp_authorize_unavailable',
          reply: "That step couldn't be completed.",
          tokenEvents: [
            { id: 'user-token', explanation: 'session' },
            { id: 'two-ex-exchange1', exchangeStep: '1-exchange', claims: { aud: 'x' } },
          ],
        },
      },
      { evidenceTokenChain: evidence },
    );
    expect(scored.ok).toBe(false);
    expect(scored.reason).toBe('authorize_unavailable');
  });

  it('FAILs gateway access_denied after exchange (gateway P1AZ worker stale)', () => {
    const scored = scoreDelegatedAccessInvoke(
      {
        status: 200,
        body: {
          success: false,
          reply: 'access_denied',
          toolsCalled: ['get_my_accounts'],
          tokenEvents: [
            { id: 'user-token', explanation: 'session' },
            { id: 'two-ex-final-token', exchangeStep: '2-exchange', claims: { aud: 'x' } },
            { id: 'gw-authorize', decision: 'DENY', explanation: 'Unauthorized' },
          ],
        },
      },
      { evidenceTokenChain: evidence },
    );
    expect(scored.ok).toBe(false);
    expect(scored.reason).toMatch(/invoke_failed|authorize_denied/);
  });
});
