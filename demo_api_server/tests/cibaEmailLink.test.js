'use strict';

const {
  issueToken, status, decide, consumeForAuthReqId,
} = require('../services/cibaEmailLinkService');

describe('CIBA email-link failover (PingOne simulated path)', () => {
  it('issues a token bound to the auth_req_id and reports waiting', () => {
    const token = issueToken('sim-abc');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(status(token)).toMatchObject({ state: 'waiting', decision: null, authReqId: 'sim-abc' });
  });

  it('decides once, then refuses reuse', () => {
    const token = issueToken('sim-abc');
    expect(decide(token, 'approve')).toMatchObject({ state: 'received', decision: 'approve' });
    expect(() => decide(token, 'approve')).toThrow(/already used/);
    expect(status(token)).toMatchObject({ state: 'received', decision: 'approve' }); // status is read-only, does not consume
  });

  it('rejects an invalid or unknown token and a bad decision', () => {
    expect(() => decide('nope', 'approve')).toThrow(/no longer valid/);
    expect(() => decide(issueToken('x'), 'maybe')).toThrow(/approve or deny/);
    expect(status('nope').state).toBe('invalid');
  });

  it('consumeForAuthReqId returns the decision exactly once', () => {
    const token = issueToken('sim-xyz');
    expect(consumeForAuthReqId('sim-other')).toBeNull();
    decide(token, 'deny');
    expect(consumeForAuthReqId('sim-xyz')).toBe('denied');
    expect(consumeForAuthReqId('sim-xyz')).toBeNull();
  });

  it('an unresolved token leaves the poll pending', () => {
    issueToken('sim-pending');
    expect(consumeForAuthReqId('sim-pending')).toBeNull();
  });
});
