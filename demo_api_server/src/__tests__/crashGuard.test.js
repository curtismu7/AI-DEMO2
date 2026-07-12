'use strict';

const { shouldHardExitOnUnhandledRejection } = require('../../utils/crashGuard');

describe('shouldHardExitOnUnhandledRejection', () => {
  it('does not exit in production (WR-21, unchanged behavior)', () => {
    expect(shouldHardExitOnUnhandledRejection({ NODE_ENV: 'production' })).toBe(false);
  });

  it('does not exit when CRASH_GUARD=1 (demo runs in development mode)', () => {
    expect(shouldHardExitOnUnhandledRejection({ NODE_ENV: 'development', CRASH_GUARD: '1' })).toBe(false);
    expect(shouldHardExitOnUnhandledRejection({ CRASH_GUARD: '1' })).toBe(false);
  });

  it('exits in dev/test without the flag (bugs still surface loudly)', () => {
    expect(shouldHardExitOnUnhandledRejection({ NODE_ENV: 'development' })).toBe(true);
    expect(shouldHardExitOnUnhandledRejection({ NODE_ENV: 'test' })).toBe(true);
    expect(shouldHardExitOnUnhandledRejection({})).toBe(true);
  });

  it('only the exact string "1" arms the guard', () => {
    expect(shouldHardExitOnUnhandledRejection({ CRASH_GUARD: 'true' })).toBe(true);
    expect(shouldHardExitOnUnhandledRejection({ CRASH_GUARD: '' })).toBe(true);
  });
});
