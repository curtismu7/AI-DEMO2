import { TokenStore, IssuedToken } from '../TokenStore';
import type { IEncryptedTokenStorage } from '../../storage/interfaces';

/** In-memory stand-in for EncryptedTokenStorage — no filesystem I/O. */
function makeFakeStorage(): IEncryptedTokenStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async store(key, value) { data.set(key, value); },
    async retrieve(key) { return data.has(key) ? data.get(key) : null; },
    async remove(key) { data.delete(key); },
    async exists(key) { return data.has(key); },
    async cleanup() {},
    async getAllKeys() { return [...data.keys()]; },
  };
}

describe('TokenStore — pending PingOne-relay authorizations', () => {
  const baseParams = {
    clientId: 'client-1',
    redirectUri: 'http://localhost:6274/oauth/callback',
    scope: 'mcp:invoke',
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256',
    clientState: 'client-supplied-state',
    pingOneCodeVerifier: 'pingone-pkce-verifier',
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

describe('TokenStore — issued token persistence', () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  function makeIssuedToken(overrides: Partial<IssuedToken> = {}): IssuedToken {
    return {
      jti: 'jti-1',
      clientId: 'client-1',
      subject: 'real-pingone-user',
      scope: 'mcp:invoke read',
      issuedAt: nowSeconds(),
      expiresAt: nowSeconds() + 3600,
      revoked: false,
      pingOneAccessToken: 'real-pingone-access-token',
      ...overrides,
    };
  }

  it('without attachStorage, behaves exactly as before (in-memory only)', () => {
    const store = new TokenStore();
    store.trackToken(makeIssuedToken());
    expect(store.introspect('jti-1')).toMatchObject({ pingOneAccessToken: 'real-pingone-access-token' });
  });

  it('trackToken persists to storage, and a fresh TokenStore restores it via attachStorage', async () => {
    const storage = makeFakeStorage();
    const store = new TokenStore();
    await store.attachStorage(storage);
    store.trackToken(makeIssuedToken());
    // trackToken's persist is fire-and-forget — flush microtasks before reading storage.
    await Promise.resolve();

    // Simulates the exact failure this fix targets: a pod restart wipes
    // in-memory state, but the durable storage (a PVC-backed volume) survives.
    const freshStore = new TokenStore();
    await freshStore.attachStorage(storage);
    expect(freshStore.introspect('jti-1')).toMatchObject({ pingOneAccessToken: 'real-pingone-access-token' });
  });

  it('does not restore an already-expired token', async () => {
    const storage = makeFakeStorage();
    const store = new TokenStore();
    await store.attachStorage(storage);
    store.trackToken(makeIssuedToken({ jti: 'jti-expired', expiresAt: nowSeconds() - 3600 }));
    await Promise.resolve();

    const freshStore = new TokenStore();
    await freshStore.attachStorage(storage);
    expect(freshStore.introspect('jti-expired')).toBeNull();
  });

  it('does not restore a revoked token', async () => {
    const storage = makeFakeStorage();
    const store = new TokenStore();
    await store.attachStorage(storage);
    store.trackToken(makeIssuedToken({ jti: 'jti-revoked' }));
    store.revoke('jti-revoked');
    await Promise.resolve();

    const freshStore = new TokenStore();
    await freshStore.attachStorage(storage);
    expect(freshStore.introspect('jti-revoked')).toBeNull();
  });

  it('cleanup() purges expired issued tokens and persists the pruned set', async () => {
    const storage = makeFakeStorage();
    const store = new TokenStore();
    await store.attachStorage(storage);
    store.trackToken(makeIssuedToken({ jti: 'jti-live', expiresAt: nowSeconds() + 3600 }));
    store.trackToken(makeIssuedToken({ jti: 'jti-dead', expiresAt: nowSeconds() - 60 }));
    await Promise.resolve();

    store.cleanup();
    await Promise.resolve();

    expect(store.introspect('jti-live')).not.toBeNull();
    expect(store.introspect('jti-dead')).toBeNull();

    const freshStore = new TokenStore();
    await freshStore.attachStorage(storage);
    expect(freshStore.introspect('jti-live')).not.toBeNull();
    expect(freshStore.introspect('jti-dead')).toBeNull();
  });

  it('a storage failure on attachStorage does not throw — falls back to in-memory', async () => {
    const failingStorage: IEncryptedTokenStorage = {
      store: async () => { throw new Error('disk full'); },
      retrieve: async () => { throw new Error('disk full'); },
      remove: async () => {},
      exists: async () => false,
      cleanup: async () => {},
      getAllKeys: async () => [],
    };
    const store = new TokenStore();
    await expect(store.attachStorage(failingStorage)).resolves.toBeUndefined();
    store.trackToken(makeIssuedToken());
    expect(store.introspect('jti-1')).not.toBeNull();
  });
});
