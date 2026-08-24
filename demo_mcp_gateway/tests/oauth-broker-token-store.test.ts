import { BrokerTokenStore } from '../src/oauth/BrokerTokenStore';

describe('BrokerTokenStore', () => {
  it('round-trips a pending authorization', () => {
    const store = new BrokerTokenStore();
    const state = store.createPendingAuthorization({
      clientId: 'client-1',
      redirectUri: 'http://127.0.0.1:1234/callback',
      scope: 'mcp:invoke',
      codeChallenge: 'abc',
      codeChallengeMethod: 'S256',
      clientState: 'client-supplied-state',
      pingOneCodeVerifier: 'verifier-123',
    });
    const pending = store.consumePendingAuthorization(state);
    expect(pending).not.toBeNull();
    expect(pending?.clientId).toBe('client-1');
    expect(pending?.pingOneCodeVerifier).toBe('verifier-123');
  });

  it('a pending authorization can only be consumed once', () => {
    const store = new BrokerTokenStore();
    const state = store.createPendingAuthorization({
      clientId: 'client-1', redirectUri: 'http://127.0.0.1:1234/callback',
      scope: 'mcp:invoke', codeChallenge: 'abc', codeChallengeMethod: 'S256',
      clientState: '', pingOneCodeVerifier: 'v',
    });
    expect(store.consumePendingAuthorization(state)).not.toBeNull();
    expect(store.consumePendingAuthorization(state)).toBeNull();
  });

  it('round-trips an issued code carrying the real PingOne token', () => {
    const store = new BrokerTokenStore();
    const code = store.createCode({
      clientId: 'client-1', redirectUri: 'http://127.0.0.1:1234/callback',
      scope: 'mcp:invoke', pingOneAccessToken: 'real-pingone-jwt', pingOneExpiresIn: 3600,
    });
    const issued = store.consumeCode(code);
    expect(issued).not.toBeNull();
    expect(issued?.pingOneAccessToken).toBe('real-pingone-jwt');
  });

  it('an issued code can only be consumed once', () => {
    const store = new BrokerTokenStore();
    const code = store.createCode({
      clientId: 'client-1', redirectUri: 'http://127.0.0.1:1234/callback',
      scope: 'mcp:invoke', pingOneAccessToken: 't', pingOneExpiresIn: 3600,
    });
    expect(store.consumeCode(code)).not.toBeNull();
    expect(store.consumeCode(code)).toBeNull();
  });

  it('an expired code is not returned', () => {
    const store = new BrokerTokenStore();
    const code = store.createCode({
      clientId: 'client-1', redirectUri: 'http://127.0.0.1:1234/callback',
      scope: 'mcp:invoke', pingOneAccessToken: 't', pingOneExpiresIn: 3600,
    }, -1);
    expect(store.consumeCode(code)).toBeNull();
  });
});
