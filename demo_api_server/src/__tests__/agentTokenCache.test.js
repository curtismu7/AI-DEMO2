/**
 * agentTokenCache — session-scoped agent-token cache keyed by (vertical, scopeSet).
 * Reused within a (vertical, scopeSet) combo; a switch is a deliberate cache miss.
 * Cleared on logout for free via req.session.destroy().
 */
const cache = require('../../services/agentTokenCache');

describe('agentTokenCache', () => {
  it('set then get returns the token within the same (vertical, scopeSet)', () => {
    const session = {};
    cache.set(session, 'healthcare', ['records:read'], { access_token: 'tok', expires_in: 3600 });
    const got = cache.get(session, 'healthcare', ['records:read']);
    expect(got.access_token).toBe('tok');
  });

  it('scopeSet order does not matter (key is sorted)', () => {
    const session = {};
    cache.set(session, 'banking', ['write', 'read'], { access_token: 'tok', expires_in: 3600 });
    expect(cache.get(session, 'banking', ['read', 'write']).access_token).toBe('tok');
  });

  it('different vertical or scopeSet is a cache miss', () => {
    const session = {};
    cache.set(session, 'healthcare', ['records:read'], { access_token: 'tok', expires_in: 3600 });
    expect(cache.get(session, 'retail', ['records:read'])).toBeNull();
    expect(cache.get(session, 'healthcare', ['records:read', 'write'])).toBeNull();
  });

  it('an expired entry returns null', () => {
    const session = {};
    cache.set(session, 'banking', ['read'], { access_token: 'tok', expires_in: 3600 });
    // Backdate the cached entry's expiry to simulate an elapsed TTL.
    session.agentTokens[cache.keyFor('banking', ['read'])].expires_at = Date.now() - 1;
    expect(cache.get(session, 'banking', ['read'])).toBeNull();
  });

  it('null/absent session is safe', () => {
    expect(cache.get(null, 'banking', ['read'])).toBeNull();
    expect(() => cache.set(null, 'banking', ['read'], { access_token: 'x' })).not.toThrow();
  });
});
