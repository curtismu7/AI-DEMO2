/**
 * Canonical HTTPS origin for the public app (no trailing slash).
 * OAuth redirect_uri values sent to PingOne must match an exact entry in the app's Redirect URI list.
 *
 * Resolution order:
 *   1. PUBLIC_APP_URL — server-only override (e.g. https://api.ping.demo)
 *   2. REACT_APP_CLIENT_URL — same value from the CRA build
 */
'use strict';

function stripTrailingSlash(s) {
  return (s || '').trim().replace(/\/+$/, '');
}

function getCanonicalPublicOrigin() {
  const explicit = stripTrailingSlash(process.env.PUBLIC_APP_URL || process.env.REACT_APP_CLIENT_URL);
  return explicit || null;
}

module.exports.getCanonicalPublicOrigin = getCanonicalPublicOrigin;
