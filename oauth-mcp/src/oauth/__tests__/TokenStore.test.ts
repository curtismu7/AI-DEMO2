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

      // Create one that will expire
      const expiredState = store.createPendingAuthorization(baseParams);

      // Advance time so only the first expires (10 min + 1ms)
      jest.advanceTimersByTime(10 * 60_000 + 1);

      // Create one that will NOT expire (created after time advance, so fresh 10-min window)
      const validState = store.createPendingAuthorization({
        ...baseParams,
        clientState: 'valid-state',
      });

      // Call cleanup() — this must actually purge the expired entry
      store.cleanup();

      // The expired entry must be gone FROM THE MAP (not just return null from consumePendingAuthorization,
      // which could mask a cleanup bug). Use private field inspection to verify.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((store as any).pending.has(expiredState)).toBe(false);

      // The valid entry must still be in the map and consumable
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((store as any).pending.has(validState)).toBe(true);
      expect(store.consumePendingAuthorization(validState)).toMatchObject({
        ...baseParams,
        clientState: 'valid-state',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
