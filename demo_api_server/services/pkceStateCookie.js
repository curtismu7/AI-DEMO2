'use strict';

/**
 * pkceStateCookie.js
 *
 * Serverless / multi-instance hosts may route the OAuth callback to a *different*
 * function instance than the one that initiated the login.  The in-memory
 * express-session cannot share data across instances, so the PKCE state /
 * code_verifier set in the session during /login is missing by the time
 * /callback runs → "invalid_state" redirect loop.
 *
 * Fix: write the PKCE data to a short-lived, HMAC-signed, HTTP-only cookie
 * during /login.  The callback reads it back (falling through to the session
 * when it works), then clears the cookie.
 *
 * The cookie is signed with the SESSION_SECRET so it cannot be forged or
 * tampered with by a browser.  It contains no sensitive material (the
 * code_verifier is a public-client value; the state is a CSRF token that
 * expires in ≤15 minutes).
 */

const crypto = require('crypto');

const COOKIE_NAME    = '_pkce';
/** PKCE cookie lifetime (was 5 min; extended to 15 min for MFA / slow networks). */
const MAX_AGE_MS     = 15 * 60 * 1000;
const COOKIE_PATH    = '/api/auth';    // only sent to auth routes

/**
 * HMAC-sign `payload` string with the server SESSION_SECRET.
 * Returns `<base64url(payload)>.<base64url(hmac)>`.
 */
function _sign(payload) {
  const secret = process.env.SESSION_SECRET || 'dev-fallback';
  const enc    = Buffer.from(payload, 'utf8').toString('base64url');
  const sig    = crypto.createHmac('sha256', secret).update(enc).digest('base64url');
  return `${enc}.${sig}`;
}

/**
 * Verify and decode a signed cookie value.
 * Returns the original payload string, or null if verification fails.
 */
function _verify(value) {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const enc = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const secret = process.env.SESSION_SECRET || 'dev-fallback';
  const expected = crypto.createHmac('sha256', secret).update(enc).digest('base64url');
  try {
    // Constant-time comparison to prevent timing attacks. INSIDE the try on
    // purpose: timingSafeEqual throws RangeError when the buffers differ in
    // length, so a truncated or crafted `_pkce` whose signature segment is not
    // 43 base64url chars used to throw out of here, through readPkceCookie, and
    // into the OAuth callback as a 500 — even when the session still held the
    // valid PKCE state this cookie is only a fallback for. A cookie we cannot
    // verify is a cookie we do not trust: return null and let the session path
    // answer. Matches services/authStateCookie.js, which already does this.
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return Buffer.from(enc, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Parse the raw Cookie header manually (no cookie-parser dependency required).
 */
function _parseCookieHeader(req) {
  const header = req.headers && req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return [part.trim(), ''];
      const raw = part.slice(eq + 1).trim();
      // decodeURIComponent throws URIError on malformed escapes ('%ZZ'), which
      // is attacker-controlled input on a public callback. Fall back to the raw
      // value so a junk cookie fails signature verification below instead of
      // throwing a 500 out of the read.
      let value;
      try {
        value = decodeURIComponent(raw);
      } catch {
        value = raw;
      }
      return [part.slice(0, eq).trim(), value];
    })
  );
}

/**
 * Set the PKCE cookie on the response.
 * @param {object} res   Express response
 * @param {{ state: string, codeVerifier: string, redirectUri: string }} data
 * @param {boolean} isProduction  Use Secure + SameSite=None when true
 */
function setPkceCookie(res, data, isProduction) {
  const payload = JSON.stringify({
    s:  data.state,
    cv: data.codeVerifier,
    ru: data.redirectUri,
    n:  data.nonce || null,
    e:  Date.now() + MAX_AGE_MS,
  });
  const signed = _sign(payload);
  // Build Set-Cookie header manually so we don't need cookie-parser
  const flags = [
    `${COOKIE_NAME}=${encodeURIComponent(signed)}`,
    'HttpOnly',
    `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
    `Path=${COOKIE_PATH}`,
  ];
  if (isProduction) {
    flags.push('Secure');
    flags.push('SameSite=None');
  } else {
    flags.push('SameSite=Lax');
  }
  // Use append so we don't overwrite a clearAuthCookie Set-Cookie already queued
  res.append('Set-Cookie', flags.join('; '));
}

/**
 * Read the PKCE cookie from the request, verify signature and expiry.
 * Returns `{ state, codeVerifier, redirectUri }` or null.
 */
function readPkceCookie(req) {
  const cookies = _parseCookieHeader(req);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  // _parseCookieHeader already decoded once; this second decode is historical.
  // Kept (a double-encoded value in a live browser would still read) but made
  // non-throwing for the same reason as above.
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const payload = _verify(decoded);
  if (!payload) return null;
  try {
    const obj = JSON.parse(payload);
    if (!obj.e || Date.now() > obj.e) return null; // expired
    return { state: obj.s, codeVerifier: obj.cv, redirectUri: obj.ru, nonce: obj.n || null };
  } catch {
    return null;
  }
}

/**
 * Clear the PKCE cookie (call after a successful or failed callback).
 */
function clearPkceCookie(res, isProduction) {
  const flags = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'Max-Age=0',
    `Path=${COOKIE_PATH}`,
  ];
  if (isProduction) {
    flags.push('Secure');
    flags.push('SameSite=None');
  } else {
    flags.push('SameSite=Lax');
  }
  // Use append so we don't overwrite a Set-Cookie already queued (e.g.
  // clearAuthCookie's _auth clear in clearAllAuthCookies) — otherwise logout
  // would silently drop the _auth identity/role cookie clear.
  res.append('Set-Cookie', flags.join('; '));
}

module.exports = { setPkceCookie, readPkceCookie, clearPkceCookie };
