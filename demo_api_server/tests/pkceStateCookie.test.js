'use strict';

/**
 * pkceStateCookie — a malformed `_pkce` cookie must never throw into the OAuth
 * callback.
 *
 * The cookie is a FALLBACK for the session-backed PKCE state (serverless hosts
 * can route /callback to a different instance than /login). Anything that
 * escapes `readPkceCookie` as an exception surfaces at `routes/oauth.js:215` /
 * `routes/oauthUser.js:414` as a 500 or error redirect — even when the session
 * still holds valid state and the fallback was never needed. Two throws were
 * reachable from attacker-controlled cookie text:
 *
 *   crypto.timingSafeEqual  → RangeError 'Input buffers must have the same byte length'
 *   decodeURIComponent      → URIError  'URI malformed'
 *
 * Both must now answer `null`, which routes the caller to the session path.
 * `services/authStateCookie.js` has always done this; these cases pin the same
 * contract for its sibling.
 */

const { setPkceCookie, readPkceCookie, clearPkceCookie } = require('../services/pkceStateCookie');

/** Minimal Express-ish res that records what Set-Cookie would be sent. */
function makeRes() {
  const headers = [];
  return { headers, append: (name, value) => headers.push(value) };
}

/** Drive setPkceCookie and hand back the `_pkce=...` pair a browser would send. */
function issueCookie(data, { isProduction = false } = {}) {
  const res = makeRes();
  setPkceCookie(res, data, isProduction);
  return res.headers[0].split(';')[0];
}

const reqWith = (cookie) => ({ headers: { cookie } });

describe('pkceStateCookie.readPkceCookie', () => {
  const OLD_SECRET = process.env.SESSION_SECRET;

  beforeAll(() => { process.env.SESSION_SECRET = 'pkce-test-secret'; });
  afterAll(() => {
    if (OLD_SECRET === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = OLD_SECRET;
  });

  it('round-trips a cookie it issued', () => {
    const cookie = issueCookie({
      state: 'st-1', codeVerifier: 'cv-1', redirectUri: 'https://app.example/cb', nonce: 'n-1',
    });
    expect(readPkceCookie(reqWith(cookie))).toEqual({
      state: 'st-1', codeVerifier: 'cv-1', redirectUri: 'https://app.example/cb', nonce: 'n-1',
    });
  });

  it('returns null, and does NOT throw, when the signature segment is the wrong length', () => {
    // The RangeError case: timingSafeEqual requires equal byte lengths, and a
    // real signature is 43 base64url chars. This is the shape that 500'd.
    expect(() => readPkceCookie(reqWith('_pkce=abc.zz'))).not.toThrow();
    expect(readPkceCookie(reqWith('_pkce=abc.zz'))).toBeNull();
  });

  it('returns null, and does NOT throw, on malformed percent-encoding', () => {
    // The URIError case, raised while parsing the Cookie header itself.
    expect(() => readPkceCookie(reqWith('_pkce=%ZZ'))).not.toThrow();
    expect(readPkceCookie(reqWith('_pkce=%ZZ'))).toBeNull();
  });

  it('still rejects a tampered payload carrying a valid-length signature', () => {
    // Guards the guard: the fix must not turn "cannot verify" into "accept".
    const cookie = issueCookie({ state: 's', codeVerifier: 'c', redirectUri: 'https://r/cb' });
    const [name, value] = cookie.split('=');
    const [enc, sig] = decodeURIComponent(value).split('.');
    const flipped = enc.slice(0, -1) + (enc.slice(-1) === 'A' ? 'B' : 'A');
    expect(readPkceCookie(reqWith(`${name}=${encodeURIComponent(`${flipped}.${sig}`)}`))).toBeNull();
  });

  it('rejects a cookie signed with a different secret', () => {
    const cookie = issueCookie({ state: 's', codeVerifier: 'c', redirectUri: 'https://r/cb' });
    process.env.SESSION_SECRET = 'a-different-secret';
    try {
      expect(readPkceCookie(reqWith(cookie))).toBeNull();
    } finally {
      process.env.SESSION_SECRET = 'pkce-test-secret';
    }
  });

  it('returns null for an expired cookie', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-08-18T00:00:00Z'));
      const cookie = issueCookie({ state: 's', codeVerifier: 'c', redirectUri: 'https://r/cb' });
      expect(readPkceCookie(reqWith(cookie))).not.toBeNull();
      jest.setSystemTime(new Date('2026-08-18T00:16:00Z')); // MAX_AGE_MS is 15 min
      expect(readPkceCookie(reqWith(cookie))).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns null when no cookie header is present at all', () => {
    expect(readPkceCookie({ headers: {} })).toBeNull();
    expect(readPkceCookie(reqWith(''))).toBeNull();
  });

  it('clearPkceCookie appends rather than replacing a queued Set-Cookie', () => {
    // Regression: clearing _pkce must not drop a clearAuthCookie Set-Cookie
    // already queued, or logout silently keeps the _auth identity cookie.
    const res = makeRes();
    res.append('Set-Cookie', '_auth=; Max-Age=0');
    clearPkceCookie(res, false);
    expect(res.headers).toHaveLength(2);
    expect(res.headers[1]).toContain('_pkce=');
    expect(res.headers[1]).toContain('Max-Age=0');
  });
});
