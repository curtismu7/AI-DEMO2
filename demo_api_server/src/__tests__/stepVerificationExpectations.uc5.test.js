// demo_api_server/src/__tests__/stepVerificationExpectations.uc5.test.js
'use strict';

const {
  scoreAttackSimDeny,
  scoreTokenChainDetail,
} = require('../../services/stepVerificationExpectations');

describe('scoreAttackSimDeny (UC5 insufficient-scope)', () => {
  const evidence = ['sim-exchange-ok', 'sim-gateway-deny'];

  const teachingDenyBody = {
    sim: 'insufficient-scope',
    useCaseId: 'insufficient-scope',
    status: 403,
    errorCode: 'insufficient_scope',
    reason: 'create_transfer requires write',
    tokenChainEvents: [
      { id: 'user-token', status: 'active', explanation: 'session', claims: { sub: 'u1', scope: 'read write' } },
      {
        id: 'sim-exchange-ok',
        status: 'active',
        explanation: 'PingOne minted a valid token scoped to "read" only.',
        claims: { sub: 'u1', scope: 'read' },
      },
      {
        id: 'sim-gateway-deny',
        status: 'error',
        error: 'insufficient_scope',
        httpStatus: 403,
        explanation: 'Gateway rejected the call with 403 insufficient_scope: create_transfer requires write',
      },
    ],
  };

  it('PASSes teaching DENY with sim-exchange-ok + sim-gateway-deny detail', () => {
    const scored = scoreAttackSimDeny(
      { status: 200, body: teachingDenyBody },
      { expectedErrorCode: 'insufficient_scope', evidenceTokenChain: evidence },
    );
    expect(scored.ok).toBe(true);
    expect(scored.matchedSteps).toEqual(evidence);
  });

  it('FAILs exchange_failed (invalid subject_token) even when PingOne detail is on the rail', () => {
    const scored = scoreAttackSimDeny(
      {
        status: 200,
        body: {
          sim: 'insufficient-scope',
          status: 502,
          errorCode: 'invalid_request',
          reason:
            "Token exchange failed: Not a valid access token for request param 'subject_token'",
          tokenChainEvents: [
            { id: 'user-token', status: 'active', explanation: 'session', claims: { sub: 'u1' } },
            {
              id: 'sim-exchange-error',
              status: 'error',
              error: 'invalid_request',
              httpStatus: 400,
              explanation:
                "Token exchange failed: Not a valid access token for request param 'subject_token'",
              pingoneErrorDescription: "Not a valid access token for request param 'subject_token'",
              requestContext: {
                audience: 'https://api.ping.demo:3036/mcp',
                scope: 'read',
                client_id: 'f4dd707d-f78d-4417-ba56-dc8707d10a1f',
              },
            },
          ],
        },
      },
      { expectedErrorCode: 'insufficient_scope', evidenceTokenChain: evidence },
    );
    expect(scored.ok).toBe(false);
    expect(scored.reason).toBe('exchange_failed');
  });

  it('FAILs blank Token Chain on exchange failure (no teaching detail)', () => {
    const scored = scoreAttackSimDeny(
      {
        status: 200,
        body: {
          status: 502,
          errorCode: 'exchange_failed',
          reason: 'Token exchange failed',
          tokenChainEvents: [
            { id: 'sim-exchange-error', status: 'error' },
          ],
        },
      },
      { expectedErrorCode: 'insufficient_scope', evidenceTokenChain: evidence },
    );
    expect(scored.ok).toBe(false);
    // Bare failure event with no explanation/error extras → no_event_detail
    // (failure_without_detail only when a failure event has a code/label but no text).
    expect(['no_event_detail', 'failure_without_detail', 'exchange_failed']).toContain(scored.reason);
  });

  it('FAILs unexpected_permit as wrong_gate', () => {
    const scored = scoreAttackSimDeny(
      {
        status: 200,
        body: {
          status: 200,
          errorCode: 'unexpected_permit',
          tokenChainEvents: [
            { id: 'sim-exchange-ok', explanation: 'ok', claims: { scope: 'read' } },
          ],
        },
      },
      { expectedErrorCode: 'insufficient_scope', evidenceTokenChain: evidence },
    );
    expect(scored.ok).toBe(false);
    expect(scored.reason).toBe('wrong_gate');
  });

  it('FAILs no_session_token as missing_prereq', () => {
    const scored = scoreAttackSimDeny(
      { status: 200, body: { errorCode: 'no_session_token', tokenChainEvents: [] } },
      { expectedErrorCode: 'insufficient_scope', evidenceTokenChain: evidence },
    );
    expect(scored.ok).toBe(false);
    expect(scored.reason).toBe('missing_prereq');
  });
});

describe('scoreTokenChainDetail — attack-sim exchange failure extras', () => {
  it('accepts requestContext + pingoneError as teaching detail', () => {
    const scored = scoreTokenChainDetail(
      [{
        id: 'sim-exchange-error',
        status: 'error',
        error: 'invalid_request',
        explanation: 'Token exchange failed',
        requestContext: { client_id: 'exchanger', scope: 'read' },
        pingoneError: 'invalid_request',
      }],
      { requireFailureEvent: true },
    );
    expect(scored.ok).toBe(true);
  });
});
