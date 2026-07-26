'use strict';

const {
  initiateSimulated,
  isSimulatedApproved,
  SIMULATED_APPROVE_DELAY_MS,
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
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns false immediately after initiation', () => {
    const pending = { initiatedAt: Date.now() };
    expect(isSimulatedApproved(pending)).toBe(false);
  });

  it('returns false just before the approval delay elapses', () => {
    const pending = { initiatedAt: Date.now() };
    jest.advanceTimersByTime(SIMULATED_APPROVE_DELAY_MS - 1);
    expect(isSimulatedApproved(pending)).toBe(false);
  });

  it('returns true once the approval delay has elapsed', () => {
    const pending = { initiatedAt: Date.now() };
    jest.advanceTimersByTime(SIMULATED_APPROVE_DELAY_MS);
    expect(isSimulatedApproved(pending)).toBe(true);
  });

  it('returns true well after the approval delay', () => {
    const pending = { initiatedAt: Date.now() };
    jest.advanceTimersByTime(SIMULATED_APPROVE_DELAY_MS + 60000);
    expect(isSimulatedApproved(pending)).toBe(true);
  });
});
