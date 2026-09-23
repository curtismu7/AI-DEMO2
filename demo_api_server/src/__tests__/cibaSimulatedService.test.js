'use strict';

const {
  initiateSimulated,
  isSimulatedApproved,
} = require('../../services/cibaSimulatedService');

describe('cibaSimulatedService.initiateSimulated()', () => {
  it('returns an auth_req_id prefixed with "sim-"', () => {
    const result = initiateSimulated('alice@example.com', 'Approve payment', 'openid profile', '');
    expect(result.auth_req_id).toMatch(/^sim-/);
  });

  it('returns expires_in=300 and interval=5', () => {
    const result = initiateSimulated('alice@example.com');
    expect(result.expires_in).toBe(300);
    expect(result.interval).toBe(5);
  });

  it('returns a unique auth_req_id on each call', () => {
    const a = initiateSimulated('alice@example.com');
    const b = initiateSimulated('alice@example.com');
    expect(a.auth_req_id).not.toBe(b.auth_req_id);
  });
});

describe('cibaSimulatedService.isSimulatedApproved()', () => {
  it('returns false immediately after initiation', () => {
    const pending = { initiatedAt: Date.now() };
    expect(isSimulatedApproved(pending)).toBe(false);
  });

  it('does not approve merely because time passed', () => {
    const pending = { initiatedAt: Date.now() };
    pending.initiatedAt -= 300_000;
    expect(isSimulatedApproved(pending)).toBe(false);
  });

  it('returns true only after an explicit approval', () => {
    const pending = { approvedByUser: true };
    expect(isSimulatedApproved(pending)).toBe(true);
  });
});
