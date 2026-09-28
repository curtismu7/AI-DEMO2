'use strict';
const roster = require('../../services/controlPlane/demoAgentRoster');

function fakeReq() { return { session: {} }; }

describe('demoAgentRoster (per-session)', () => {
  it('starts empty because only live PingOne identities are shown', () => {
    const req = fakeReq();
    const list = roster.getRoster(req);
    expect(list).toEqual([]);
  });

  it('does not allow status changes to an unknown agent', () => {
    const req = fakeReq();
    expect(roster.setStatus(req, 'glean', 'revoked')).toBeNull();
  });

  it('setStatus returns null for an unknown id', () => {
    const req = fakeReq();
    expect(roster.setStatus(req, 'nope', 'revoked')).toBeNull();
  });

  it('reset restores the empty seed', () => {
    const req = fakeReq();
    roster.reset(req);
    expect(roster.getRoster(req)).toEqual([]);
  });

  it('two sessions receive separate roster arrays', () => {
    const a = fakeReq(); const b = fakeReq();
    expect(roster.getRoster(a)).not.toBe(roster.getRoster(b));
  });
});
