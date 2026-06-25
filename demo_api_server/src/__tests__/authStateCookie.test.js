'use strict';
/**
 * Tests for services/authStateCookie.js
 *
 * Covers:
 *   - setAuthCookie   – writes an HMAC-signed cookie header
 *   - readAuthCookie  – parses and verifies the cookie
 *   - clearAuthCookie – sets Max-Age=0 to expire the cookie
 *   - restoreSessionFromCookie middleware – populates req.session from cookie
 *
 * All tests run purely in-process (no HTTP server needed).
 */

const crypto = require('crypto');
const {
  setAuthCookie,
  readAuthCookie,
  clearAuthCookie,
  restoreSessionFromCookie,
} = require('../../services/authStateCookie');

// ── helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal Express-like mock response that tracks Set-Cookie headers. */
function mockRes() {
  let cookie = undefined;
  return {
    getHeader: (name) => (name.toLowerCase() === 'set-cookie' ? cookie : undefined),
    setHeader: (name, value) => {
      if (name.toLowerCase() === 'set-cookie') cookie = value;
    },
    getCookie: () => cookie,
  };
}

/** Build a minimal mock request with cookie header. */
function mockReq(cookieHeader = '') {
  return {
    headers: { cookie: cookieHeader },
    session: {},
  };
}

/**
 * Extract the raw cookie value (the signed token, before Set-Cookie flags)
 * from whatever setHeader received.
 */
function extractCookieValue(setCookieHeader) {
  // Handles both string and string[]
  const str = Array.isArray(setCookieHeader) ? setCookieHeader.find(s => s.startsWith('_auth=')) : setCookieHeader;
  if (!str) return null;
  const eq = str.indexOf('=');
  const semi = str.indexOf(';', eq);
  const raw = str.slice(eq + 1, semi === -1 ? undefined : semi);
  return decodeURIComponent(raw);
}

/** Build a valid user data object for cookie tests. */
function sampleData(overrides = {}) {
  return {
    id:        'user-001',
    email:     'alice@example.com',
    firstName: 'Alice',
    lastName:  'Smith',
    role:      'customer',
    oauthType: 'user',
    expiresAt:  Date.now() + 60 * 60 * 1000, // 1 hour from now
    ...overrides,
  };
}

// ── setAuthCookie ──────────────────────────────────────────────────────────────

describe('setAuthCookie', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-for-cookie-tests';
  });

  it('sets a Set-Cookie header on the response', () => {
    const res = mockRes();
    setAuthCookie(res, sampleData(), false);
    expect(res.getCookie()).toBeTruthy();
  });

  it('cookie header contains _auth= name', () => {
    const res = mockRes();
    setAuthCookie(res, sampleData(), false);
    const header = res.getCookie();
    const str = Array.isArray(header) ? header.join('; ') : header;
    expect(str).toMatch(/_auth=/);
  });

  it('includes HttpOnly flag', () => {
    const res = mockRes();
    setAuthCookie(res, sampleData(), false);
    const header = res.getCookie();
    const str = Array.isArray(header) ? header.join(' ') : header;
    expect(str).toMatch(/HttpOnly/i);
  });

  it('includes Secure + SameSite=None in production mode', () => {
    const res = mockRes();
    setAuthCookie(res, sampleData(), true /* isProduction */);
    const str = Array.isArray(res.getCookie()) ? res.getCookie().join(' ') : res.getCookie();
    expect(str).toMatch(/Secure/);
    expect(str).toMatch(/SameSite=None/);
  });

  it('uses SameSite=Lax (not Secure) in dev mode', () => {
    const res = mockRes();
    setAuthCookie(res, sampleData(), false /* dev */);
    const str = Array.isArray(res.getCookie()) ? res.getCookie().join(' ') : res.getCookie();
    expect(str).toMatch(/SameSite=Lax/);
    expect(str).not.toMatch(/\bSecure\b/);
  });

  it('appends to existing Set-Cookie array without overwriting', () => {
    const res = mockRes();
    // Pre-set another cookie so we can check it is preserved
    res.setHeader('Set-Cookie', ['session=abc; HttpOnly']);
    setAuthCookie(res, sampleData(), false);
    const header = res.getCookie();
    expect(Array.isArray(header)).toBe(true);
    expect(header.some(h => h.startsWith('session='))).toBe(true);
    expect(header.some(h => h.startsWith('_auth='))).toBe(true);
  });

  it('appends to an existing Set-Cookie string', () => {
    const res = mockRes();
    res.setHeader('Set-Cookie', 'session=abc; HttpOnly');
    setAuthCookie(res, sampleData(), false);
    const header = res.getCookie();
    expect(Array.isArray(header)).toBe(true);
    expect(header.length).toBe(2);
  });
});

// ── readAuthCookie ──────────────────────────────────────────────────────────────

describe('readAuthCookie', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-for-cookie-tests';
  });

  function roundtrip(data) {
    const res = mockRes();
    setAuthCookie(res, data, false);
    const rawValue = extractCookieValue(res.getCookie());
    const req = mockReq(`_auth=${encodeURIComponent(rawValue)}`);
    return readAuthCookie(req);
  }

  it('returns null when no _auth cookie present', () => {
    const req = mockReq('');
    expect(readAuthCookie(req)).toBeNull();
  });

  it('returns null when cookie header is missing entirely', () => {
    const req = { headers: {}, session: {} };
    expect(readAuthCookie(req)).toBeNull();
  });

  it('returns user object for a freshly-set cookie', () => {
    const data = sampleData();
    const user = roundtrip(data);
    expect(user).not.toBeNull();
    expect(user.email).toBe('alice@example.com');
    expect(user.firstName).toBe('Alice');
    expect(user.role).toBe('customer');
    expect(user.oauthType).toBe('user');
  });

  it('returns null for a tampered cookie (bad signature)', () => {
    const res = mockRes();
    setAuthCookie(res, sampleData(), false);
    const rawValue = extractCookieValue(res.getCookie());

    // Corrupt the signature (last segment after final '.') 
    const parts = rawValue.split('.');
    parts[parts.length - 1] = 'TAMPERED' + parts[parts.length - 1];
    const bad = parts.join('.');

    const req = mockReq(`_auth=${encodeURIComponent(bad)}`);
    expect(readAuthCookie(req)).toBeNull();
  });

  it('returns null when the cookie is expired', () => {
    const data = sampleData({ expiresAt: Date.now() - 1000 }); // 1 second ago
    const user = roundtrip(data);
    expect(user).toBeNull();
  });

  it('returns null if cookie value is the empty string', () => {
    const req = mockReq('_auth=');
    expect(readAuthCookie(req)).toBeNull();
  });

  it('returns null if the SECRET changes (different server instance)', () => {
    const res = mockRes();
    setAuthCookie(res, sampleData(), false); // signed with 'test-secret-...'
    const rawValue = extractCookieValue(res.getCookie());

    // Change the secret to simulate a different instance/key rotation
    process.env.SESSION_SECRET = 'DIFFERENT-SECRET';
    const req = mockReq(`_auth=${encodeURIComponent(rawValue)}`);
    expect(readAuthCookie(req)).toBeNull();

    // Restore
    process.env.SESSION_SECRET = 'test-secret-for-cookie-tests';
  });
});

// ── clearAuthCookie ────────────────────────────────────────────────────────────

describe('clearAuthCookie', () => {
  it('sets Max-Age=0 to expire the cookie', () => {
    const res = mockRes();
    clearAuthCookie(res, false);
    const str = Array.isArray(res.getCookie()) ? res.getCookie().join(' ') : res.getCookie();
    expect(str).toMatch(/Max-Age=0/);
  });

  it('keeps _auth= name in the clearing header', () => {
    const res = mockRes();
    clearAuthCookie(res, false);
    const str = Array.isArray(res.getCookie()) ? res.getCookie().join(' ') : res.getCookie();
    expect(str).toMatch(/_auth=/);
  });
});

// ── restoreSessionFromCookie middleware ────────────────────────────────────────

describe('restoreSessionFromCookie middleware', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-for-cookie-tests';
  });

  function buildRequest(data) {
    const res = mockRes();
    setAuthCookie(res, data, false);
    const rawValue = extractCookieValue(res.getCookie());
    return {
      headers: { cookie: `_auth=${encodeURIComponent(rawValue)}` },
      session: {},
    };
  }

  it('populates req.session.user from a valid _auth cookie', (done) => {
    const req = buildRequest(sampleData());
    restoreSessionFromCookie(req, {}, () => {
      expect(req.session.user).toBeTruthy();
      expect(req.session.user.email).toBe('alice@example.com');
      done();
    });
  });

  it('sets req.session.oauthType to match the cookie oauthType', (done) => {
    const req = buildRequest(sampleData({ oauthType: 'admin' }));
    restoreSessionFromCookie(req, {}, () => {
      expect(req.session.oauthType).toBe('admin');
      done();
    });
  });

  it('marks session as restored from cookie', (done) => {
    const req = buildRequest(sampleData());
    restoreSessionFromCookie(req, {}, () => {
      expect(req.session._restoredFromCookie).toBe(true);
      done();
    });
  });

  it('injects a synthetic oauthTokens stub so /status endpoints see accessToken', (done) => {
    const req = buildRequest(sampleData());
    restoreSessionFromCookie(req, {}, () => {
      expect(req.session.oauthTokens).toBeTruthy();
      expect(req.session.oauthTokens.accessToken).toBe('_cookie_session');
      done();
    });
  });

  it('does NOT overwrite an existing session.user', (done) => {
    const req = buildRequest(sampleData());
    req.session.user = { id: 'already-set', email: 'existing@example.com' };
    restoreSessionFromCookie(req, {}, () => {
      // Should not override — middleware only acts when session.user is absent
      expect(req.session.user.email).toBe('existing@example.com');
      done();
    });
  });

  it('calls next() even when no cookie is present', (done) => {
    const req = mockReq('');
    restoreSessionFromCookie(req, {}, () => {
      expect(req.session.user).toBeUndefined();
      done();
    });
  });

  it('calls next() even when the cookie is tampered', (done) => {
    const req = mockReq('_auth=totallyInvalidValue.badSig');
    restoreSessionFromCookie(req, {}, () => {
      expect(req.session.user).toBeUndefined();
      done();
    });
  });

  it('does not restore if cookie is expired', (done) => {
    const req = buildRequest(sampleData({ expiresAt: Date.now() - 5000 }));
    restoreSessionFromCookie(req, {}, () => {
      expect(req.session.user).toBeUndefined();
      done();
    });
  });
});
