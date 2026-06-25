'use strict';
const roster = require('../../services/controlPlane/demoAgentRoster');

function fakeReq() { return { session: {} }; }

describe('demoAgentRoster (per-session)', () => {
  it('seeds 5 active demo agents on first read', () => {
    const req = fakeReq();
    const list = roster.getRoster(req);
    expect(list).toHaveLength(5);
    expect(list.every((a) => a.status === 'active')).toBe(true);
    expect(list.map((a) => a.id)).toEqual(
      expect.arrayContaining(['chatgpt', 'copilot', 'glean', 'agentforce', 'servicenow'])
    );
  });

  it('setStatus flips one agent and persists on the session', () => {
    const req = fakeReq();
    roster.getRoster(req);
    const updated = roster.setStatus(req, 'glean', 'revoked');
    expect(updated.status).toBe('revoked');
    expect(roster.getRoster(req).find((a) => a.id === 'glean').status).toBe('revoked');
  });

  it('setStatus returns null for an unknown id', () => {
    const req = fakeReq();
    expect(roster.setStatus(req, 'nope', 'revoked')).toBeNull();
  });

  it('reset restores all to active', () => {
    const req = fakeReq();
    roster.getRoster(req);
    roster.setStatus(req, 'glean', 'revoked');
    roster.reset(req);
    expect(roster.getRoster(req).every((a) => a.status === 'active')).toBe(true);
  });

  it('two sessions are isolated', () => {
    const a = fakeReq(); const b = fakeReq();
    roster.getRoster(a); roster.getRoster(b);
    roster.setStatus(a, 'glean', 'revoked');
    expect(roster.getRoster(b).find((x) => x.id === 'glean').status).toBe('active');
  });
});
