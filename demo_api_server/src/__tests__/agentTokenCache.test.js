/**
 * agentTokenCache — agent-token cache keyed by (session id, vertical, scopeSet).
 *
 * Held in process, NOT on req.session. It used to live under
 * req.session.agentTokens, which made every long request that missed the cache
 * save its whole session copy when it ended: an 11s POST /api/demo-agent/tools
 * on a cold cache wrote back the session as it was when the request started,
 * undoing an agent-mode change made meanwhile (live, 2026-09-11 — same
 * last-write-wins class as REGRESSION_PLAN §4's /api/agent/run entry).
 *
 * setup.js runs jest.resetModules() per test, so the map starts empty in each.
 */

describe('agentTokenCache', () => {
  const sess = (id) => ({ id });

  it('set then get returns the token within the same (vertical, scopeSet)', () => {
    const cache = require('../../services/agentTokenCache');
    const session = sess('s-1');
    cache.set(session, 'healthcare', ['records:read'], { access_token: 'tok', expires_in: 3600 });
    expect(cache.get(session, 'healthcare', ['records:read']).access_token).toBe('tok');
  });

  it('never writes the token onto the session', () => {
    const cache = require('../../services/agentTokenCache');
    const session = sess('s-nowrite');
    cache.set(session, 'banking', ['read'], { access_token: 'tok', expires_in: 3600 });
    expect(session.agentTokens).toBeUndefined();
    expect(Object.keys(session)).toEqual(['id']);
  });

  it('scopeSet order does not matter (key is sorted)', () => {
    const cache = require('../../services/agentTokenCache');
    const session = sess('s-2');
    cache.set(session, 'banking', ['write', 'read'], { access_token: 'tok', expires_in: 3600 });
    expect(cache.get(session, 'banking', ['read', 'write']).access_token).toBe('tok');
  });

  it('different vertical or scopeSet is a cache miss', () => {
    const cache = require('../../services/agentTokenCache');
    const session = sess('s-3');
    cache.set(session, 'healthcare', ['records:read'], { access_token: 'tok', expires_in: 3600 });
    expect(cache.get(session, 'retail', ['records:read'])).toBeNull();
    expect(cache.get(session, 'healthcare', ['records:read', 'write'])).toBeNull();
  });

  it('another session never sees this session\'s token', () => {
    const cache = require('../../services/agentTokenCache');
    cache.set(sess('s-mine'), 'banking', ['read'], { access_token: 'tok', expires_in: 3600 });
    expect(cache.get(sess('s-theirs'), 'banking', ['read'])).toBeNull();
  });

  it('an expired entry returns null', () => {
    const cache = require('../../services/agentTokenCache');
    const session = sess('s-4');
    // 60s of lifetime is exactly the safety margin the cache subtracts.
    cache.set(session, 'banking', ['read'], { access_token: 'tok', expires_in: 60 });
    expect(cache.get(session, 'banking', ['read'])).toBeNull();
  });

  it('newest() returns the latest-expiring non-expired token for the session', () => {
    const cache = require('../../services/agentTokenCache');
    const session = sess('s-5');
    cache.set(session, 'banking', ['mcp:invoke'], { access_token: 'tok-old', expires_in: 120 });
    cache.set(session, 'banking', ['mcp:invoke', 'openid'], { access_token: 'tok-new', expires_in: 240 });
    cache.set(session, 'banking', ['stale'], { access_token: 'tok-stale', expires_in: 60 });
    expect(cache.newest(session)).toBe('tok-new');
    expect(cache.newest(sess('s-none'))).toBeNull();
  });

  it('clear() drops the session\'s tokens and leaves other sessions alone', () => {
    const cache = require('../../services/agentTokenCache');
    const mine = sess('s-clear');
    const other = sess('s-keep');
    cache.set(mine, 'banking', ['read'], { access_token: 'mine', expires_in: 3600 });
    cache.set(other, 'banking', ['read'], { access_token: 'theirs', expires_in: 3600 });

    cache.clear(mine);

    expect(cache.get(mine, 'banking', ['read'])).toBeNull();
    expect(cache.get(other, 'banking', ['read']).access_token).toBe('theirs');
  });

  it('a session with no id is uncached, never an error', () => {
    const cache = require('../../services/agentTokenCache');
    const anon = {};
    expect(() => cache.set(anon, 'banking', ['read'], { access_token: 'x', expires_in: 3600 })).not.toThrow();
    expect(cache.get(anon, 'banking', ['read'])).toBeNull();
    expect(cache.newest(anon)).toBeNull();
  });

  it('null/absent session is safe', () => {
    const cache = require('../../services/agentTokenCache');
    expect(cache.get(null, 'banking', ['read'])).toBeNull();
    expect(() => cache.set(null, 'banking', ['read'], { access_token: 'x' })).not.toThrow();
    expect(cache.newest(null)).toBeNull();
    expect(() => cache.clear(null)).not.toThrow();
  });
});
