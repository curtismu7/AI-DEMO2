// demo_api_ui/src/utils/__tests__/useCaseAuth.test.js
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_USE_CASE_AUTH,
  runsSignedOut,
  useCaseAuthLevel,
  viewerMeetsUseCaseAuth,
} from '../useCaseAuth';

describe('useCaseAuth', () => {
  it('reads the level the BFF stamped on the catalog entry', () => {
    expect(useCaseAuthLevel({ id: 'UC24', auth: 'public' })).toBe('public');
    expect(useCaseAuthLevel({ id: 'UC1', auth: 'user' })).toBe('user');
    expect(useCaseAuthLevel({ id: 'ADMIN1', auth: 'admin' })).toBe('admin');
  });

  // Fail closed: an old BFF, a cached catalog, or a typo must not make a
  // protected use case anonymously runnable.
  it.each([
    ['missing', {}],
    ['unknown value', { auth: 'anonymous' }],
    ['non-string', { auth: true }],
    ['null entry', null],
  ])('defaults to %s -> user', (_label, uc) => {
    expect(useCaseAuthLevel(uc)).toBe(DEFAULT_USE_CASE_AUTH);
    expect(useCaseAuthLevel(uc)).toBe('user');
    expect(runsSignedOut(uc)).toBe(false);
  });

  it('runsSignedOut is true only for public', () => {
    expect(runsSignedOut({ auth: 'public' })).toBe(true);
    expect(runsSignedOut({ auth: 'user' })).toBe(false);
    expect(runsSignedOut({ auth: 'admin' })).toBe(false);
  });

  it('matches a viewer against the level', () => {
    const guest = { isLoggedIn: false, isAdmin: false };
    const customer = { isLoggedIn: true, isAdmin: false };
    const admin = { isLoggedIn: true, isAdmin: true };

    expect(viewerMeetsUseCaseAuth({ auth: 'public' }, guest)).toBe(true);
    expect(viewerMeetsUseCaseAuth({ auth: 'user' }, guest)).toBe(false);
    expect(viewerMeetsUseCaseAuth({ auth: 'user' }, customer)).toBe(true);
    expect(viewerMeetsUseCaseAuth({ auth: 'admin' }, customer)).toBe(false);
    expect(viewerMeetsUseCaseAuth({ auth: 'admin' }, admin)).toBe(true);
  });

  it('treats an absent viewer as a guest', () => {
    expect(viewerMeetsUseCaseAuth({ auth: 'public' })).toBe(true);
    expect(viewerMeetsUseCaseAuth({ auth: 'user' })).toBe(false);
  });
});
