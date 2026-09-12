'use strict';

/**
 * Every session-destruction path must drop the in-process caches keyed by
 * session id. They used to live on req.session, where destroy() dropped them for
 * free; moving them off it (REGRESSION_PLAN §4) made clearing the caller's job,
 * and the first cut wired only the two OAuth logout handlers — admin kill-switch,
 * refresh-expiry and the unified logout orphaned entries until their sweep
 * (Greptile P1 on #3151).
 *
 * setup.js runs jest.resetModules() per test, so require the modules INSIDE each
 * test or the helper clears a different registry's maps than the one asserted on.
 */

describe('clearSessionScopedCaches', () => {
  const session = (id) => ({ id });

  it('drops both the agent token and the DPoP key for that session', () => {
    const tokens = require('../services/agentTokenCache');
    const dpop = require('../services/dpopKeyService');
    const { clearSessionScopedCaches } = require('../services/sessionScopedCaches');

    const mine = session('s-scoped-mine');
    const other = session('s-scoped-other');
    tokens.set(mine, 'banking', ['read'], { access_token: 'mine', expires_in: 3600 });
    tokens.set(other, 'banking', ['read'], { access_token: 'theirs', expires_in: 3600 });
    const mintedForOther = dpop.getSessionDpopKey({ session: other });
    dpop.getSessionDpopKey({ session: mine });

    clearSessionScopedCaches(mine);

    expect(tokens.get(mine, 'banking', ['read'])).toBeNull();
    expect(dpop.peekSessionDpopKey(mine)).toBeNull();
    // Only that session's entries — a logout must not evict everyone else's.
    expect(tokens.get(other, 'banking', ['read']).access_token).toBe('theirs');
    expect(dpop.peekSessionDpopKey(other).jkt).toBe(mintedForOther.jkt);
  });

  it('is safe on a missing or idless session — teardown paths must never throw', () => {
    const { clearSessionScopedCaches } = require('../services/sessionScopedCaches');
    expect(() => clearSessionScopedCaches(undefined)).not.toThrow();
    expect(() => clearSessionScopedCaches(null)).not.toThrow();
    expect(() => clearSessionScopedCaches({})).not.toThrow();
  });
});
