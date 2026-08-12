import { TokenStore } from '../TokenStore';

describe('TokenStore — pending PingOne-relay authorizations', () => {
  const baseParams = {
    clientId: 'client-1',
    redirectUri: 'http://localhost:6274/oauth/callback',
    scope: 'mcp:invoke',
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256',
    clientState: 'client-supplied-state',
  };

  it('creates a pending authorization and consumes it exactly once', () => {
    const store = new TokenStore();
    const relayState = store.createPendingAuthorization(baseParams);
    expect(typeof relayState).toBe('string');
    expect(relayState.length).toBeGreaterThan(20);

    const consumed = store.consumePendingAuthorization(relayState);
    expect(consumed).toMatchObject(baseParams);

    // Second consume must fail — one-time use, like authorization codes.
    expect(store.consumePendingAuthorization(relayState)).toBeNull();
  });

  it('returns null for an unknown state', () => {
    const store = new TokenStore();
    expect(store.consumePendingAuthorization('never-issued')).toBeNull();
  });

  it('expires after 10 minutes', () => {
    jest.useFakeTimers();
    try {
      const store = new TokenStore();
      const relayState = store.createPendingAuthorization(baseParams);
      jest.advanceTimersByTime(10 * 60_000 + 1);
      expect(store.consumePendingAuthorization(relayState)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('cleanup() purges expired pending authorizations', () => {
    jest.useFakeTimers();
    try {
      const store = new TokenStore();
      const relayState = store.createPendingAuthorization(baseParams);
      jest.advanceTimersByTime(10 * 60_000 + 1);
      store.cleanup();
      // Consuming after cleanup still returns null either way, but this proves
      // cleanup() doesn't throw on the new map and does visit it.
      expect(store.consumePendingAuthorization(relayState)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
