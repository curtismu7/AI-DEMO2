'use strict';

/**
 * authStateCookie.js
 *
 * Serverless / multi-instance deployments cannot share in-memory sessions across
 * function invocations.  After a successful OAuth callback the session is saved
 * to a particular instance's memory; the very next request (e.g. React's
 * /api/auth/oauth/user/status) may land on a *different* instance and find an
 * empty session → user appears not signed in.
 *
 * Fix: after each successful login we write a small, HMAC-signed, HTTP-only
 * cookie (_auth) containing just enough identity to answer /status requests and
 * authorise the banking-agent chat.  A middleware in server.js reads this cookie
 * and restores req.session.user when the session is empty.
 *
 * Cookie contents (signed JSON):
 *   u   – userId
 *   e   – email
 *   fn  – firstName
 *   ln  – lastName
 *   r   – role
 *   t   – oauthType ('admin' | 'user')
 *   exp – Unix ms expiry
 *
 * No access token is stored (it would be too large and sensitive).
 * Routes that need the access token must use a persistent session store (Redis).
 */

const crypto = require('crypto');
const dataStore = require('../data/store');

const COOKIE_NAME  = '_auth';
const COOKIE_PATH  = '/';

/**
 * HMAC-sign `payload` string.
 * Returns `<base64url(payload)>.<base64url(hmac)>`.
 */
function _sign(payload) {
  const secret = process.env.SESSION_SECRET || 'dev-fallback';
  const enc    = Buffer.from(payload, 'utf8').toString('base64url');
  const sig    = crypto.createHmac('sha256', secret).update(enc).digest('base64url');
  return `${enc}.${sig}`;
}

function _verify(value) {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const enc = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const secret = process.env.SESSION_SECRET || 'dev-fallback';
  const expected = crypto.createHmac('sha256', secret).update(enc).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return Buffer.from(enc, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function _parseCookieHeader(req) {
  const header = req.headers && req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return [part.trim(), ''];
      return [part.slice(0, eq).trim(), decodeURIComponent(part.slice(eq + 1).trim())];
    })
  );
}

function _buildSetCookieHeader(value, maxAge, isProduction) {
  const flags = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'HttpOnly',
    `Max-Age=${maxAge}`,
    `Path=${COOKIE_PATH}`,
  ];
  if (isProduction) {
    flags.push('Secure');
    flags.push('SameSite=None');
  } else {
    flags.push('SameSite=Lax');
  }
  return flags.join('; ');
}

/**
 * Set the auth state cookie on the response.
 * @param {object} res
 * @param {{ id, email, firstName, lastName, role, oauthType, expiresAt }} data
 * @param {boolean} isProduction
 */
function setAuthCookie(res, data, isProduction) {
  const maxAgeSec = Math.max(0, Math.floor(((data.expiresAt || Date.now() + 24 * 60 * 60 * 1000) - Date.now()) / 1000));
  const payload = JSON.stringify({
    u:   data.id,
    e:   data.email,
    fn:  data.firstName,
    ln:  data.lastName,
    r:   data.role,
    t:   data.oauthType || 'user',
    exp: data.expiresAt || (Date.now() + 24 * 60 * 60 * 1000),
    // id_token stored for RP-Initiated Logout (id_token_hint) when server session is lost.
    // id_tokens are not bearer credentials — they cannot be used to call APIs.
    it:  data.idToken || null,
  });
  const signed = _sign(payload);

  // append to existing Set-Cookie header(s) if present
  const existing = res.getHeader('Set-Cookie');
  const newHeader = _buildSetCookieHeader(signed, maxAgeSec, isProduction);
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, newHeader]);
  } else if (existing) {
    res.setHeader('Set-Cookie', [existing, newHeader]);
  } else {
    res.setHeader('Set-Cookie', newHeader);
  }
}

/**
 * Read and verify the auth state cookie.
 * Returns the user-like object or null.
 */
function readAuthCookie(req) {
  const cookies = _parseCookieHeader(req);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  const payload = _verify(decodeURIComponent(raw));
  if (!payload) return null;
  try {
    const obj = JSON.parse(payload);
    const expiresAt = obj.exp || obj.expiresAt;
    if (!expiresAt || Date.now() > expiresAt) return null;
    return {
      id:        obj.u || obj.id || null,
      username:  obj.un || obj.username || null,
      email:     obj.e || obj.email || null,
      firstName: obj.fn || obj.firstName || null,
      lastName:  obj.ln || obj.lastName || null,
      role:      obj.r || obj.role || 'user',
      oauthType: obj.t || obj.oauthType || 'user',
      idToken:   obj.it || null,
      expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Clear the auth cookie.
 */
function clearAuthCookie(res, isProduction) {
  const existing = res.getHeader('Set-Cookie');
  const newHeader = _buildSetCookieHeader('', 0, isProduction);
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, newHeader]);
  } else if (existing) {
    res.setHeader('Set-Cookie', [existing, newHeader]);
  } else {
    res.setHeader('Set-Cookie', newHeader);
  }
}

/**
 * Express middleware: if req.session.user is absent but a valid _auth cookie
 * exists, restore enough session state to answer /status and /nl requests.
 * This is a read-only fallback — no tokens are available, so routes that need
 * req.session.oauthTokens.accessToken must still return appropriate errors.
 */
function restoreSessionFromCookie(req, _res, next) {
  if (!req.session.user) {
    const auth = readAuthCookie(req);
    if (auth) {
      const hydratedUser = (() => {
        if (auth.id && auth.email) return auth;
        const users = dataStore.getAllUsers();
        const matched = users.find((u) =>
          (auth.email && u.email === auth.email) ||
          (auth.username && u.username === auth.username) ||
          (auth.id && (u.id === auth.id || u.oauthId === auth.id))
        );
        if (!matched) return auth;
        return {
          id: auth.id || matched.id,
          username: auth.username || matched.username,
          email: auth.email || matched.email,
          firstName: auth.firstName || matched.firstName,
          lastName: auth.lastName || matched.lastName,
          role: auth.role || matched.role || 'user',
          oauthType: auth.oauthType || 'user',
          expiresAt: auth.expiresAt,
        };
      })();

      req.session.user      = hydratedUser;
      req.session.oauthType = auth.oauthType;
      req.session._restoredFromCookie = true; // flag so routes can detect it
      // Synthetic stub so generic session checks see a token-shaped object; OAuth /status
      // endpoints treat _cookie_session as not authenticated. MCP/NL still need Redis session.
      req.session.oauthTokens = req.session.oauthTokens || {
        accessToken: '_cookie_session',
        tokenType:   'Bearer',
        expiresAt:   auth.expiresAt || (Date.now() + 24 * 60 * 60 * 1000),
        // Restore id_token from cookie so RP-Initiated Logout can send id_token_hint
        // to PingOne's /as/signoff even when the server session has been lost.
        idToken:     auth.idToken || null,
      };
      console.log('[auth-cookie] Session restored from _auth cookie for:', hydratedUser.email || hydratedUser.username || hydratedUser.id || 'unknown', '(no Redis session found)');
    }
  }
  next();
}

module.exports = { setAuthCookie, readAuthCookie, clearAuthCookie, restoreSessionFromCookie };
