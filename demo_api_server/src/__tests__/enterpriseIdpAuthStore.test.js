'use strict';

const store = require('../../services/enterpriseIdpAuthStore');

describe('enterpriseIdpAuthStore', () => {
  beforeEach(() => store.resetForTests());

  test('createCode then consumeCode returns the stored params', () => {
    const code = store.createCode({ clientId: 'c1', redirectUri: 'https://x/cb', scope: 'openid', codeChallenge: 'chal', codeChallengeMethod: 'S256', subject: 'user-1' });
    const entry = store.consumeCode(code);
    expect(entry).toMatchObject({ clientId: 'c1', redirectUri: 'https://x/cb', subject: 'user-1' });
  });

  test('consumeCode is single-use — a second consume returns null', () => {
    const code = store.createCode({ clientId: 'c1', redirectUri: 'https://x/cb', scope: 'openid', codeChallenge: 'chal', codeChallengeMethod: 'S256', subject: 'user-1' });
    store.consumeCode(code);
    expect(store.consumeCode(code)).toBeNull();
  });

  test('consumeCode returns null for an unknown code', () => {
    expect(store.consumeCode('never-issued')).toBeNull();
  });

  test('createPendingAuthorization then consumePendingAuthorization returns the stored params', () => {
    const state = store.createPendingAuthorization({
      clientId: 'c1', redirectUri: 'https://x/cb', scope: 'openid', codeChallenge: 'chal',
      codeChallengeMethod: 'S256', clientState: 'client-state-xyz', pingOneCodeVerifier: 'verifier-abc',
    });
    const entry = store.consumePendingAuthorization(state);
    expect(entry).toMatchObject({ clientId: 'c1', clientState: 'client-state-xyz', pingOneCodeVerifier: 'verifier-abc' });
  });

  test('consumePendingAuthorization is single-use — a second consume returns null', () => {
    const state = store.createPendingAuthorization({
      clientId: 'c1', redirectUri: 'https://x/cb', scope: 'openid', codeChallenge: 'chal',
      codeChallengeMethod: 'S256', clientState: '', pingOneCodeVerifier: 'verifier-abc',
    });
    store.consumePendingAuthorization(state);
    expect(store.consumePendingAuthorization(state)).toBeNull();
  });

  test('consumeCode returns null once the code has expired', () => {
    jest.useFakeTimers();
    const code = store.createCode({ clientId: 'c1', redirectUri: 'https://x/cb', scope: 'openid', codeChallenge: 'chal', codeChallengeMethod: 'S256', subject: 'user-1' });
    jest.advanceTimersByTime(61_000);
    expect(store.consumeCode(code)).toBeNull();
    jest.useRealTimers();
  });
});
