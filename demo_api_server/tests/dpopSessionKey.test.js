'use strict';

/**
 * The per-session DPoP keypair is held in this process, keyed by session id —
 * NOT on req.session. Stored there, minting it MUTATED the session, so
 * express-session wrote that request's whole start-of-request copy back when the
 * request ended. Since the mint happens on a session's FIRST token exchange, a
 * mode change made while that exchange ran was undone (reproduced live
 * 2026-09-12 against a session whose first exchange WAS the spanning request).
 * Same last-write-wins class as /api/agent/run and the agent-token cache before
 * it — REGRESSION_PLAN §4.
 *
 * The pure crypto signer (keypair generation, thumbprint, proof signing) is
 * covered by src/__tests__/dpopKeyService.test.js; this spec covers only the
 * session-scoped storage.
 */

const {
  getSessionDpopKey,
  peekSessionDpopKey,
  clearSessionDpopKey,
} = require('../services/dpopKeyService');

describe('dpopKeyService — per-session key, off the session', () => {
  const reqFor = (id) => ({ session: { id } });

  it('returns a key without writing it onto the session', () => {
    const req = reqFor('s-dpop-1');
    const key = getSessionDpopKey(req);
    expect(key.jkt).toHaveLength(43);
    expect(req.session.dpopKey).toBeUndefined();
    expect(Object.keys(req.session)).toEqual(['id']);
  });

  it('returns the SAME key for the same session id', () => {
    // The delegated token is bound to this key (cnf.jkt); a second key would
    // sign proofs the gateway cannot match to the token it issued.
    const first = getSessionDpopKey(reqFor('s-dpop-stable'));
    const second = getSessionDpopKey(reqFor('s-dpop-stable'));
    expect(second.jkt).toBe(first.jkt);
    expect(second.privatePem).toBe(first.privatePem);
  });

  it('gives different sessions different keys', () => {
    const a = getSessionDpopKey(reqFor('s-dpop-a'));
    const b = getSessionDpopKey(reqFor('s-dpop-b'));
    expect(b.jkt).not.toBe(a.jkt);
  });

  it('peek returns null before a mint and the key after — it never mints', () => {
    // mcpToolPipeline reads the key only when the token exchange already minted
    // one ("never create one here"), so the read path must not create.
    const req = reqFor('s-dpop-peek');
    expect(peekSessionDpopKey(req.session)).toBeNull();
    const minted = getSessionDpopKey(req);
    expect(peekSessionDpopKey(req.session).jkt).toBe(minted.jkt);
  });

  it('peek counts as use — the sweep cannot evict a key the pipeline is still signing with', () => {
    // The pipeline signs every hop through peek and may never re-enter
    // getSessionDpopKey, so a read must keep the entry alive. Otherwise the 12h
    // disuse sweep drops a key a live token is still bound to (Greptile P1 on #3151).
    jest.useFakeTimers();
    try {
      const req = reqFor('s-dpop-ttl');
      const minted = getSessionDpopKey(req);
      jest.advanceTimersByTime(11 * 60 * 60 * 1000);
      expect(peekSessionDpopKey(req.session).jkt).toBe(minted.jkt);
      // 13h since the mint, but only 2h since that read.
      jest.advanceTimersByTime(2 * 60 * 60 * 1000);
      expect(getSessionDpopKey(req).jkt).toBe(minted.jkt);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clear drops this session\'s key and leaves other sessions alone', () => {
    const mine = reqFor('s-dpop-clear');
    const other = reqFor('s-dpop-keep');
    getSessionDpopKey(mine);
    const theirs = getSessionDpopKey(other);

    clearSessionDpopKey(mine.session);

    expect(peekSessionDpopKey(mine.session)).toBeNull();
    expect(peekSessionDpopKey(other.session).jkt).toBe(theirs.jkt);
  });

  it('no session, or a session with no id, yields null and never throws', () => {
    expect(getSessionDpopKey(null)).toBeNull();
    expect(getSessionDpopKey({})).toBeNull();
    expect(getSessionDpopKey({ session: {} })).toBeNull();
    expect(peekSessionDpopKey(null)).toBeNull();
    expect(peekSessionDpopKey({})).toBeNull();
    expect(() => clearSessionDpopKey(null)).not.toThrow();
  });
});
